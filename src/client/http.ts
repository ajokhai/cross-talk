import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  type AgentInfo,
  type RequestFrame,
  type ResultData,
  type ServerFrame
} from '../protocol.js';
import { CrossTalkError, DEFAULT_URL } from './sdk.js';

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
}

/** Converts ws(s):// hub URLs to http(s):// for the REST API. */
export function httpBase(url: string): string {
  return url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
}

/**
 * A CrossTalk agent over plain HTTP: requests via POST /v1/rpc, pushes via
 * long-polling GET /v1/events. Useful where WebSockets are awkward.
 */
export class HttpAgent {
  readonly base: string;
  agent?: AgentInfo;
  private session?: string;
  private readonly sessionFile?: string;

  constructor(private readonly options: HttpAgentOptions) {
    this.base = httpBase(options.url ?? process.env.CROSSTALK_URL ?? DEFAULT_URL);
    if (options.sessionFile !== false) {
      const key = crypto.createHash('sha256').update(`${this.base}\n${options.name}`).digest('hex').slice(0, 16);
      this.sessionFile = options.sessionFile ?? path.join(os.homedir(), '.crosstalk', 'sessions', `${key}.json`);
      try {
        this.session = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8')).session;
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
  async open(): Promise<boolean> {
    if (this.session) {
      const probe = await this.call('POST', '/v1/rpc', { type: 'status.update' });
      if (probe.status === 200) {
        this.agent = probe.data.data;
        return false;
      }
    }
    const { status, data } = await this.call('POST', '/v1/sessions', {
      name: this.options.name,
      role: this.options.role ?? 'agent',
      environment: 'terminal'
    });
    if (status !== 201) throw new CrossTalkError(data?.error?.code ?? 'internal', data?.error?.message ?? `HTTP ${status}`);
    this.session = data.session;
    this.agent = data.agent;
    if (this.sessionFile) {
      fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.sessionFile, JSON.stringify({ session: this.session, agent: this.agent }), { mode: 0o600 });
    }
    return true;
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
    return data.events;
  }

  async close(): Promise<void> {
    if (!this.session) return;
    await this.call('DELETE', '/v1/sessions').catch(() => {});
    this.session = undefined;
    if (this.sessionFile) fs.rmSync(this.sessionFile, { force: true });
  }
}
