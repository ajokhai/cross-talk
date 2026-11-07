/**
 * Secrets agents can use without seeing (2.20+).
 *
 * A person pastes a key once (`crosstalk secret add NAME`, typed hidden, or the
 * web app's key box). It is kept encrypted on this machine. Agents only ever
 * see its name: `crosstalk run --secret NAME -- <command>` puts the value in
 * that one command's environment and blanks it out of what the command prints,
 * so it never lands in a chat, a transcript, the hub or another agent.
 *
 * To share a key with an agent on another machine, it is sealed to that
 * machine's public key (X25519 + HKDF + AES-256-GCM): the hub relays bytes it
 * can't read, and the receiving machine opens it straight into its own store.
 *
 * What this does not do: an agent with a shell on the same machine could
 * still deliberately print the value inside a command it runs. The point is
 * that keys never pass through the conversation by accident.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Transform, type TransformCallback } from 'node:stream';

/** Names look like environment variables: GITHUB_TOKEN, OPENAI_API_KEY. */
export const SECRET_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const MAX_VALUE = 16 * 1024;

export function secretsDir(): string {
  return process.env.CROSSTALK_SECRETS_DIR || path.join(os.homedir(), '.crosstalk', 'secrets');
}

interface StoredSecret {
  name: string;
  /** base64: 12-byte IV | ciphertext | 16-byte tag, under the machine's vault key. */
  box: string;
  at: number;
  /** Where it came from: "typed", "web", or "shared by <name>". */
  from?: string;
  /** Only these agent names may use it through `crosstalk run` (empty: any agent on this machine). */
  agents?: string[];
}

export interface SecretInfo { name: string; at: number; from?: string; agents?: string[] }

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writePrivate(file: string, data: string | Buffer): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** The key that encrypts the store, made on first use. */
function vaultKey(dir: string): Buffer {
  const file = path.join(dir, 'vault.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length === 32) return key;
  } catch { /* first use */ }
  const key = crypto.randomBytes(32);
  writePrivate(file, key.toString('base64') + '\n');
  return key;
}

function seal32(key: Buffer, plain: Buffer, aad: string): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]);
}

function open32(key: Buffer, box: Buffer, aad: string): Buffer {
  if (box.length < 28) throw new Error('Damaged secret');
  const d = crypto.createDecipheriv('aes-256-gcm', key, box.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(box.subarray(box.length - 16));
  return Buffer.concat([d.update(box.subarray(12, box.length - 16)), d.final()]);
}

function load(dir: string): StoredSecret[] {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
    return Array.isArray(data?.secrets) ? data.secrets.filter((s: any) => typeof s?.name === 'string' && typeof s?.box === 'string') : [];
  } catch {
    return [];
  }
}

function store(dir: string, secrets: StoredSecret[]): void {
  writePrivate(path.join(dir, 'secrets.json'), JSON.stringify({ secrets }, null, 2) + '\n');
}

export function checkName(name: string): string {
  const n = name.trim().toUpperCase();
  if (!SECRET_NAME.test(n)) throw new Error(`"${name}" isn't a usable secret name: use letters, digits and _ like GITHUB_TOKEN`);
  return n;
}

export function addSecret(name: string, value: string, options: { from?: string; agents?: string[]; dir?: string } = {}): SecretInfo {
  const dir = options.dir ?? secretsDir();
  const n = checkName(name);
  const v = value.replace(/\r?\n$/, '');
  if (!v) throw new Error('The secret is empty');
  if (Buffer.byteLength(v) > MAX_VALUE) throw new Error('That secret is too long (16 KB at most)');
  const box = seal32(vaultKey(dir), Buffer.from(v), n).toString('base64');
  const entry: StoredSecret = { name: n, box, at: Date.now(), ...(options.from ? { from: options.from } : {}), ...(options.agents?.length ? { agents: options.agents } : {}) };
  store(dir, [...load(dir).filter(s => s.name !== n), entry]);
  return { name: n, at: entry.at, from: entry.from, agents: entry.agents };
}

/** Names and details only: values never leave this module except into a command's environment. */
export function listSecrets(dir = secretsDir()): SecretInfo[] {
  return load(dir).map(({ name, at, from, agents }) => ({ name, at, from, agents }));
}

export function removeSecret(name: string, dir = secretsDir()): boolean {
  const n = checkName(name);
  const all = load(dir);
  const rest = all.filter(s => s.name !== n);
  if (rest.length === all.length) return false;
  store(dir, rest);
  return true;
}

function reveal(name: string, agent: string | undefined, dir: string): string {
  const n = checkName(name);
  const s = load(dir).find(x => x.name === n);
  if (!s) throw new Error(`No secret called ${n} on this machine. Ask your user to add it: crosstalk secret add ${n}`);
  if (s.agents?.length && !(agent && s.agents.some(a => a.toLowerCase() === agent.toLowerCase()))) {
    throw new Error(`${n} is only for ${s.agents.join(', ')}${agent ? `, not ${agent}` : ''}`);
  }
  return open32(vaultKey(dir), Buffer.from(s.box, 'base64'), n).toString();
}

/**
 * Replaces every occurrence of the given values in a stream, including ones
 * split across chunks, with "[secret NAME]".
 */
export class Redactor extends Transform {
  private tail = '';
  private readonly keep: number;
  private readonly pairs: [string, string][];

  constructor(values: Map<string, string>) {
    super();
    // Longest first, so a secret containing another is blanked whole. Very short
    // values (under 4 characters) would blank ordinary output, so they're skipped.
    this.pairs = [...values].filter(([, v]) => v.length >= 4).sort((a, b) => b[1].length - a[1].length).map(([n, v]) => [v, `[secret ${n}]`]);
    this.keep = Math.max(0, ...this.pairs.map(([v]) => v.length - 1));
  }

  redact(text: string): string {
    for (const [value, label] of this.pairs) text = text.split(value).join(label);
    return text;
  }

  _transform(chunk: Buffer | string, _enc: BufferEncoding, done: TransformCallback): void {
    const text = this.redact(this.tail + chunk.toString());
    // Hold back enough to catch a value split across this chunk and the next.
    const cut = Math.max(0, text.length - this.keep);
    this.tail = text.slice(cut);
    done(null, text.slice(0, cut));
  }

  _flush(done: TransformCallback): void {
    done(null, this.redact(this.tail));
  }
}

/**
 * Runs a command with the named secrets in its environment and its output
 * redacted. Resolves with the exit code.
 */
export function runWithSecrets(names: string[], command: string, args: string[], options: { agent?: string; dir?: string; stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream; cwd?: string } = {}): Promise<number> {
  const dir = options.dir ?? secretsDir();
  const values = new Map<string, string>();
  try {
    for (const name of names) values.set(checkName(name), reveal(name, options.agent, dir));
  } catch (err) {
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...Object.fromEntries(values) }, stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout!.pipe(new Redactor(values)).pipe(options.stdout ?? process.stdout, { end: false });
    child.stderr!.pipe(new Redactor(values)).pipe(options.stderr ?? process.stderr, { end: false });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

// ---- Sharing between machines: sealed to the receiver's public key

/** This machine's identity for receiving sealed secrets (X25519), made on first use. */
export function sealIdentity(dir = secretsDir()): { publicKey: string; privateKey: crypto.KeyObject } {
  const file = path.join(dir, 'identity.pem');
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(file, 'utf8'));
  } catch {
    privateKey = crypto.generateKeyPairSync('x25519').privateKey;
    writePrivate(file, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
  }
  const raw = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  return { publicKey: `xs_${raw.toString('base64url')}`, privateKey };
}

function x25519Public(publicKey: string): crypto.KeyObject {
  if (!/^xs_[A-Za-z0-9_-]{43}$/.test(publicKey)) throw new Error('Not a CrossTalk sealing key (xs_…)');
  const prefix = Buffer.from('302a300506032b656e032100', 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([prefix, Buffer.from(publicKey.slice(3), 'base64url')]), format: 'der', type: 'spki' });
}

function boxKey(shared: Buffer, ephemeral: Buffer, recipient: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', shared, ephemeral, `crosstalk-secret-v1|${recipient}`, 32));
}

/** Seals a secret so only the holder of `recipient`'s private key can open it. */
export function sealSecret(recipient: string, name: string, value: string): string {
  const n = checkName(name);
  const eph = crypto.generateKeyPairSync('x25519');
  const ephRaw = eph.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: x25519Public(recipient) });
  const box = seal32(boxKey(shared, ephRaw, recipient), Buffer.from(value), n);
  return `xsb1.${ephRaw.toString('base64url')}.${box.toString('base64url')}`;
}

/** Opens a sealed secret addressed to this machine. Throws if it was for someone else or was changed. */
export function openSealed(sealed: string, name: string, dir = secretsDir()): string {
  const [v, eph, box] = sealed.split('.');
  if (v !== 'xsb1' || !eph || !box) throw new Error('Not a sealed CrossTalk secret');
  const me = sealIdentity(dir);
  const ephRaw = Buffer.from(eph, 'base64url');
  const ephKey = x25519Public(`xs_${eph}`);
  const shared = crypto.diffieHellman({ privateKey: me.privateKey, publicKey: ephKey });
  return open32(boxKey(shared, ephRaw, me.publicKey), Buffer.from(box, 'base64url'), checkName(name)).toString();
}

/** Reads a line without echoing it (a terminal), or all of stdin (piped from a password manager). */
export async function readHidden(prompt: string, input: NodeJS.ReadStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Promise<string> {
  if (!input.isTTY) {
    let data = '';
    for await (const chunk of input) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (err?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.off('data', on);
      output.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const on = (buf: Buffer) => {
      for (const ch of buf.toString()) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    input.on('data', on);
  });
}
