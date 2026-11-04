import { spawn, execFileSync, type ChildProcess } from 'node:child_process';

/**
 * An outbound tunnel to the hub's public listener (#13). The tunnel process
 * connects out to Cloudflare and forwards public HTTPS/WSS traffic back to
 * 127.0.0.1:<port>, so no inbound port is opened on this machine or router.
 * `cloudflared` is optional: without it, bring any tunnel or reverse proxy and
 * pass its URL with `--public-url`.
 */

export interface Tunnel {
  /** Public base URL, e.g. https://quiet-lake-1234.trycloudflare.com */
  url: string;
  /** Stops the tunnel; the public URL stops working at once. */
  close(): void;
  /** Resolves when the tunnel process exits, with its exit code. */
  exited: Promise<number | null>;
}

export function hasCloudflared(bin = process.env.CROSSTALK_CLOUDFLARED || 'cloudflared'): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** The quick-tunnel URL in a line of cloudflared's log, if there is one. */
export function parseTunnelUrl(line: string): string | undefined {
  return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(line)?.[0];
}

/** Starts a Cloudflare quick tunnel to 127.0.0.1:`port` and resolves once it has a public URL. */
export function startQuickTunnel(port: number, options: { bin?: string; timeoutMs?: number } = {}): Promise<Tunnel> {
  const bin = options.bin ?? (process.env.CROSSTALK_CLOUDFLARED || 'cloudflared');
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    const exited = new Promise<number | null>(done => child.once('exit', code => done(code)));
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('cloudflared did not report a public URL in time'));
    }, options.timeoutMs ?? 30_000);
    const scan = (chunk: Buffer) => {
      if (settled) return;
      const url = parseTunnelUrl(chunk.toString());
      if (!url) return;
      settled = true;
      clearTimeout(timer);
      resolve({ url, exited, close: () => void child.kill('SIGTERM') });
    };
    child.stdout!.on('data', scan);
    child.stderr!.on('data', scan);
    child.once('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    void exited.then(code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (code ${code}) before it had a public URL`));
    });
  });
}
