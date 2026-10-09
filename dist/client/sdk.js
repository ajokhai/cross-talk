import { WebSocket } from 'ws';
import EventEmitter from 'node:events';
import { GibberlinkEngine } from '../server/gibberlink.js';
import { BinaryCodec } from '../server/binary.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { DialectEngine } from '../dialect/engine.js';
import { execSync } from 'node:child_process';
function detectGitBranch() {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'main';
    }
    catch {
        return 'main';
    }
}
export class CrossTalkClient extends EventEmitter {
    ws = null;
    options;
    heartbeatInterval = null;
    isConnected = false;
    myAgentId = '';
    currentDialect = DIALECT_V1;
    pendingLockResolvers = new Map();
    pendingStateResolver = null;
    pendingInboxResolver = null;
    recentMessages = [];
    constructor(options) {
        super();
        this.options = {
            url: options.url || process.env.CROSSTALK_URL || 'ws://localhost:4488',
            channel: options.channel || process.env.CROSSTALK_CHANNEL || 'default',
            name: options.name,
            role: options.role || 'developer',
            environment: options.environment || 'bot',
            workspace: options.workspace || process.cwd(),
            currentTask: options.currentTask || 'Idle',
            autoHeartbeat: options.autoHeartbeat !== false,
            gibberlinkCapable: options.gibberlinkCapable !== false,
            dialectVersion: options.dialectVersion || DIALECT_V1.version,
            branch: options.branch || detectGitBranch(),
            sessionKey: options.sessionKey || ''
        };
    }
    get agentId() {
        return this.myAgentId;
    }
    get dialect() {
        return this.currentDialect;
    }
    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.options.url);
            this.ws.on('open', () => {
                this.sendPacket({
                    type: 'register',
                    channel: this.options.channel,
                    sessionKey: this.options.sessionKey,
                    agent: {
                        name: this.options.name,
                        role: this.options.role,
                        environment: this.options.environment,
                        workspace: this.options.workspace,
                        currentTask: this.options.currentTask,
                        gibberlinkCapable: this.options.gibberlinkCapable,
                        dialectVersion: this.options.dialectVersion,
                        branch: this.options.branch
                    }
                });
            });
            this.ws.on('message', (raw) => {
                try {
                    if (Buffer.isBuffer(raw) && raw.length >= 10 && raw[0] === 0x58) {
                        const frame = BinaryCodec.decode(raw);
                        if (frame) {
                            this.emit('binary_frame', frame);
                            return;
                        }
                    }
                    const packet = JSON.parse(raw.toString('utf8'));
                    this.handlePacket(packet, resolve);
                }
                catch (err) {
                    this.emit('error', err);
                }
            });
            this.ws.on('close', () => {
                this.isConnected = false;
                if (this.heartbeatInterval)
                    clearInterval(this.heartbeatInterval);
                this.emit('disconnected');
            });
            this.ws.on('error', (err) => {
                if (!this.isConnected)
                    reject(err);
                this.emit('error', err);
            });
        });
    }
    handlePacket(packet, initialResolver) {
        switch (packet.type) {
            case 'registered': {
                this.isConnected = true;
                this.myAgentId = packet.agentId;
                if (packet.dialect) {
                    this.currentDialect = packet.dialect;
                }
                if (this.options.autoHeartbeat) {
                    this.heartbeatInterval = setInterval(() => {
                        this.heartbeat();
                    }, 10000);
                }
                if (initialResolver) {
                    initialResolver({
                        agentId: packet.agentId,
                        channel: packet.channel,
                        agents: packet.mesh.agents,
                        locks: packet.mesh.locks,
                        dialect: packet.dialect
                    });
                }
                this.emit('ready', packet);
                break;
            }
            case 'agent_joined':
                this.emit('agent_joined', packet.agent);
                break;
            case 'agent_left':
                this.emit('agent_left', { id: packet.agentId, name: packet.name, reason: packet.reason });
                break;
            case 'agent_updated':
                this.emit('agent_updated', packet.agent);
                break;
            case 'broadcast':
                if (packet.message.type === 'dialect_shorthand') {
                    this.emit('dialect_shorthand', packet.message);
                }
                this.emit('broadcast', packet.message);
                break;
            case 'direct_message':
                // Filter out self-echoes: never trigger direct_message on our own sent messages
                if (packet.message?.from?.id && packet.message.from.id === this.myAgentId) {
                    return;
                }
                this.emit('direct_message', packet.message);
                break;
            case 'direct_message_sent':
                this.emit('direct_message_sent', packet);
                break;
            case 'gibberlink_signal':
                const decoded = GibberlinkEngine.decode(packet.signal);
                this.emit('gibberlink_signal', {
                    message: packet.message,
                    signal: packet.signal,
                    decoded
                });
                break;
            case 'dialect_dictionary':
                this.currentDialect = packet.dictionary;
                this.emit('dialect_updated', packet.dictionary);
                break;
            case 'lock_acquired': {
                const resolver = this.pendingLockResolvers.get(packet.lock.file);
                if (resolver && packet.byMe) {
                    this.pendingLockResolvers.delete(packet.lock.file);
                    resolver({ success: true, lock: packet.lock });
                }
                this.emit('lock_acquired', packet.lock);
                break;
            }
            case 'lock_denied': {
                const resolver = this.pendingLockResolvers.get(packet.file);
                if (resolver) {
                    this.pendingLockResolvers.delete(packet.file);
                    resolver({
                        success: false,
                        holder: packet.holder,
                        reason: packet.reason,
                        expiresAt: packet.expiresAt
                    });
                }
                this.emit('lock_denied', packet);
                break;
            }
            case 'lock_released':
                this.emit('lock_released', { file: packet.file, releasedBy: packet.releasedBy });
                break;
            case 'lock_conflict_warning':
                this.emit('lock_conflict_warning', packet);
                break;
            case 'state_snapshot':
                if (this.pendingStateResolver) {
                    this.pendingStateResolver(packet);
                    this.pendingStateResolver = null;
                }
                this.emit('state_snapshot', packet);
                break;
            case 'inbox_batch':
                if (this.pendingInboxResolver) {
                    this.pendingInboxResolver(packet.messages);
                    this.pendingInboxResolver = null;
                }
                break;
            case 'error':
                this.emit('server_error', packet.message);
                break;
        }
    }
    broadcast(content, metadata) {
        this.sendPacket({
            type: 'broadcast',
            content,
            metadata
        });
    }
    /**
     * Broadcasts a message using the XDialect concise shorthand format.
     * Auto-translates to human language and packs into bitstream for wire efficiency.
     * Example: `!LCK @src/auth.ts #REF "jwt validation" &WAIT`
     */
    sendShorthand(shorthand, metadata) {
        this.sendPacket({
            type: 'shorthand_broadcast',
            shorthand,
            metadata
        });
    }
    parseShorthand(shorthand) {
        return DialectEngine.parse(shorthand);
    }
    shorthandToHuman(shorthand) {
        return DialectEngine.toHuman(shorthand);
    }
    humanToShorthand(english) {
        return DialectEngine.fromHuman(english);
    }
    sendGibberlinkSignal(payload, mode = 'audible_fast', to) {
        const signal = GibberlinkEngine.encode(payload, mode);
        this.sendPacket({
            type: 'gibberlink_signal',
            signal,
            to
        });
        return signal;
    }
    sendBinary(frame) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const buf = BinaryCodec.encode(frame);
            this.ws.send(buf);
        }
    }
    async lockFile(file, reason, ttlSeconds = 300) {
        return new Promise((resolve) => {
            this.pendingLockResolvers.set(file, resolve);
            this.sendPacket({
                type: 'lock_acquire',
                file,
                reason,
                ttlSeconds
            });
            setTimeout(() => {
                if (this.pendingLockResolvers.has(file)) {
                    this.pendingLockResolvers.delete(file);
                    resolve({ success: false, reason: 'Lock request timed out' });
                }
            }, 5000);
        });
    }
    unlockFile(file) {
        this.sendPacket({
            type: 'lock_release',
            file
        });
    }
    heartbeat(status, currentTask) {
        if (status)
            this.options.currentTask = currentTask || this.options.currentTask;
        this.sendPacket({
            type: 'heartbeat',
            status: status,
            currentTask: currentTask || this.options.currentTask
        });
    }
    updateTask(taskDescription, status = 'working') {
        this.options.currentTask = taskDescription;
        this.heartbeat(status, taskDescription);
    }
    async getMeshState() {
        return new Promise((resolve) => {
            this.pendingStateResolver = resolve;
            this.sendPacket({ type: 'query_state' });
            setTimeout(() => {
                if (this.pendingStateResolver) {
                    this.pendingStateResolver = null;
                    resolve({ agents: [], locks: [], recentMessages: [] });
                }
            }, 3000);
        });
    }
    async fetchInbox(since = 0) {
        return new Promise((resolve) => {
            this.pendingInboxResolver = resolve;
            this.sendPacket({ type: 'fetch_inbox', since });
            setTimeout(() => {
                if (this.pendingInboxResolver) {
                    this.pendingInboxResolver = null;
                    resolve([]);
                }
            }, 3000);
        });
    }
    shouldSuppressAutoReply(msg) {
        if (msg.isAck || msg.replyExpected === false)
            return true;
        const content = (msg.content || '').trim().toLowerCase();
        if (content.startsWith('ack:') || content.startsWith('acknowledged:') || content.startsWith('已收到')) {
            return true;
        }
        const now = Date.now();
        this.recentMessages = this.recentMessages.filter(m => now - m.time < 3500);
        const count = this.recentMessages.filter(m => m.content === content).length;
        this.recentMessages.push({ content, time: now });
        if (count >= 2) {
            console.warn(`[CrossTalk Client] 🔁 Circuit breaker: suppressed duplicate ping-pong reply for: "${content.slice(0, 30)}..."`);
            return true;
        }
        return false;
    }
    sendDirectMessage(toAgentId, content, options) {
        const isOptionsObj = options && ('isAck' in options || 'replyExpected' in options || 'metadata' in options);
        const isAck = isOptionsObj ? options.isAck : false;
        const replyExpected = isOptionsObj ? (options.replyExpected ?? !isAck) : true;
        const metadata = isOptionsObj ? options.metadata : options;
        this.sendPacket({
            type: 'direct_message',
            to: toAgentId,
            content,
            isAck,
            replyExpected,
            metadata
        });
    }
    async disconnect(reason = 'client_exit') {
        if (this.ws && this.isConnected) {
            try {
                this.sendPacket({ type: 'disconnect', reason });
            }
            catch { }
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.ws) {
            try {
                this.ws.close(1000, reason);
            }
            catch { }
            this.ws = null;
        }
        this.isConnected = false;
    }
    sendPacket(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(packet));
        }
    }
}
export class CrossTalk {
    /**
     * Connect to, join, or auto-create a socket mesh in a single line.
     * If autoHost is true (default) and no server is active locally, it boots a local hub on the spot!
     */
    static async join(options = {}) {
        const url = options.url || process.env.CROSSTALK_URL || 'ws://localhost:4488';
        const channel = options.channel || process.env.CROSSTALK_CHANNEL || 'default';
        const name = options.name || `Agent-${Math.floor(Math.random() * 9000 + 1000)}`;
        const port = options.port || 4488;
        const autoHost = options.autoHost !== false;
        const client = new CrossTalkClient({
            url,
            channel,
            name,
            role: options.role || 'developer',
            currentTask: options.currentTask || 'Active on mesh'
        });
        try {
            await client.connect();
            return client;
        }
        catch (err) {
            if (autoHost && (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0'))) {
                const { startServer } = await import('../server/index.js');
                startServer(port);
                await new Promise((r) => setTimeout(r, 400));
                await client.connect();
                return client;
            }
            throw err;
        }
    }
}
