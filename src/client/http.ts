import fs from 'node:fs';
import { detectClient, detectPlace, loadProfile } from './client-name.js';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  type AgentInfo,
  type RequestFrame,
  type ResultData,
  type ServerFrame
} from '../protocol.js';
import { CrossTalkError, DEFAULT_URL, pinLoopback } from './sdk.js';

type RequestType = RequestFrame['type'];
type RequestBody<T extends RequestType> = Omit<Extract<RequestFrame, { type: T }>, 'type' | 'id'>;

export interface HttpAgentOptions {
  name: string;
  url?: string;
  token?: string;
  role?: string;
  /**
   * Where to remember the session token so separate processes (e.g. one-shot
   * CLI calls from a shell-driven agent) share one identity. Set to false to disable.
   */
  sessionFile?: string | false;
  /** This machine's public sealing key (xs_…), so others can share keys with this agent. */
  sealKey?: string;
  /** How to refer to this agent, e.g. "she/her". Defaults to $CROSSTALK_PRONOUNS. */
  pronouns?: string;
}

/** Converts ws(s):// hub URLs to http(s):// for the REST API. */
export function httpBase(url: string): string {
  return pinLoopback(url).replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
}

/**
 * A CrossTalk agent over plain HTTP: requests via POST /v1/rpc, pushes via
 * long-polling GET /v1/events. Useful where WebSockets are awkward.
 */
export class HttpAgent {
  readonly base: string;
  agent?: AgentInfo;
  private session?: string;
  /** Lets a new session carry on as the same agent after the hub restarted and forgot the old one. */
  private resumeToken?: string;
  private readonly sessionFile?: string;

  constructor(private readonly options: HttpAgentOptions) {
    this.base = httpBase(options.url ?? process.env.CROSSTALK_URL ?? DEFAULT_URL);
    if (options.sessionFile !== false) {
      const key = crypto.createHash('sha256').update(`${this.base}\n${options.name}`).digest('hex').slice(0, 16);
      this.sessionFile = options.sessionFile ?? path.join(os.homedir(), '.crosstalk', 'sessions', `${key}.json`);
      try {
        const saved = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        this.session = saved.session;
        this.resumeToken = typeof saved.resumeToken === 'string' ? saved.resumeToken : undefined;
      } catch {
        // No saved session yet.
      }
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.options.token ?? process.env.CROSSTALK_AUTH_TOKEN;
    if (token) headers['X-CrossTalk-Token'] = token;
    if (this.session) headers['X-CrossTalk-Session'] = this.session;
    return headers;
  }

  private async call(method: string, route: string, body?: unknown, signal?: AbortSignal): Promise<{ status: number; data: any }> {
    const res = await fetch(`${this.base}${route}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  /** Opens a new session (or keeps a saved one alive). Returns true if the session is new. */
  /** The hub's CrossTalk version, from the last new session (2.14+ hubs). */
  serverVersion?: string;

  async open(): Promise<boolean> {
    if (this.session) {
      const probe = await this.call('POST', '/v1/rpc', { type: 'status.update' });
      if (probe.status === 200) {
        this.agent = probe.data.data;
        return false;
      }
      // Only an expired or unknown session (401) means "start a new one"; anything
      // else (rate limit, hub error) would otherwise mint a duplicate identity.
      if (probe.status !== 401) {
        throw new CrossTalkError(probe.data?.error?.code ?? 'internal', probe.data?.error?.message ?? `HTTP ${probe.status}`);
      }
    }
    const { status, data } = await this.call('POST', '/v1/sessions', {
      name: this.options.name,
      role: this.options.role ?? 'agent',
      environment: 'terminal',
      sealKey: this.options.sealKey,
      // A profile saved with `crosstalk profile` comes with every new session.
      ...(() => { const p = loadProfile(this.options.name); return { bio: p.bio, currentTask: p.task }; })(),
      pronouns: this.options.pronouns ?? (process.env.CROSSTALK_PRONOUNS || loadProfile(this.options.name).pronouns || undefined),
      client: loadProfile(this.options.name).client ?? detectClient(),
      place: loadProfile(this.options.name).place ?? detectPlace(),
      // After a hub restart: carry on as the restored agent, not as a duplicate of it.
      resume: this.resumeToken
    });
    if (status !== 201) throw new CrossTalkError(data?.error?.code ?? 'internal', data?.error?.message ?? `HTTP ${status}`);
    this.session = data.session;
    this.resumeToken = typeof data.resumeToken === 'string' ? data.resumeToken : undefined;
    this.agent = data.agent;
    this.serverVersion = data.serverVersion;
    if (this.sessionFile) {
      fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.sessionFile, JSON.stringify({ session: this.session, resumeToken: this.resumeToken, agent: this.agent }), { mode: 0o600 });
    }
    return !data.resumed;
  }

  async request<T extends RequestType>(type: T, body: RequestBody<T>): Promise<ResultData[T]> {
    const { status, data } = await this.call('POST', '/v1/rpc', { ...body, type });
    if (status === 401) throw new CrossTalkError('not_registered', data?.error?.message ?? 'Session expired');
    if (!data?.ok) throw new CrossTalkError(data?.error?.code ?? 'internal', data?.error?.message ?? `HTTP ${status}`, data?.error?.details);
    return data.data;
  }

  /** Long-polls for events; returns as soon as at least one is queued or `waitSeconds` passes. */
  async events(waitSeconds = 25): Promise<ServerFrame[]> {
    const { status, data } = await this.call('GET', `/v1/events?wait=${Math.min(Math.max(0, waitSeconds), 55)}`);
    if (status !== 200) throw new CrossTalkError(data?.error?.code ?? 'internal', data?.error?.message ?? `HTTP ${status}`);
    // A proxy in front of a restarting hub can answer 200 with something that
    // isn't our JSON. Throw a CrossTalkError so listeners back off and retry
    // instead of crashing on `undefined.filter`.
    if (!Array.isArray(data?.events)) throw new CrossTalkError('internal', 'The hub sent an unexpected reply to GET /v1/events (is it restarting?)');
    return data.events;
  }

  async close(): Promise<void> {
    if (!this.session) return;
    await this.call('DELETE', '/v1/sessions').catch(() => {});
    this.session = undefined;
    if (this.sessionFile) fs.rmSync(this.sessionFile, { force: true });
  }
}
