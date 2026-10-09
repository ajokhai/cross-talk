import { WebSocket } from 'ws';
import EventEmitter from 'node:events';
import {
  AgentInfo,
  FileLock,
  MessageEvent,
  ServerPacket,
  AgentEnvironment,
  AgentStatus
} from '../server/types.js';
import { GibberlinkEngine, GibberlinkSignalPacket } from '../server/gibberlink.js';
import { BinaryCodec, BinaryFrame } from '../server/binary.js';
import { DIALECT_V1, DialectDictionary } from '../dialect/dictionary.js';
import { DialectEngine, ParsedDialectMessage } from '../dialect/engine.js';

export interface CrossTalkClientOptions {
  url?: string;
  channel?: string;
  name: string;
  role?: string;
  environment?: AgentEnvironment;
  workspace?: string;
  currentTask?: string;
  autoHeartbeat?: boolean;
  gibberlinkCapable?: boolean;
  dialectVersion?: string;
}

export class CrossTalkClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: Required<CrossTalkClientOptions>;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private myAgentId: string = '';
  private currentDialect: DialectDictionary = DIALECT_V1;
  private pendingLockResolvers: Map<string, (result: any) => void> = new Map();
  private pendingStateResolver: ((state: any) => void) | null = null;
  private pendingInboxResolver: ((messages: MessageEvent[]) => void) | null = null;

  constructor(options: CrossTalkClientOptions) {
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
      dialectVersion: options.dialectVersion || DIALECT_V1.version
    };
  }

  public get agentId(): string {
    return this.myAgentId;
  }

  public get dialect(): DialectDictionary {
    return this.currentDialect;
  }

  public async connect(): Promise<{
    agentId: string;
    channel: string;
    agents: AgentInfo[];
    locks: FileLock[];
    dialect: DialectDictionary;
  }> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        this.sendPacket({
          type: 'register',
          channel: this.options.channel,
          agent: {
            name: this.options.name,
            role: this.options.role,
            environment: this.options.environment,
            workspace: this.options.workspace,
            currentTask: this.options.currentTask,
            gibberlinkCapable: this.options.gibberlinkCapable,
            dialectVersion: this.options.dialectVersion
          }
        });
      });

      this.ws.on('message', (raw: Buffer | string) => {
        try {
          if (Buffer.isBuffer(raw) && raw.length >= 10 && raw[0] === 0x58) {
            const frame = BinaryCodec.decode(raw);
            if (frame) {
              this.emit('binary_frame', frame);
              return;
            }
          }

          const packet = JSON.parse(raw.toString('utf8')) as ServerPacket;
          this.handlePacket(packet, resolve);
        } catch (err) {
          this.emit('error', err);
        }
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.emit('disconnected');
      });

      this.ws.on('error', (err) => {
        if (!this.isConnected) reject(err);
        this.emit('error', err);
      });
    });
  }

  private handlePacket(packet: ServerPacket, initialResolver?: (val: any) => void) {
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
        this.emit('direct_message', packet.message);
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

  public broadcast(content: string, metadata?: Record<string, any>) {
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
  public sendShorthand(shorthand: string, metadata?: Record<string, any>) {
    this.sendPacket({
      type: 'shorthand_broadcast',
      shorthand,
      metadata
    });
  }

  public parseShorthand(shorthand: string): ParsedDialectMessage {
    return DialectEngine.parse(shorthand);
  }

  public shorthandToHuman(shorthand: string): string {
    return DialectEngine.toHuman(shorthand);
  }

  public humanToShorthand(english: string): string {
    return DialectEngine.fromHuman(english);
  }

  public sendDirectMessage(toAgentId: string, content: string, metadata?: Record<string, any>) {
    this.sendPacket({
      type: 'direct_message',
      to: toAgentId,
      content,
      metadata
    });
  }

  public sendGibberlinkSignal(
    payload: string | object,
    mode: 'audible_fast' | 'audible_standard' | 'ultrasonic' = 'audible_fast',
    to?: string
  ): GibberlinkSignalPacket {
    const signal = GibberlinkEngine.encode(payload, mode);
    this.sendPacket({
      type: 'gibberlink_signal',
      signal,
      to
    });
    return signal;
  }

  public sendBinary(frame: BinaryFrame) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const buf = BinaryCodec.encode(frame);
      this.ws.send(buf);
    }
  }

  public async lockFile(
    file: string,
    reason: string,
    ttlSeconds: number = 300
  ): Promise<{ success: boolean; lock?: FileLock; holder?: AgentInfo; reason?: string; expiresAt?: number }> {
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

  public unlockFile(file: string) {
    this.sendPacket({
      type: 'lock_release',
      file
    });
  }

  public heartbeat(status?: AgentStatus, currentTask?: string) {
    if (status) this.options.currentTask = currentTask || this.options.currentTask;
    this.sendPacket({
      type: 'heartbeat',
      status: status,
      currentTask: currentTask || this.options.currentTask
    });
  }

  public updateTask(taskDescription: string, status: AgentStatus = 'working') {
    this.options.currentTask = taskDescription;
    this.heartbeat(status, taskDescription);
  }

  public async getMeshState(): Promise<{ agents: AgentInfo[]; locks: FileLock[]; recentMessages: MessageEvent[] }> {
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

  public async fetchInbox(since: number = 0): Promise<MessageEvent[]> {
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

  public disconnect() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private sendPacket(packet: any) {
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
  public static async join(options: {
    channel?: string;
    url?: string;
    name?: string;
    role?: string;
    autoHost?: boolean;
    port?: number;
    currentTask?: string;
  } = {}): Promise<CrossTalkClient> {
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
    } catch (err: any) {
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

