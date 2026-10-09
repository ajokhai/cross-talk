import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import { LockManager } from './locks.js';
import { GibberlinkEngine } from './gibberlink.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { DialectEngine } from '../dialect/engine.js';
import { InMemoryStorage } from './storage.js';
import { SubnetGuard } from './subnet.js';
export class MeshHub {
    clients = new Map(); // agentId -> ConnectedClient
    lockManager = new LockManager();
    storage;
    messageHistory = new Map(); // channel -> MessageEvent[]
    inboxes = new Map(); // agentId -> MessageEvent[]
    maxHistoryPerChannel = 100;
    maxInboxPerAgent = 50;
    totalMessagesRouted = 0;
    totalBytesTransferred = 0;
    totalPacketsReceived = 0;
    totalPacketsSent = 0;
    totalConflictsBlocked = 0;
    totalLocksAcquired = 0;
    totalLocksReleased = 0;
    startTime = Date.now();
    allowedSubnets = [];
    constructor(storage, allowedSubnets) {
        this.storage = storage || new InMemoryStorage(this.maxHistoryPerChannel);
        this.allowedSubnets = allowedSubnets || [];
        this.storage.getTotalMessageCount().then(cnt => {
            if (cnt > 0)
                this.totalMessagesRouted = cnt;
        }).catch(() => { });
    }
    setAllowedSubnets(subnets) {
        this.allowedSubnets = subnets;
    }
    getAllowedSubnets() {
        return this.allowedSubnets;
    }
    async initStorage(channel = 'default') {
        try {
            const recent = await this.storage.getRecentMessages(channel, this.maxHistoryPerChannel);
            if (recent.length > 0) {
                this.messageHistory.set(channel, [...recent]);
            }
            const count = await this.storage.getTotalMessageCount();
            if (count > 0) {
                this.totalMessagesRouted = count;
            }
        }
        catch (_) { }
    }
    getStorage() {
        return this.storage;
    }
    getLockManager() {
        return this.lockManager;
    }
    handleConnection(ws, req) {
        let currentAgentId = null;
        const clientIp = req?.socket?.remoteAddress || req?.headers['x-forwarded-for']?.split(',')[0] || '127.0.0.1';
        if (!SubnetGuard.isAllowed(clientIp, this.allowedSubnets)) {
            console.warn(`[MeshHub] ⛔ Connection rejected from ${clientIp}: outside authorized subnet policy.`);
            ws.close(4003, 'Subnet policy violation');
            return;
        }
        // Optional Token Authentication via CROSSTALK_AUTH_TOKEN
        const authToken = process.env.CROSSTALK_AUTH_TOKEN?.trim() || '';
        if (authToken) {
            let clientToken = null;
            if (req?.url) {
                try {
                    const parsedUrl = new URL(req.url, 'http://localhost');
                    clientToken = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('auth_token');
                }
                catch (_) { }
            }
            if (!clientToken && req?.headers) {
                const authHeader = req.headers.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    clientToken = authHeader.slice(7).trim();
                }
                else if (req.headers['x-crosstalk-token']) {
                    clientToken = String(req.headers['x-crosstalk-token']).trim();
                }
                else if (req.headers['sec-websocket-protocol']) {
                    const protos = String(req.headers['sec-websocket-protocol']).split(',').map(p => p.trim());
                    if (protos.includes(authToken)) {
                        clientToken = authToken;
                    }
                }
            }
            if (clientToken !== authToken) {
                console.warn(`[MeshHub] ⛔ Connection rejected from ${clientIp}: invalid or missing CROSSTALK_AUTH_TOKEN.`);
                ws.close(4401, 'Unauthorized: Invalid or missing CROSSTALK_AUTH_TOKEN');
                return;
            }
        }
        ws.on('message', (raw) => {
            try {
                const text = typeof raw === 'string' ? raw : raw.toString('utf8');
                this.totalPacketsReceived++;
                this.totalBytesTransferred += typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.length;
                const packet = JSON.parse(text);
                this.processPacket(ws, packet, clientIp, (id) => {
                    currentAgentId = id;
                });
            }
            catch (err) {
                this.send(ws, {
                    type: 'error',
                    message: `Malformed packet: ${err.message}`
                });
            }
        });
        ws.on('close', () => {
            if (currentAgentId) {
                this.handleDisconnect(currentAgentId);
            }
        });
        ws.on('error', (err) => {
            console.error(`[MeshHub] Socket error for agent ${currentAgentId || 'unknown'}:`, err);
        });
    }
    processPacket(ws, packet, clientIp, setAgentId) {
        switch (packet.type) {
            case 'register': {
                const channel = packet.channel || 'default';
                const rawAgent = packet.agent;
                const id = rawAgent.id || `agent-${crypto.randomBytes(4).toString('hex')}`;
                setAgentId(id);
                const agent = {
                    id,
                    name: rawAgent.name || `Agent-${id.slice(0, 6)}`,
                    role: rawAgent.role || 'assistant',
                    environment: rawAgent.environment || 'ide',
                    workspace: rawAgent.workspace || 'default-workspace',
                    status: 'idle',
                    currentTask: rawAgent.currentTask || 'Connected to CrossTalk mesh',
                    lockedFiles: [],
                    connectedAt: Date.now(),
                    lastSeen: Date.now(),
                    gibberlinkCapable: rawAgent.gibberlinkCapable ?? true,
                    dialectVersion: rawAgent.dialectVersion || DIALECT_V1.version,
                    branch: rawAgent.branch || 'main',
                    subnet: clientIp
                };
                const existing = this.clients.get(id);
                if (existing && existing.ws !== ws) {
                    try {
                        existing.ws.close();
                    }
                    catch { }
                }
                this.clients.set(id, { ws, agent, channel });
                if (!this.inboxes.has(id)) {
                    this.inboxes.set(id, []);
                }
                const activeLocks = this.lockManager.getLocks(channel);
                const currentAgents = this.getAgentsInChannel(channel);
                const recentMessages = this.getRecentMessages(channel);
                // Always provide the versioned dialect dictionary on connect!
                this.send(ws, {
                    type: 'registered',
                    agentId: id,
                    channel,
                    dialect: DIALECT_V1,
                    mesh: {
                        agents: currentAgents,
                        locks: activeLocks,
                        recentMessages
                    }
                });
                this.broadcastToChannel(channel, {
                    type: 'agent_joined',
                    agent
                }, [id]);
                this.recordAndBroadcastSystemMessage(channel, `Agent [${agent.name}] (${agent.role} in ${agent.environment}) connected with XDialect v${agent.dialectVersion}.`);
                console.log(`[MeshHub] Registered ${agent.name} (${id}) on channel '${channel}' with XDialect v${DIALECT_V1.version}`);
                break;
            }
            case 'heartbeat': {
                const client = this.getClientByWs(ws);
                if (!client)
                    break;
                client.agent.lastSeen = Date.now();
                if (packet.status)
                    client.agent.status = packet.status;
                if (packet.currentTask)
                    client.agent.currentTask = packet.currentTask;
                this.broadcastToChannel(client.channel, {
                    type: 'agent_updated',
                    agent: client.agent
                });
                break;
            }
            case 'broadcast': {
                const client = this.getClientByWs(ws);
                if (!client) {
                    this.send(ws, { type: 'error', message: 'Not registered yet' });
                    return;
                }
                const msg = {
                    id: `msg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                    type: 'broadcast',
                    channel: client.channel,
                    from: client.agent,
                    content: packet.content,
                    timestamp: Date.now(),
                    metadata: packet.metadata
                };
                this.appendMessageHistory(client.channel, msg);
                this.broadcastToChannel(client.channel, {
                    type: 'broadcast',
                    message: msg
                });
                console.log(`[MeshHub] [${client.channel}] ${client.agent.name}: ${packet.content}`);
                break;
            }
            case 'shorthand_broadcast': {
                const client = this.getClientByWs(ws);
                if (!client) {
                    this.send(ws, { type: 'error', message: 'Not registered yet' });
                    return;
                }
                const shorthand = packet.shorthand;
                const parsed = DialectEngine.parse(shorthand);
                const human = DialectEngine.toHuman(parsed);
                const bits = DialectEngine.packToBits(parsed);
                // Auto-handle lock actions declared in shorthand
                if (parsed.action === '!LCK' && parsed.target) {
                    const res = this.lockManager.acquire(parsed.target, client.agent, parsed.reason || parsed.intent || 'Shorthand lock', parsed.ttl || 300, client.channel);
                    if (res.success && res.lock) {
                        if (!client.agent.lockedFiles.includes(res.lock.file)) {
                            client.agent.lockedFiles.push(res.lock.file);
                        }
                        this.broadcastToChannel(client.channel, {
                            type: 'lock_acquired',
                            lock: res.lock,
                            byMe: false
                        }, [client.agent.id]);
                    }
                    else if (res.quotaExceeded) {
                        this.send(ws, {
                            type: 'lock_denied',
                            file: parsed.target,
                            reason: res.error || 'Lock quota exceeded'
                        });
                    }
                }
                else if (parsed.action === '!REL' && parsed.target) {
                    const res = this.lockManager.release(parsed.target, client.agent.id, false, client.channel, client.agent.workspace);
                    if (res.success && res.lock) {
                        client.agent.lockedFiles = client.agent.lockedFiles.filter(f => f !== res.lock?.file);
                        this.broadcastToChannel(client.channel, {
                            type: 'lock_released',
                            file: res.lock.file,
                            releasedBy: client.agent.name
                        });
                    }
                }
                const msg = {
                    id: `shorthand-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                    type: 'dialect_shorthand',
                    channel: client.channel,
                    from: client.agent,
                    content: human,
                    timestamp: Date.now(),
                    metadata: packet.metadata,
                    shorthand: {
                        raw: shorthand,
                        human,
                        bitSize: bits.length,
                        action: parsed.action,
                        target: parsed.target,
                        intent: parsed.intent
                    }
                };
                this.appendMessageHistory(client.channel, msg);
                this.broadcastToChannel(client.channel, {
                    type: 'broadcast',
                    message: msg
                });
                console.log(`[MeshHub] [XDialect] ${client.agent.name}: "${shorthand}" -> (${bits.length} wire bytes)`);
                break;
            }
            case 'direct_message': {
                const client = this.getClientByWs(ws);
                if (!client) {
                    this.send(ws, { type: 'error', message: 'Not registered yet' });
                    return;
                }
                const targetClient = this.clients.get(packet.to);
                const msg = {
                    id: `dm-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                    type: 'direct_message',
                    channel: client.channel,
                    from: client.agent,
                    to: packet.to,
                    content: packet.content,
                    timestamp: Date.now(),
                    isAck: packet.isAck,
                    replyExpected: packet.replyExpected,
                    branch: client.agent.branch,
                    metadata: packet.metadata
                };
                this.addToInbox(packet.to, msg);
                if (targetClient) {
                    this.send(targetClient.ws, {
                        type: 'direct_message',
                        message: msg
                    });
                }
                // Sender confirmation: Send direct_message_sent to prevent infinite self-echo feedback loops
                this.send(ws, {
                    type: 'direct_message_sent',
                    messageId: msg.id,
                    to: packet.to,
                    timestamp: Date.now()
                });
                console.log(`[MeshHub] DM [${client.agent.name} -> ${targetClient?.agent.name || packet.to}]: ${packet.content}`);
                break;
            }
            case 'disconnect': {
                const client = this.getClientByWs(ws);
                if (client) {
                    console.log(`[MeshHub] Agent ${client.agent.name} initiated graceful disconnect: ${packet.reason || 'client_shutdown'}`);
                    this.handleDisconnect(client.agent.id);
                }
                break;
            }
            case 'gibberlink_signal': {
                const client = this.getClientByWs(ws);
                if (!client) {
                    this.send(ws, { type: 'error', message: 'Not registered yet' });
                    return;
                }
                const signal = packet.signal;
                const decoded = GibberlinkEngine.decode(signal);
                if (decoded.valid && decoded.data && typeof decoded.data === 'object') {
                    if (decoded.data.action === 'LOCK' && decoded.data.file) {
                        this.lockManager.acquire(decoded.data.file, client.agent, decoded.data.reason || 'Gibberlink signal lock', decoded.data.ttlSeconds || 300, client.channel);
                    }
                    else if (decoded.data.action === 'UNLOCK' && decoded.data.file) {
                        this.lockManager.release(decoded.data.file, client.agent.id, false, client.channel, client.agent.workspace);
                    }
                }
                const msg = {
                    id: `glink-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
                    type: 'gibberlink_signal',
                    channel: client.channel,
                    from: client.agent,
                    to: packet.to,
                    content: decoded.text || signal.text || '[Gibberlink Audio Signal Stream]',
                    timestamp: Date.now(),
                    gibberlinkSignal: signal
                };
                this.appendMessageHistory(client.channel, msg);
                if (packet.to) {
                    this.addToInbox(packet.to, msg);
                    const targetClient = this.clients.get(packet.to);
                    if (targetClient) {
                        this.send(targetClient.ws, {
                            type: 'gibberlink_signal',
                            message: msg,
                            signal
                        });
                    }
                    this.send(ws, {
                        type: 'gibberlink_signal',
                        message: msg,
                        signal
                    });
                }
                else {
                    this.broadcastToChannel(client.channel, {
                        type: 'gibberlink_signal',
                        message: msg,
                        signal
                    });
                }
                console.log(`[MeshHub] [Gibberlink Signal] ${client.agent.name} emitted ${signal.frequencies.length} tones (${signal.totalDurationMs}ms audio signal)`);
                break;
            }
            case 'get_dialect': {
                this.send(ws, {
                    type: 'dialect_dictionary',
                    dictionary: DIALECT_V1
                });
                break;
            }
            case 'lock_acquire': {
                const client = this.getClientByWs(ws);
                if (!client) {
                    this.send(ws, { type: 'error', message: 'Not registered yet' });
                    return;
                }
                const res = this.lockManager.acquire(packet.file, client.agent, packet.reason, packet.ttlSeconds || 300, client.channel);
                if (res.success && res.lock) {
                    if (!client.agent.lockedFiles.includes(res.lock.file)) {
                        client.agent.lockedFiles.push(res.lock.file);
                    }
                    this.broadcastToChannel(client.channel, {
                        type: 'lock_acquired',
                        lock: res.lock,
                        byMe: false
                    }, [client.agent.id]);
                    this.send(ws, {
                        type: 'lock_acquired',
                        lock: res.lock,
                        byMe: true
                    });
                    this.recordAndBroadcastSystemMessage(client.channel, `File claimed: [${res.lock.file}] locked by ${client.agent.name} ("${packet.reason}")`);
                }
                else if (res.quotaExceeded) {
                    this.send(ws, {
                        type: 'lock_denied',
                        file: packet.file,
                        reason: res.error || 'Lock quota exceeded (maximum 10 locks per agent)'
                    });
                    return;
                }
                else if (res.existingHolder) {
                    const holderClient = this.clients.get(res.existingHolder.id);
                    const holderAgent = holderClient ? holderClient.agent : ({
                        id: res.existingHolder.id,
                        name: res.existingHolder.name,
                        role: 'agent',
                        environment: 'unknown',
                        workspace: '',
                        status: 'working',
                        currentTask: res.existingHolder.reason,
                        lockedFiles: [packet.file],
                        connectedAt: 0,
                        lastSeen: 0
                    });
                    this.send(ws, {
                        type: 'lock_denied',
                        file: packet.file,
                        holder: holderAgent,
                        reason: res.existingHolder.reason,
                        expiresAt: res.existingHolder.expiresAt
                    });
                    if (holderClient) {
                        this.send(holderClient.ws, {
                            type: 'lock_conflict_warning',
                            file: packet.file,
                            requester: client.agent,
                            holder: holderAgent,
                            reason: packet.reason
                        });
                        const conflictNotice = {
                            id: `warn-${Date.now()}`,
                            type: 'system',
                            channel: client.channel,
                            from: client.agent,
                            to: holderClient.agent.id,
                            content: `Conflict Warning: Agent ${client.agent.name} attempted to lock file '${packet.file}' which you currently hold (Reason: "${packet.reason}").`,
                            timestamp: Date.now()
                        };
                        this.addToInbox(holderClient.agent.id, conflictNotice);
                    }
                }
                break;
            }
            case 'lock_release': {
                const client = this.getClientByWs(ws);
                if (!client) {
                    this.send(ws, { type: 'error', message: 'Not registered yet' });
                    return;
                }
                const res = this.lockManager.release(packet.file, client.agent.id, false, client.channel, client.agent.workspace);
                if (res.success && res.lock) {
                    client.agent.lockedFiles = client.agent.lockedFiles.filter(f => f !== res.lock?.file);
                    this.broadcastToChannel(client.channel, {
                        type: 'lock_released',
                        file: res.lock.file,
                        releasedBy: client.agent.name
                    });
                    this.recordAndBroadcastSystemMessage(client.channel, `File released: [${res.lock.file}] is now unlocked by ${client.agent.name}.`);
                }
                break;
            }
            case 'switch_channel': {
                const client = this.getClientByWs(ws);
                if (!client) {
                    this.send(ws, { type: 'error', message: 'Not registered yet' });
                    return;
                }
                const targetChannel = packet.channel || 'default';
                client.channel = targetChannel;
                const agentsInTarget = targetChannel === '*'
                    ? this.getAllAgents().filter(a => a.id !== client.agent.id)
                    : this.getAgentsInChannel(targetChannel).filter(a => a.id !== client.agent.id);
                const locksInTarget = targetChannel === '*'
                    ? this.lockManager.getLocks()
                    : this.lockManager.getLocks(targetChannel);
                const recentInTarget = targetChannel === '*'
                    ? this.getAllRecentMessages()
                    : this.getRecentMessages(targetChannel);
                this.send(ws, {
                    type: 'state_snapshot',
                    channel: targetChannel,
                    mesh: {
                        agents: agentsInTarget,
                        locks: locksInTarget,
                        recentMessages: recentInTarget
                    }
                });
                break;
            }
            case 'query_state': {
                const client = this.getClientByWs(ws);
                const requestedChannel = packet.channel || client?.channel || 'default';
                const agentsInTarget = requestedChannel === '*'
                    ? this.getAllAgents().filter(a => a.id !== client?.agent.id)
                    : this.getAgentsInChannel(requestedChannel).filter(a => a.id !== client?.agent.id);
                const locksInTarget = requestedChannel === '*'
                    ? this.lockManager.getLocks()
                    : this.lockManager.getLocks(requestedChannel);
                const recentInTarget = requestedChannel === '*'
                    ? this.getAllRecentMessages()
                    : this.getRecentMessages(requestedChannel);
                this.send(ws, {
                    type: 'state_snapshot',
                    channel: requestedChannel,
                    mesh: {
                        agents: agentsInTarget,
                        locks: locksInTarget,
                        recentMessages: recentInTarget
                    }
                });
                break;
            }
            case 'fetch_inbox': {
                const client = this.getClientByWs(ws);
                if (!client)
                    return;
                const since = packet.since || 0;
                const agentInbox = this.inboxes.get(client.agent.id) || [];
                const filtered = agentInbox.filter(m => m.timestamp >= since);
                this.send(ws, {
                    type: 'inbox_batch',
                    messages: filtered
                });
                break;
            }
        }
    }
    handleDisconnect(agentId) {
        const client = this.clients.get(agentId);
        if (!client)
            return;
        this.clients.delete(agentId);
        const releasedLocks = this.lockManager.releaseAllByAgent(agentId);
        for (const lock of releasedLocks) {
            this.broadcastToChannel(client.channel, {
                type: 'lock_released',
                file: lock.file,
                releasedBy: client.agent.name
            });
        }
        this.broadcastToChannel(client.channel, {
            type: 'agent_left',
            agentId,
            name: client.agent.name,
            reason: 'Disconnected'
        });
        this.recordAndBroadcastSystemMessage(client.channel, `Agent [${client.agent.name}] disconnected.`);
        console.log(`[MeshHub] Disconnected agent ${client.agent.name} (${agentId})`);
    }
    broadcastToChannel(channel, packet, excludeIds = []) {
        for (const [id, client] of this.clients.entries()) {
            if ((client.channel === channel || client.channel === '*') && !excludeIds.includes(id)) {
                this.send(client.ws, packet);
            }
        }
    }
    send(ws, packet) {
        if (ws.readyState === WebSocket.OPEN) {
            const payload = JSON.stringify(packet);
            this.totalPacketsSent++;
            this.totalBytesTransferred += Buffer.byteLength(payload, 'utf8');
            ws.send(payload);
        }
    }
    getClientByWs(ws) {
        for (const client of this.clients.values()) {
            if (client.ws === ws)
                return client;
        }
        return undefined;
    }
    getAgentsInChannel(channel) {
        const list = [];
        for (const client of this.clients.values()) {
            if (client.channel === channel) {
                list.push(client.agent);
            }
        }
        return list;
    }
    getAllAgents() {
        return Array.from(this.clients.values()).map(c => c.agent);
    }
    getRecentMessages(channel) {
        return this.messageHistory.get(channel) || [];
    }
    getAllRecentMessages(limit = 100) {
        const all = [];
        for (const msgs of this.messageHistory.values()) {
            all.push(...msgs);
        }
        all.sort((a, b) => a.timestamp - b.timestamp);
        return all.slice(-limit);
    }
    getSessions() {
        const channelSet = new Set(['default']);
        for (const client of this.clients.values()) {
            if (client.channel && client.channel !== '*')
                channelSet.add(client.channel);
        }
        for (const ch of this.messageHistory.keys()) {
            channelSet.add(ch);
        }
        for (const lock of this.lockManager.getLocks()) {
            if (lock.channel)
                channelSet.add(lock.channel);
        }
        const sessions = [];
        for (const ch of channelSet) {
            const msgs = this.messageHistory.get(ch) || [];
            const locks = this.lockManager.getLocks(ch);
            const agents = this.getAgentsInChannel(ch);
            const lastMsgTime = msgs.length > 0 ? msgs[msgs.length - 1].timestamp : 0;
            sessions.push({
                channel: ch,
                agentCount: agents.length,
                lockCount: locks.length,
                messageCount: msgs.length,
                lastActivity: lastMsgTime || this.startTime
            });
        }
        return sessions;
    }
    appendMessageHistory(channel, msg) {
        this.totalMessagesRouted++;
        if (!this.messageHistory.has(channel)) {
            this.messageHistory.set(channel, []);
        }
        const history = this.messageHistory.get(channel);
        history.push(msg);
        if (history.length > this.maxHistoryPerChannel) {
            history.shift();
        }
        this.storage.recordMessage(channel, msg).catch(() => { });
    }
    getTotalBytesTransferred() { return this.totalBytesTransferred; }
    getTotalPacketsReceived() { return this.totalPacketsReceived; }
    getTotalPacketsSent() { return this.totalPacketsSent; }
    getTotalConflictsBlocked() { return this.totalConflictsBlocked; }
    getTotalLocksAcquired() { return this.totalLocksAcquired; }
    getTotalLocksReleased() { return this.totalLocksReleased; }
    getStats(channel = 'default') {
        const channelHistory = this.messageHistory.get(channel) || [];
        const locks = this.lockManager.getLocks(channel);
        const mem = process.memoryUsage();
        return {
            totalMessagesRouted: this.totalMessagesRouted,
            totalBytesTransferred: this.totalBytesTransferred,
            totalPacketsReceived: this.totalPacketsReceived,
            totalPacketsSent: this.totalPacketsSent,
            totalConflictsBlocked: this.totalConflictsBlocked,
            totalLocksAcquired: this.totalLocksAcquired,
            totalLocksReleased: this.totalLocksReleased,
            activePeers: this.clients.size,
            activeLocks: locks.length,
            activeChannelsCount: this.getSessions().length,
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
            memoryRssBytes: mem.rss,
            memoryHeapUsedBytes: mem.heapUsed,
            recentHistoryCount: channelHistory.length,
            maxBufferCapacity: this.maxHistoryPerChannel,
            channel,
            meshVersion: DIALECT_V1.version,
            storageMode: (this.storage.constructor?.name === 'MongoStorage') ? 'mongodb' : 'memory',
            timestamp: Date.now()
        };
    }
    addToInbox(agentId, msg) {
        if (!this.inboxes.has(agentId)) {
            this.inboxes.set(agentId, []);
        }
        const inbox = this.inboxes.get(agentId);
        inbox.push(msg);
        if (inbox.length > this.maxInboxPerAgent) {
            inbox.shift();
        }
    }
    recordAndBroadcastSystemMessage(channel, content) {
        const msg = {
            id: `sys-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
            type: 'system',
            channel,
            content,
            timestamp: Date.now()
        };
        this.appendMessageHistory(channel, msg);
        this.broadcastToChannel(channel, {
            type: 'broadcast',
            message: msg
        });
    }
    injectBroadcast(channel, fromName, content, role = 'system') {
        const syntheticAgent = {
            id: `ext-${Date.now()}`,
            name: fromName,
            role,
            environment: 'terminal',
            workspace: 'local',
            status: 'working',
            currentTask: content,
            lockedFiles: [],
            connectedAt: Date.now(),
            lastSeen: Date.now(),
            gibberlinkCapable: true
        };
        const msg = {
            id: `msg-${Date.now()}`,
            type: 'broadcast',
            channel,
            from: syntheticAgent,
            content,
            timestamp: Date.now()
        };
        this.appendMessageHistory(channel, msg);
        this.broadcastToChannel(channel, {
            type: 'broadcast',
            message: msg
        });
        return msg;
    }
    createInvite(options = {}) {
        const channel = options.channel || 'default';
        const branch = options.branch || 'main';
        const host = options.host || 'localhost:4488';
        const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
        const cleanHost = host.replace(/^(http|https|ws|wss):\/\//, '');
        const wsScheme = host.startsWith('https') ? 'wss' : 'ws';
        const httpScheme = host.startsWith('https') ? 'https' : 'http';
        const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
        const branchTag = branch.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8).toUpperCase() || 'SYNC';
        const code = `XT-${randomSuffix}-${branchTag}`;
        const subnetLock = options.allowedSubnet || (isLocal ? '192.168.0.0/16' : 'any');
        return {
            code,
            channel,
            branch,
            subnetLock,
            options: {
                centralRelay: {
                    name: 'Central Hosted Bridge (Key / Code / Link)',
                    code,
                    joinLink: `${httpScheme}://${cleanHost}/?room=${code}&branch=${branch}`,
                    wsUrl: `${wsScheme}://${cleanHost}`,
                    agentPrompt: `Join CrossTalk session ${code} on branch ${branch}`,
                    cliCommand: `crosstalk join ${code} --branch ${branch}`
                },
                openMesh: {
                    name: 'Open Mesh (Discovery Topic Rendezvous)',
                    topic: `mesh://open/repo-${branchTag.toLowerCase()}`,
                    agentPrompt: `Connect to open mesh channel 'team-${branchTag.toLowerCase()}' on branch ${branch}`,
                    cliCommand: `crosstalk up team-${branchTag.toLowerCase()} --mode mesh --branch ${branch}`
                },
                directP2P: {
                    name: 'Direct Computer-to-Computer (Subnet Locked)',
                    address: `${wsScheme}://${cleanHost}`,
                    subnetLock,
                    agentPrompt: `Connect directly to peer ${wsScheme}://${cleanHost} on branch ${branch} with subnet lock ${subnetLock}`,
                    cliCommand: `crosstalk join ${wsScheme}://${cleanHost} --branch ${branch} --subnet ${subnetLock}`
                }
            }
        };
    }
}
