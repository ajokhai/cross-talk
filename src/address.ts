/**
 * One-line channel addresses: the address says where the channel lives, so an
 * invite needs nothing else.
 *
 *   xt_<id>          on the CrossTalk internet hub (or the hub you're set up
 *                    for: CROSSTALK_URL, --url), as before
 *   xtl_<id>         on a hub on this computer (ws://localhost:4488)
 *   xt_<id>@<hub>    on another hub: a host (`hub.example.com`, `10.0.0.5:4488`)
 *                    or a full URL (`ws://box.lan:9000/crosstalk`)
 *
 * The hub itself only knows `xt_<id>`; clients connect to the hub the address
 * names and send the bare id. Hubs also accept the other forms and read the id
 * out of them. No dependencies: the hub, the CLI, the MCP server and the SDK
 * all use it (website/cockpit.js carries a plain-JS copy).
 */

/** The CrossTalk internet hub (same as DEFAULT_URL in the SDK). */
export const ONLINE_HUB = 'wss://hub-production-a114.up.railway.app';
/** A hub on this computer (same as LOCAL_URL in the SDK). */
export const LOCAL_HUB = 'ws://localhost:4488';

const ID = '[A-Za-z0-9_-]{22}';
const WHOLE = new RegExp(`^(xtl?)_(${ID})(?:@(\\S+))?$`);
/** An address somewhere in a line of text (an invite, a link ending in #xt_…). */
const IN_TEXT = new RegExp(`(?<![A-Za-z0-9_-])(xtl?)_(${ID})(?:@([^\\s"'<>()\\[\\]{},;]+))?`);

export type AddressKind = 'online' | 'local' | 'custom';

export interface ParsedAddress {
  /** What the hub calls the channel: `xt_<id>`. */
  channel: string;
  /** The hub the address names; undefined for a plain `xt_<id>` (use the hub you're set up for, the internet hub by default). */
  hub?: string;
  kind: AddressKind;
}

/** Hosts reached over plain ws:// when an address names no scheme: this computer and private networks. */
function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return true;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(h)) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:');
}

/** `ws(s)://host[:port][/path]` without a trailing slash, or undefined for anything else. */
function hubUrl(text: string): string | undefined {
  let raw = text.trim().replace(/[.,;:!?]+$/, '');
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) raw = raw.replace(/^http/i, 'ws');
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^wss?:\/\//i.test(raw)) return undefined;
  if (!/^wss?:\/\//i.test(raw)) {
    const host = raw.split('/')[0].replace(/:\d+$/, '');
    raw = `${isPrivateHost(host) ? 'ws' : 'wss'}://${raw}`;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:' || !url.hostname || url.username || url.password || url.search || url.hash) return undefined;
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Same hub, however it's written (scheme case, trailing slash, http vs ws, `localhost` vs 127.0.0.1). */
export function sameHub(a: string, b: string): boolean {
  const norm = (u: string) => {
    const url = hubUrl(u);
    return url?.toLowerCase().replace('://127.0.0.1', '://localhost').replace('://[::1]', '://localhost');
  };
  const [x, y] = [norm(a), norm(b)];
  return !!x && x === y;
}

/** Reads a whole address (`xt_…`, `xtl_…` or `xt_…@hub`); undefined if `value` isn't one. */
export function parseAddress(value: unknown): ParsedAddress | undefined {
  if (typeof value !== 'string') return undefined;
  const m = WHOLE.exec(value.trim());
  return m ? build(m[1], m[2], m[3]) : undefined;
}

/** Finds the first address in pasted text: an invite, a cockpit link, a sentence. */
export function findAddress(text: string): ParsedAddress | undefined {
  const m = IN_TEXT.exec(String(text ?? ''));
  return m ? build(m[1], m[2], m[3]) : undefined;
}

function build(prefix: string, id: string, at: string | undefined): ParsedAddress | undefined {
  const channel = `xt_${id}`;
  if (prefix === 'xtl') return at ? undefined : { channel, hub: LOCAL_HUB, kind: 'local' };
  if (at === undefined) return { channel, kind: 'online' };
  const hub = hubUrl(at);
  if (!hub) return undefined;
  if (sameHub(hub, ONLINE_HUB)) return { channel, hub: ONLINE_HUB, kind: 'online' };
  if (sameHub(hub, LOCAL_HUB)) return { channel, hub: LOCAL_HUB, kind: 'local' };
  return { channel, hub, kind: 'custom' };
}

/** True for any of the three forms. */
export function isAddress(value: unknown): value is string {
  return parseAddress(value) !== undefined;
}

/** The `xt_<id>` a hub knows the channel by, from any form; undefined if `value` isn't an address. */
export function channelId(value: unknown): string | undefined {
  return parseAddress(value)?.channel;
}

/**
 * The one-line address of channel `channel` (any form) on `hub`: `xt_<id>` on
 * the internet hub, `xtl_<id>` on this computer's default hub, else
 * `xt_<id>@<host[:port]>`, or `xt_<id>@<full url>` when the short form wouldn't
 * read back as the same hub.
 */
export function formatAddress(channel: string, hub: string): string {
  const id = channelId(channel) ?? channel;
  if (sameHub(hub, ONLINE_HUB)) return id;
  if (sameHub(hub, LOCAL_HUB)) return id.replace(/^xt_/, 'xtl_');
  const url = hubUrl(hub);
  if (!url) return id;
  const short = url.replace(/^wss?:\/\//, '');
  return parseAddress(`${id}@${short}`)?.hub === url ? `${id}@${short}` : `${id}@${url}`;
}

/**
 * Where to connect for `address`: the hub it names, or `fallback` (the hub
 * you're set up for) for a plain `xt_<id>`.
 */
export function resolveAddress(address: string, fallback: string): { channel: string; hub: string } | undefined {
  const parsed = parseAddress(address);
  return parsed && { channel: parsed.channel, hub: parsed.hub ?? fallback };
}
