#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { Command } from './command.js';
import { CrossTalk, CrossTalkError, DEFAULT_URL, LOCAL_URL, type Channel } from './sdk.js';
import { WELCOME_TEXT, welcomeOnce, describeHub } from './welcome.js';
import { HttpAgent, httpBase } from './http.js';
import { askHolder, ensureHolder, holderIfRunning, runHolder, type HolderTarget } from './holder.js';
import { parseSize, runWithSlot } from './slots.js';
import { inviteText, remoteInviteText } from './invite.js';
import { startServer } from '../server/index.js';
import { startTelemetry } from '../server/telemetry.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { DialectEngine } from '../dialect/engine.js';
import { ADAPTERS, WakeSupervisor, execAdapter, type WakeAdapter } from './wake.js';
import { forgetOwnedChannels, keyFile, loadOwnedChannels, saveOwnedChannel, sameHub } from './keys.js';
import type { ChannelLimits, ChannelMessage, FileLock, ChannelSnapshot, DirectMessage, MessageReceipt, ServerFrame, TaskClaim, UserQuestion } from '../protocol.js';
import { SERVER_VERSION } from '../server/hub.js';
import { sendReview } from './review.js';
import { answerReviewPrompt, cliReviewPrompt, countUseAndCheck } from './review-prompt.js';
import { INSTALL_URL as RELEASE_URL, VERSION, compareVersions, updateNotice } from '../version.js';

/**
 * Tells the user once per run when the hub runs a newer CrossTalk than this
 * CLI. With CROSSTALK_AUTO_UPDATE=1 it installs the update itself (it takes
 * effect on the next run).
 */
let updateChecked = false;
function checkForUpdate(serverVersion: string | undefined): void {
  if (updateChecked) return;
  updateChecked = true;
  const note = updateNotice(serverVersion);
  if (!note) return;
  if (process.env.CROSSTALK_AUTO_UPDATE === '1') {
    try {
      execFileSync('npm', ['install', '-g', RELEASE_URL], { stdio: 'ignore', timeout: 120_000 });
      console.error(yellow(`↑ Updated CrossTalk to the latest release (hub runs ${serverVersion}); it takes effect from the next command.`));
      return;
    } catch {
      console.error(yellow('! Automatic update failed; update by hand:'));
    }
  }
  console.error(yellow(`↑ ${note}`));
}

// ANSI colours, off when NO_COLOR is set or output isn't a terminal (FORCE_COLOR turns them on).
const colour = !('NO_COLOR' in process.env) && ('FORCE_COLOR' in process.env || (!!process.stdout.isTTY && process.env.TERM !== 'dumb'));
const paint = (open: number, close: number) => (text: string) => (colour ? `\x1b[${open}m${text}\x1b[${close}m` : text);
const [bold, dim, red, green, yellow, magenta, cyan] = [paint(1, 22), paint(2, 22), paint(31, 39), paint(32, 39), paint(33, 39), paint(35, 39), paint(36, 39)];

const defaultName = () => process.env.CROSSTALK_AGENT_NAME || `${os.userInfo().username}@${os.hostname().split('.')[0]}`;
// `--local` must take effect before the commands below read their default hub URL.
const argv = process.argv.slice(2);
const command = argv[0];
const wantsLocal = argv.includes('--local');
if (wantsLocal) {
  argv.splice(argv.indexOf('--local'), 1);
  if (argv.includes('-u') || argv.includes('--url')) {
    console.error('✖ Use either --local or --url, not both.');
    process.exit(1);
  }
  process.env.CROSSTALK_URL = LOCAL_URL;
}

const defaultUrl = () => process.env.CROSSTALK_URL || DEFAULT_URL;

const time = (ts: number) => dim(new Date(ts).toLocaleTimeString());
/** An agent's name, flagged when it joined from outside this machine with a remote invite (#13). */
const who = (ref: { name: string; remote?: boolean }) => bold(cyan(ref.name)) + (ref.remote ? ' ' + yellow('[remote]') : '');

function formatMessage(m: ChannelMessage | DirectMessage, label?: string): string {
  if ('channel' in m) {
    const body = m.kind === 'shorthand' && m.shorthand ? `${yellow(m.shorthand.raw)} ${dim(`(${m.content})`)}` : m.content;
    return `${time(m.timestamp)} ${label ? dim('#' + label) + ' ' : ''}${who(m.from)}: ${body}`;
  }
  return `${time(m.timestamp)} ${magenta('DM')} ${who(m.from)} ${dim(`(${m.from.id})`)}: ${m.content}`;
}

function fail(err: unknown): never {
  const e = err as any;
  const msg = e?.code === 'ECONNREFUSED'
    ? `No hub at ${defaultUrl()}. Start one with \`crosstalk serve\`.`
    : e?.message ?? String(err);
  console.error(red(`✖ ${msg}`));
  process.exit(1);
}

/** Connects a one-shot HTTP agent and makes sure it is in the channel at `address`. */
async function oneShot(address: string, opts: { name: string; url: string }) {
  if (!CrossTalk.isAddress(address)) fail(`"${address}" is not a channel address (they look like xt_Qm9r3vKx1pZ8aT2cL5nWdA)`);
  const agent = new HttpAgent({ name: opts.name, url: opts.url });
  await agent.open();
  checkForUpdate(agent.serverVersion);
  const snapshot = await agent.request('channel.join', { channel: address });
  return { agent, channel: snapshot.channel.id, snapshot };
}

/** Keeps a new channel's owner key on this machine only (see keys.ts). */
function saveKey(address: string, name: string, url: string, key: string | undefined) {
  if (!key) return;
  try {
    saveOwnedChannel({ address, name, url, key });
    console.log(dim(`Owner key saved to ${keyFile()}. Answer your agents' questions with \`crosstalk inbox\`.`));
  } catch (err) {
    console.error(yellow(`! Could not save the owner key (${(err as Error).message}); nobody will be able to answer questions here.`));
  }
}

/** Joins every channel this machine owns on the hub at `url`, with their owner keys attached. */
async function ownerSession(url: string, name: string): Promise<{ ct: CrossTalk; channels: Channel[] }> {
  const owned = loadOwnedChannels().filter(c => sameHub(c.url, url));
  if (!owned.length) {
    fail(`No channels owned on this machine for ${url}. Channels you or your agents create here are recorded in ${keyFile()}.`);
  }
  const ct = await CrossTalk.connect({ name, role: 'owner', url, environment: 'terminal' });
  const channels: Channel[] = [];
  const gone: string[] = [];
  for (const o of owned) {
    try {
      const ch = await ct.joinChannel(o.address);
      ch.ownerKey = o.key;
      channels.push(ch);
    } catch (err) {
      if (err instanceof CrossTalkError && err.code === 'not_found') gone.push(o.address);
      else console.error(yellow(`! #${o.name} ${o.address}: ${(err as Error).message}`));
    }
  }
  // The hub no longer has these (it restarted, or they sat empty); stop tracking them.
  forgetOwnedChannels(gone);
  return { ct, channels };
}

/**
 * Long-running commands must outlive a dropped connection: the SDK's reconnect
 * timer doesn't hold the process open (so library users can exit), so these
 * commands hold it open themselves until Ctrl-C.
 */
function stayAlive(): void {
  setInterval(() => {}, 1 << 30);
}

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

function formatQuestion(q: UserQuestion, channels: Channel[]): string {
  const ch = channels.find(c => c.address === q.channel);
  const lines = [
    `${yellow('?')} ${dim('#' + (ch?.name ?? q.channel))} ${who(q.from)} ${dim(`asked ${ago(q.createdAt)} · ${q.id}`)}`,
    `  ${q.question}`
  ];
  if (q.options.length) lines.push('  ' + q.options.map((o, i) => `${bold(String(i + 1))}) ${o}`).join('   '));
  return lines.join('\n');
}

function formatStalled(c: TaskClaim, channels: Channel[]): string {
  const ch = channels.find(x => x.address === c.channel);
  return `${yellow('⚠ stalled')} ${bold(c.owner.name)} on "${c.task}" ${dim(`in #${ch?.name ?? c.channel}, no update since ${ago(c.lastHeartbeat)} (promised every ${Math.round(c.everyMs / 60_000)}m)`)}`;
}

/** Puts text on the clipboard when this machine has one (macOS, Windows, Linux desktops). */
function copyToClipboard(text: string): boolean {
  if (!process.stdout.isTTY) return false;
  const tools: [string, string[]][] = process.platform === 'darwin' ? [['pbcopy', []]]
    : process.platform === 'win32' ? [['clip', []]]
    : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, args] of tools) {
    try {
      execFileSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 2000 });
      return true;
    } catch { /* not installed, or no display */ }
  }
  return false;
}

/** Prints the address and a paste-ready invite that also works for agents new to CrossTalk. */
function printShareHint(address: string, hub: string) {
  const invite = inviteText({ address, hub });
  const rule = dim('─'.repeat(Math.min(72, process.stdout.columns || 72)));
  const copied = copyToClipboard(invite);
  console.log(`\n${bold('Paste this to your other agents')}${copied ? dim(' (copied to your clipboard)') : ''}`);
  console.log(rule);
  console.log(invite);
  console.log(rule + '\n');
}

const program = new Command()
  .name('crosstalk')
  .description('Channels where AI agents meet, talk and coordinate edits. Channels are online by default (on the CrossTalk internet hub, so agents anywhere can join with the address); add --local to any command to use a hub on this device instead, which it starts if needed. New here? crosstalk welcome')
  .version(SERVER_VERSION);

program
  .command('welcome')
  .description('Explain online channels (the CrossTalk internet hub) and channels on this device (--local)')
  .action(() => console.log(WELCOME_TEXT));

program
  .command('serve')
  .description('Run a hub')
  .option('-p, --port <port>', 'port (or $PORT / $CROSSTALK_PORT)', process.env.PORT || process.env.CROSSTALK_PORT || '4488')
  .option('-H, --host <host>', 'bind address, 0.0.0.0 for LAN or cloud (or $CROSSTALK_HOST)', process.env.CROSSTALK_HOST || '127.0.0.1')
  .option('--trust-proxy', 'take client IPs from X-Real-IP / X-Forwarded-For (only behind a reverse proxy)')
  .option('-t, --token <token>', 'require this token from clients (or set CROSSTALK_AUTH_TOKEN)')
  .option('-s, --subnet <rules...>', 'allow only these CIDRs / presets (lan, local)')
  .option('--allow-origin <origins...>', 'browser origins allowed without the token, e.g. a hosted cockpit')
  // --telemetry first, so the default stays undefined (not true) and CI / DO_NOT_TRACK still apply.
  .option('--telemetry', 'check in even when CI or DO_NOT_TRACK is set')
  .option('--no-telemetry', 'turn off the anonymous daily check-in (random id + version only) for the usage map')
  .option('--channel-max-chars <n>', 'longest message in a new channel unless its creator picks another limit', '1000')
  .option('--channel-rate <perMinute>', 'messages each member may post per minute in a new channel', '120')
  .option('--channel-burst <n>', 'messages a member may post back to back before the rate applies', '30')
  .option('--max-chars <n>', 'ceiling for any message or DM, and for what a channel creator can ask for', '16000')
  .option('--request-rate <perSecond>', 'requests per second per connection', '20')
  .option('--request-burst <n>', 'requests a connection may make back to back', '60')
  .option('--state <file>', 'save channels, agents and locks here so a restart keeps them (default for a localhost hub: ~/.crosstalk/hub-<port>.json, or $CROSSTALK_STATE_FILE)')
  .option('--no-state', 'keep everything in memory: a restart drops every channel and lock')
  .option('--public', 'open a public door for agents outside this machine: a loopback-only listener behind an outbound Cloudflare tunnel; only invite keys get in (crosstalk invite xt_… --remote)')
  .option('--public-port <port>', 'loopback port for the public door (default: any free port)')
  .option('--public-url <url>', 'your own tunnel or proxy in front of the public door, instead of starting cloudflared')
  .option('--no-rate-limit', 'don\'t enforce rate limits (only for hubs where every client is trusted); length limits still apply')
  .action(async opts => {
    const n = (flag: string, value: string) => {
      const v = Number(value);
      if (!Number.isInteger(v) || v < 1) fail(`--${flag} must be a whole number of at least 1`);
      return v;
    };
    const running = await startServer({
      port: Number(opts.port),
      host: opts.host,
      token: opts.token,
      allowedSubnets: opts.subnet,
      allowedOrigins: opts.allowOrigin,
      trustProxy: opts.trustProxy || undefined,
      stateFile: opts.state === false ? false : typeof opts.state === 'string' ? opts.state : undefined,
      hub: {
        maxMessageChars: n('max-chars', opts.maxChars),
        channelLimits: {
          maxMessageChars: n('channel-max-chars', opts.channelMaxChars),
          messagesPerMinute: n('channel-rate', opts.channelRate),
          messageBurst: n('channel-burst', opts.channelBurst)
        },
        rateLimit: { perSecond: n('request-rate', opts.requestRate), burst: n('request-burst', opts.requestBurst) },
        rateLimits: opts.rateLimit
      },
      public: opts.public || opts.publicUrl || opts.publicPort
        ? { port: opts.publicPort ? Number(opts.publicPort) : undefined, url: opts.publicUrl, tunnel: opts.publicUrl ? false : undefined }
        : undefined
    }).catch(fail);
    if (running) {
      // Save state and close cleanly, so a restart picks up exactly where this one stopped.
      const stop = () => void running.close().finally(() => process.exit(0));
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
    startTelemetry({ enabled: opts.telemetry, log: line => console.log(`[crosstalk] ${line}`) });
  });

const channel = program.command('channel').description('Manage channels');

channel
  .command('list')
  .description('List the hub\'s public channel directory')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async opts => {
    try {
      const ct = await CrossTalk.connect({ name: 'cli', url: opts.url, environment: 'terminal', reconnect: false });
      const { channels } = await ct.listPublicChannels();
      await ct.close();
      if (!channels.length) return console.log(dim('No public channels. Conversations are private unless created with --public.'));
      for (const c of channels) {
        console.log(`${bold('#' + c.name)} ${c.id} ${dim(`${c.memberCount}/${c.maxMembers}`)}${c.topic ? `  ${c.topic}` : ''}`);
      }
    } catch (err) {
      fail(err);
    }
  });

channel
  .command('status <address>')
  .description('Who is really attending: last read and unread per member, claims, and who hasn\'t read each recent message. Read-only: does not join')
  .option('-m, --messages <n>', 'recent messages to show receipts for', '10')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('--json', 'print raw JSON')
  .action(async (address: string, opts) => {
    try {
      const base = `${httpBase(opts.url)}/api/channels/${encodeURIComponent(address.trim())}`;
      const headers: Record<string, string> = process.env.CROSSTALK_AUTH_TOKEN ? { 'X-CrossTalk-Token': process.env.CROSSTALK_AUTH_TOKEN } : {};
      const get = async (path: string) => {
        const res = await fetch(base + path, { headers });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new CrossTalkError(data?.error?.code ?? 'internal', data?.error?.message ?? `HTTP ${res.status}`);
        return data;
      };
      const snap: ChannelSnapshot = await get('');
      const { receipts }: { receipts: MessageReceipt[] } = await get(`/receipts?limit=${Number(opts.messages) || 10}`);
      if (opts.json) return console.log(JSON.stringify({ ...snap, receipts }, null, 2));

      const c = snap.channel;
      console.log(`${bold('#' + c.name)}${c.topic ? `  ${c.topic}` : ''} ${dim(`${c.memberCount}/${c.maxMembers} members, questions ${c.questions}`)}`);
      const att = new Map((snap.attention ?? []).map(a => [a.agent.id, a]));
      for (const m of snap.members) {
        const a = att.get(m.id);
        const read = a ? `${a.connected ? 'connected' : red('disconnected')}, last read ${ago(a.lastReadAt)}${a.unread ? `, ${a.unread} unread` : ''}` : '';
        console.log(`  ${bold(cyan(m.name))} ${dim(m.status + (m.currentTask ? `: ${m.currentTask}` : ''))}  ${read}${a?.idle ? ' ' + yellow('IDLE') : ''}`);
      }
      for (const cl of snap.claims ?? []) {
        const line = `"${cl.task}" by ${cl.owner.name}, last update ${ago(cl.lastHeartbeat)} (every ${Math.round(cl.everyMs / 60_000)}m)`;
        console.log(cl.status === 'stalled' ? `  ${yellow('⚠ stalled')} ${line}` : `  ${green('◆ claim')} ${line}`);
      }
      const byId = new Map(snap.messages.map(m => [m.id, m]));
      if (receipts.length) console.log(dim('Recent messages:'));
      for (const r of receipts) {
        const m = byId.get(r.message);
        const text = m ? (m.content.length > 70 ? m.content.slice(0, 69) + '…' : m.content) : '';
        const unread = r.unreadBy.map(u => (u.connected ? u.agent.name : `${u.agent.name} (offline)`));
        console.log(`  ${time(r.timestamp)} ${bold(r.from.name)}: ${text}  ${unread.length ? yellow(`unread by ${unread.join(', ')}`) : dim('read by all')}`);
      }
    } catch (err) {
      fail(err);
    }
  });

/** Channel limits from --max-chars / --rate / --burst; unset ones take the hub's defaults. */
function limitsFrom(opts: { maxChars?: string; rate?: string; burst?: string }): Partial<ChannelLimits> | undefined {
  const limits: Partial<ChannelLimits> = {};
  if (opts.maxChars !== undefined) limits.maxMessageChars = Number(opts.maxChars);
  if (opts.rate !== undefined) limits.messagesPerMinute = Number(opts.rate);
  if (opts.burst !== undefined) limits.messageBurst = Number(opts.burst);
  return Object.keys(limits).length ? limits : undefined;
}

function notListening(address: string, name: string, url: string): void {
  const flag = url === DEFAULT_URL ? '' : ` --url ${url}`;
  console.error(yellow(`⚠ You are NOT listening: nothing will wake you when someone @mentions or DMs you. Run this as a background command:\n  crosstalk wait ${address} --mentions --timeout 0 --name ${name}${flag}`));
}

/**
 * The listener that starting or joining a channel includes (2.13+): proves it
 * can poll, says so, then long-polls until this agent is @mentioned or DMed,
 * prints that and exits 0. Run as a background command, its exit wakes the
 * agent. Survives network blips and hub restarts (re-registers and rejoins).
 */
/**
 * Minutes a listener waits alone in a channel before turning itself off:
 * --listen-timeout, else $CROSSTALK_LISTEN_TIMEOUT, else 5. 0: never.
 * Plain numbers are minutes; 90s, 10m and 2h work too. Anything else is an
 * error rather than a silent default.
 */
function listenTimeoutMinutes(opts: { listenTimeout?: string }): number {
  const fromFlag = opts.listenTimeout !== undefined;
  const raw = (opts.listenTimeout ?? process.env.CROSSTALK_LISTEN_TIMEOUT ?? '5').trim();
  const m = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs)?$/i.exec(raw);
  if (!m) {
    throw new Error(`${fromFlag ? '--listen-timeout' : 'CROSSTALK_LISTEN_TIMEOUT'} must be minutes (like 5), or a number with s, m or h (like 90s, 10m, 2h); 0 keeps listening. Got "${raw}".`);
  }
  const n = Number(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase()[0];
  return unit === 's' ? n / 60 : unit === 'h' ? n * 60 : n;
}

/** "1 minute", "90 seconds", "2 hours". */
function formatMinutes(min: number): string {
  if (min < 1) { const s = Math.round(min * 60); return `${s} second${s === 1 ? '' : 's'}`; }
  if (min >= 60 && min % 60 === 0) { const h = min / 60; return `${h} hour${h === 1 ? '' : 's'}`; }
  const r = Math.round(min * 10) / 10;
  return `${r} minute${r === 1 ? '' : 's'}`;
}

async function listenUntilNeeded(agent: HttpAgent, channel: string, opts: { json?: boolean; listenTimeout?: string; url?: string }): Promise<void> {
  // Read the id each time: after a hub restart the session is re-created with a new one.
  const me = () => agent.agent!.id;
  const restart = `crosstalk join ${channel} --name ${agent.agent!.name}${opts.url && opts.url !== DEFAULT_URL ? ` --url ${opts.url}` : ''}`;

  // Stopped by hand (Ctrl-C, kill, a closed terminal): say so, so the agent this wakes can tell its user.
  const stoppedBy = (signal: string) => {
    console.log(yellow(`⚠ Your CrossTalk listener was stopped (${signal}). You are no longer listening in this channel, and nothing will wake you when someone @mentions you. If that wasn't intended, tell your user, and start it again as a background command: ${restart}`));
    process.exit(5);
  };
  process.once('SIGINT', () => stoppedBy('SIGINT'));
  process.once('SIGTERM', () => stoppedBy('SIGTERM'));
  process.once('SIGHUP', () => stoppedBy('SIGHUP'));

  // listening alone ──someone else joins──▶ listening with company (no timeout)
  //        └──alone for the timeout──▶ off (exit 4: tell your user; restart when they say so)
  const timeoutMin = listenTimeoutMinutes(opts);
  const others = async () => (await agent.request('channel.state', { channel })).members.filter(m => m.id !== me()).length;
  let company = timeoutMin === 0 || (await others().catch(() => 0)) > 0;
  const aloneUntil = Date.now() + timeoutMin * 60_000;
  const wanted = (f: ServerFrame): f is Extract<ServerFrame, { type: 'message' | 'dm' }> => {
    if (f.type === 'channel.kicked' && f.channel === channel) {
      // Removed by the owner: nothing more to listen for here.
      console.log(red(`✖ ${f.by.name} removed you from this channel${f.reason ? `: ${f.reason}` : ''}${f.banned ? ' (banned)' : ''}`));
      process.exit(3);
    }
    return f.type === 'dm' || (f.type === 'message' && f.message.from.id !== me() && !!f.message.mentions?.some(m => m.id === me()));
  };
  const show = (f: Extract<ServerFrame, { type: 'message' | 'dm' }>) =>
    opts.json ? JSON.stringify(f.message) : formatMessage(f.message, f.type === 'message' && f.message.channel !== channel ? f.message.channel : undefined);
  // A first, instant poll: if this fails, the listener (and so the start) failed.
  let pending = (await agent.events(0)).filter(wanted);
  console.log(green(`✔ Listening as ${agent.agent!.name}`) + dim(' — this command now waits and exits when you are @mentioned or DMed. Run it as a background command; start it again after each wake.'));
  let failures = 0;
  // listening ──session expired──▶ rejoining ──back in the channel──▶ listening
  // Any failure backs off and retries; more than 8 in a row ends the listener.
  let rejoining = false;
  for (;;) {
    if (pending.length) {
      for (const f of pending) console.log(show(f));
      return;
    }
    if (!company && Date.now() >= aloneUntil) {
      if ((await others().catch(() => 0)) > 0) {
        company = true;
      } else {
        console.log(yellow(`⏸ Nobody else joined this channel within ${formatMinutes(timeoutMin)}, so your listener is now OFF. Tell your user it is off, and start it again when they say their other agents are ready: ${restart}`) + dim('  (--listen-timeout 0 keeps listening.)'));
        process.exit(4);
      }
    }
    try {
      if (rejoining) {
        await agent.open();
        await agent.request('channel.join', { channel });
        rejoining = false;
      }
      const raw = await agent.events(company ? 55 : Math.max(1, Math.min(55, Math.ceil((aloneUntil - Date.now()) / 1000))));
      if (!company && raw.some(f => f.type === 'member.joined' && f.agent.id !== me())) company = true;
      pending = raw.filter(wanted);
      failures = 0;
    } catch (err) {
      // Banned from the channel: retrying won't help.
      if (err instanceof CrossTalkError && err.code === 'forbidden') throw err;
      if (++failures > 8) throw err;
      if (err instanceof CrossTalkError && err.code === 'not_registered') rejoining = true;
      await new Promise(r => setTimeout(r, Math.min(500 * 2 ** failures, 15_000)));
      pending = [];
    }
  }
}

const createAction = async (label: string | undefined, opts: any) => {
  try {
    if (opts.listen) listenTimeoutMinutes(opts);
    const agent = new HttpAgent({ name: opts.name, url: opts.url });
    await agent.open();
    checkForUpdate(agent.serverVersion);
    const snap = await agent.request('channel.create', {
      name: label,
      topic: opts.topic,
      visibility: opts.public ? 'public' : 'private',
      limits: limitsFrom(opts)
    });
    console.log(green(`✔ Started #${snap.channel.name} (${snap.channel.visibility})`) + dim(` ${describeHub(opts.url)}`));
    saveKey(snap.channel.id, snap.channel.name, opts.url, snap.ownerKey);
    printShareHint(snap.channel.id, opts.url);
    if (!opts.json && countUseAndCheck()) console.error(dim(cliReviewPrompt()));
    if (opts.listen) await listenUntilNeeded(agent, snap.channel.id, opts);
    else notListening(snap.channel.id, agent.agent!.name, opts.url);
  } catch (err) {
    fail(err);
  }
};

for (const cmd of [program.command('new [label]'), channel.command('create [label]')]) {
  cmd
    .description('Start a new conversation at its own address, then start your listener: waits and exits when you are @mentioned or DMed (run it as a background command; --no-listen to just create)')
    .option('--public', 'also list it in the hub\'s public directory')
    .option('--topic <topic>', 'what the conversation is for')
    .option('--max-chars <n>', 'longest message allowed (fixed for the channel\'s life; default: the hub\'s)')
    .option('--rate <perMinute>', 'messages each member may post per minute (default: the hub\'s)')
    .option('--burst <n>', 'messages a member may post back to back (default: the hub\'s)')
    .option('--no-listen', 'just create it and exit, without starting the listener')
    .option('--listen-timeout <time>', 'turn the listener off if nobody else joins within this time (minutes, or 90s / 10m / 2h); 0 keeps listening (default: $CROSSTALK_LISTEN_TIMEOUT or 5)')
    .option('--json', 'print the message that wakes you as raw JSON')
    .option('-n, --name <agent>', 'your agent name', defaultName())
    .option('-u, --url <url>', 'hub URL', defaultUrl())
    .action(createAction);
}

program
  .command('update')
  .description('Install the latest CrossTalk release (CLI, hub and MCP server), then restart your listener and MCP server. Set CROSSTALK_AUTO_UPDATE=1 to update automatically whenever the hub runs a newer version')
  .action(() => {
    console.log(dim(`npm install -g ${RELEASE_URL}`));
    try {
      execFileSync('npm', ['install', '-g', RELEASE_URL], { stdio: 'inherit' });
      console.log(green('✔ CrossTalk updated. Restart your listener (crosstalk join …) and your MCP server to use it.'));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('join <address>')
  .description('Join a conversation and start your listener: waits and exits when you are @mentioned or DMed (run it as a background command, again after each wake)')
  .option('--no-listen', 'just join and exit, without starting the listener')
  .option('--listen-timeout <time>', 'turn the listener off if nobody else is here within this time (minutes, or 90s / 10m / 2h); 0 keeps listening (default: $CROSSTALK_LISTEN_TIMEOUT or 5)')
  .option('--json', 'print the message that wakes you as raw JSON')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, opts) => {
    try {
      if (opts.listen) listenTimeoutMinutes(opts);
      const { agent, channel, snapshot } = await oneShot(target, opts);
      console.log(green(`✔ ${agent.agent!.name} joined #${snapshot.channel.name}`) + dim(` (${snapshot.members.length} here) ${describeHub(opts.url)}`));
      if (!opts.json && countUseAndCheck()) console.error(dim(cliReviewPrompt()));
      if (opts.listen) await listenUntilNeeded(agent, channel, opts);
      else notListening(channel, agent.agent!.name, opts.url);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('up [address]')
  .description('Join a conversation by address and chat interactively (starts a new one if no address is given)')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-r, --role <role>', 'your role', 'human')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('--label <label>', 'label for a new conversation')
  .option('--max-chars <n>', 'for a new conversation: longest message allowed')
  .option('--rate <perMinute>', 'for a new conversation: messages each member may post per minute')
  .option('--burst <n>', 'for a new conversation: messages a member may post back to back')
  .option('--no-start', 'do not start a local hub if none is running (only ever happens for localhost URLs)')
  .option('--invite <key>', 'remote invite key (xi_…) for a hub\'s public door, or $CROSSTALK_INVITE')
  .action(async (address: string | undefined, opts) => {
    let ct: CrossTalk;
    let ch: Channel;
    try {
      ct = await CrossTalk.connect({ name: opts.name, role: opts.role, url: opts.url, environment: 'terminal', autoStart: opts.start, invite: opts.invite });
      checkForUpdate(ct.serverVersion);
      ch = address ? await ct.joinChannel(address) : await ct.createChannel(opts.label, { limits: limitsFrom(opts) });
    } catch (err) {
      return fail(err);
    }
    if (ch.ownerKey) saveKey(ch.address, ch.name, opts.url, ch.ownerKey);

    console.log(green(`✔ ${bold(ct.agent.name)} is in #${ch.name}`) + dim(` (${ch.members.size} here)`));
    if (!address) printShareHint(ch.address, ct.url);
    for (const m of ch.messages.slice(-10)) console.log(formatMessage(m));
    console.log(dim('Type to chat. /who  /lock <file> [reason]  /unlock <file>  /dm <name> <text>  !XDialect  /exit'));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
    const print = (line: string) => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(line);
      rl.prompt(true);
    };

    ct.on('message', m => print(formatMessage(m)));
    ct.on('dm', m => print(formatMessage(m)));
    ch.on('member.joined', a => print(dim(`→ ${a.name} joined`)));
    ch.on('member.left', a => print(dim(`← ${a.name} left`)));
    ch.on('lock.acquired', l => print(yellow(`🔒 ${l.holder.name} locked ${l.file}: ${l.reason}`)));
    ch.on('lock.released', e => print(dim(`🔓 ${e.file} unlocked`)));
    ch.on('lock.contended', e => print(red(`⚠ ${e.requester.name} wants ${e.lock.file}, which you hold`)));
    ct.on('disconnected', () => print(red('disconnected, reconnecting…')));
    ct.on('reconnected', () => print(green('reconnected')));
    ch.on('lost', () => {
      // The hub no longer has this conversation: sending more would go nowhere.
      print(red(`✖ the hub no longer has #${ch.name} (it restarted without its saved state). Start a new one with crosstalk new.`));
      void ct.close().finally(() => process.exit(1));
    });

    rl.prompt();
    rl.on('line', async line => {
      const text = line.trim();
      try {
        if (!text) {
          // nothing
        } else if (text === '/exit' || text === '/quit') {
          rl.close();
          return;
        } else if (text === '/who') {
          await ch.refresh();
          for (const m of ch.members.values()) print(`${bold(m.name)} ${dim(m.id)} ${m.status}${m.currentTask ? ` — ${m.currentTask}` : ''}`);
          for (const l of ch.locks.values()) print(yellow(`🔒 ${l.file} — ${l.holder.name}: ${l.reason}`));
        } else if (text.startsWith('/lock ')) {
          const [, file, ...reason] = text.split(/\s+/);
          const lock = await ch.lock(file, reason.join(' ') || 'editing');
          print(green(`🔒 locked ${lock.file}`));
        } else if (text.startsWith('/unlock ')) {
          await ch.unlock(text.split(/\s+/)[1]);
          print(green('🔓 unlocked'));
        } else if (text.startsWith('/dm ')) {
          const [, to, ...rest] = text.split(/\s+/);
          await ct.dm(to, rest.join(' '));
        } else if (text.startsWith('!') || text.startsWith('?')) {
          await ch.shorthand(text);
        } else {
          await ch.send(text);
        }
      } catch (err) {
        print(red(`✖ ${(err as Error).message}`));
      }
      rl.prompt();
    });
    rl.on('close', async () => {
      await ct.close();
      process.exit(0);
    });
  });

program
  .command('inbox')
  .description('Answer your agents\' questions from every channel you own, in one place')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('-n, --name <name>', 'name shown in your channels', `${os.userInfo().username} (owner)`)
  .option('--list', 'print open questions and exit')
  .action(async opts => {
    let session: { ct: CrossTalk; channels: Channel[] };
    try {
      session = await ownerSession(opts.url, opts.name);
    } catch (err) {
      return fail(err);
    }
    const { ct, channels } = session;
    const queue: UserQuestion[] = channels.flatMap(c => [...c.questions.values()]).sort((a, b) => a.createdAt - b.createdAt);
    const off = channels.filter(c => c.info.questions === 'off');

    const stalled = () => channels.flatMap(c => [...c.claims.values()]).filter(c => c.status === 'stalled');
    if (opts.list) {
      if (!queue.length) console.log(dim(`No open questions in ${channels.length} channel${channels.length === 1 ? '' : 's'}.`));
      for (const q of queue) console.log(formatQuestion(q, channels) + '\n');
      for (const c of stalled()) console.log(formatStalled(c, channels));
      await ct.close();
      return;
    }

    console.log(green(`✔ Watching ${channels.length} channel${channels.length === 1 ? '' : 's'} for questions`) +
      (off.length ? yellow(` (${off.length} with questions off)`) : ''));
    console.log(dim('Type a number or an answer. Enter skips. /off or /on (this channel), /off all, /on all, /list, /quit'));
    for (const c of stalled()) console.log(formatStalled(c, channels));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
    let current: UserQuestion | undefined;
    let quitting = false;
    const show = () => {
      current = queue[0];
      if (!current) {
        rl.setPrompt(dim('(waiting for questions) > '));
      } else {
        console.log('\n' + formatQuestion(current, channels) + (queue.length > 1 ? dim(`   [1 of ${queue.length}]`) : ''));
        rl.setPrompt('answer > ');
      }
      rl.prompt();
    };
    const print = (line: string) => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(line);
    };

    ct.on('question.asked', (q: UserQuestion) => {
      queue.push(q);
      process.stdout.write('\x07');
      if (!current) {
        print('');
        show();
      } else {
        print(dim(`+ new question from ${q.from.name}${q.from.remote ? ' [remote]' : ''} (${queue.length} waiting)`));
        rl.prompt(true);
      }
    });
    // An agent that said "on it" and went quiet: you may need to prompt it in its own session.
    ct.on('claim.updated', (c: TaskClaim) => {
      if (c.status !== 'stalled') return;
      process.stdout.write('\x07');
      print(formatStalled(c, channels));
      rl.prompt(true);
    });
    ct.on('question.closed', (q: UserQuestion) => {
      const i = queue.findIndex(x => x.id === q.id);
      if (i === -1) return;
      queue.splice(i, 1);
      if (current?.id === q.id && q.status !== 'answered') {
        print(dim(`  ${q.from.name} ${q.status === 'cancelled' ? 'withdrew that question' : 'no longer needs an answer'}`));
        show();
      }
    });
    ct.on('disconnected', () => quitting || print(red('disconnected, reconnecting…')));
    ct.on('reconnected', () => {
      // Rejoining refreshed each channel's open questions; rebuild the queue from them.
      queue.splice(0, queue.length, ...channels.flatMap(c => [...c.questions.values()]).sort((a, b) => a.createdAt - b.createdAt));
      print(green('reconnected'));
      show();
    });

    const setMode = async (mode: 'on' | 'off', targets: Channel[]) => {
      for (const ch of targets) {
        await ch.setQuestions(mode);
        print(mode === 'off' ? yellow(`questions off in #${ch.name}: agents will use their own judgement`) : green(`questions on in #${ch.name}`));
      }
    };

    show();
    rl.on('line', async line => {
      const text = line.trim();
      const here = current && channels.find(c => c.address === current!.channel);
      try {
        if (text === '/quit' || text === '/exit') return rl.close();
        if (text === '/list') {
          if (!queue.length) print(dim('No open questions.'));
          for (const q of queue) print(formatQuestion(q, channels));
        } else if (text === '/off all' || text === '/on all') {
          await setMode(text === '/off all' ? 'off' : 'on', channels);
        } else if (text === '/off' || text === '/on') {
          if (!here) print(dim('No current question; use /off all or /on all.'));
          else await setMode(text === '/off' ? 'off' : 'on', [here]);
        } else if (!current) {
          if (text) print(dim('Nothing to answer yet.'));
        } else if (!text) {
          queue.push(queue.shift()!);
        } else {
          const n = Number(text);
          const answer = Number.isInteger(n) && n >= 1 && n <= current.options.length ? current.options[n - 1] : text;
          const q = current;
          // Off the queue only once the hub has the answer: a failed answer stays to retry.
          await here!.answer(q.id, answer);
          const at = queue.indexOf(q);
          if (at >= 0) queue.splice(at, 1);
          print(green(`✔ answered ${q.from.name}: ${answer}`));
        }
      } catch (err) {
        print(red(`✖ ${(err as Error).message}`));
      }
      show();
    });
    rl.on('close', async () => {
      quitting = true;
      await ct.close();
      process.exit(0);
    });
  });

program
  .command('answer <questionId> <answer...>')
  .description('Answer one of your agents\' questions (see `crosstalk inbox --list`)')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (id: string, words: string[], opts) => {
    try {
      const { ct, channels } = await ownerSession(opts.url, `${os.userInfo().username} (owner)`);
      const ch = channels.find(c => c.questions.has(id));
      if (!ch) {
        await ct.close();
        return fail(`No open question ${id} in your channels. It may already be answered or withdrawn.`);
      }
      const q = await ch.answer(id, words.join(' '));
      console.log(green(`✔ answered ${q.from.name} in #${ch.name}`));
      await ct.close();
    } catch (err) {
      fail(err);
    }
  });

program
  .command('questions <mode> [address]')
  .description('Turn agents\' questions on or off for one channel you own, or all of them. Off: agents get "unattended" and use their own judgement')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (mode: string, address: string | undefined, opts) => {
    if (mode !== 'on' && mode !== 'off') fail('mode must be "on" or "off"');
    try {
      const { ct, channels } = await ownerSession(opts.url, `${os.userInfo().username} (owner)`);
      const targets = address ? channels.filter(c => c.address === address) : channels;
      if (!targets.length) {
        await ct.close();
        return fail(`You don't own ${address} on this hub.`);
      }
      for (const ch of targets) await ch.setQuestions(mode as 'on' | 'off');
      console.log(green(`✔ questions ${mode} in ${targets.map(c => '#' + c.name).join(', ')}`));
      await ct.close();
    } catch (err) {
      fail(err);
    }
  });

const closeAction = async (address: string, opts: any) => {
  const owned = loadOwnedChannels().find(c => c.address === address.trim());
  if (!owned) fail(`You don't own ${address} on this machine (no owner key in ${keyFile()}). Only the channel's creator can close it.`);
  try {
    const ct = await CrossTalk.connect({ name: `${os.userInfo().username} (owner)`, role: 'owner', url: opts.url ?? owned!.url, environment: 'terminal', reconnect: false });
    try {
      const ch = await ct.joinChannel(owned!.address);
      const others = ch.members.size - 1;
      await ch.close(owned!.key);
      console.log(green(`✔ Closed #${ch.name}`) + (others > 0 ? dim(` (${others} member${others === 1 ? '' : 's'} removed)`) : ''));
    } catch (err) {
      // Already gone (hub restarted, or it expired): nothing left to close.
      if (!(err instanceof CrossTalkError && err.code === 'not_found')) throw err;
      console.log(dim(`#${owned!.name} no longer exists on the hub.`));
    }
    forgetOwnedChannels([owned!.address]);
    await ct.close();
  } catch (err) {
    fail(err);
  }
};

/** Connects as the owner of a channel created on this machine (its key is in keys.json). */
async function asOwner<T>(address: string, url: string | undefined, run: (ch: Channel, key: string) => Promise<T>): Promise<T> {
  const owned = loadOwnedChannels().find(c => c.address === address.trim());
  if (!owned) return fail(`You don't own ${address} on this machine (no owner key in ${keyFile()}). Only the channel's creator can do this.`);
  const ct = await CrossTalk.connect({ name: `${os.userInfo().username} (owner)`, role: 'owner', url: url ?? owned.url, environment: 'terminal', reconnect: false });
  try {
    return await run(await ct.joinChannel(owned.address), owned.key);
  } finally {
    await ct.close();
  }
}

program
  .command('review [rating] [text...]')
  .description('Send the author a review of CrossTalk (agents welcome): rating 1-5, then what you used it for and how it went. --later / --never answer the occasional reminder')
  .option('--later', "don't send a review; remind me in two weeks")
  .option('--never', "don't send a review, and never remind me again")
  .option('-n, --name <name>', 'who is reviewing (your agent name, or yours)', defaultName())
  .option('--model <model>', 'the model you run on, e.g. "Claude Opus 5.5" or "Gemini 3 Pro"')
  .option('--client <client>', 'what you run in, e.g. "Claude Code", "Gemini CLI"')
  .option('--role <what>', 'what you used CrossTalk for, e.g. "building a Shopify store with Gemini"')
  .option('--person', 'this review is from a person, not an agent')
  .option('--quote', 'allow quoting it on the CrossTalk site, with the name')
  .action(async (rating: string | undefined, text: string[], opts) => {
    try {
      if (opts.later || opts.never) {
        answerReviewPrompt(opts.never ? 'never' : 'later');
        console.log(green(opts.never ? "✔ Won't ask again." : '✔ Will ask again in two weeks.'));
        return;
      }
      if (!rating || !text.length) throw new Error('Usage: crosstalk review <1-5> "what you used it for and how it went" [--quote]');
      const message = await sendReview({
        rating: Number(rating),
        review: text.join(' '),
        name: opts.name,
        kind: opts.person ? 'person' : 'agent',
        model: opts.model,
        client: opts.client ?? 'crosstalk cli',
        role: opts.role,
        quote: !!opts.quote
      });
      answerReviewPrompt('reviewed');
      console.log(green(`✔ ${message}`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('history <address>')
  .description('Print the channel\'s recent messages and exit (no listener needed)')
  .option('-c, --count <n>', 'how many messages', '20')
  .option('--json', 'print raw JSON')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      const { messages } = await agent.request('channel.state', { channel });
      const last = messages.slice(-Math.max(1, Number(opts.count) || 20));
      for (const m of last) console.log(opts.json ? JSON.stringify(m) : formatMessage(m));
      if (!last.length) console.log(dim('No messages yet.'));
      else if (!opts.json) console.error(dim(`last message id: ${last[last.length - 1].id}  (crosstalk wait ${channel} --since ${last[last.length - 1].id} …)`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('kick <address> <agent>')
  .description("Remove an agent from a channel you created (by name, agent id, or ip:<address>). --ban stops it rejoining; --ip bans its network address too (careful: agents behind one NAT or cloud proxy share one). MAC addresses never reach the hub, so they can't be banned")
  .option('--ban', 'also stop it rejoining')
  .option('--ip', 'with --ban: ban its network address too')
  .option('-r, --reason <text>', 'shown to the removed agent')
  .option('-u, --url <url>', 'hub URL (default: the hub the channel was created on)')
  .action(async (address: string, agent: string, opts) => {
    try {
      const r = await asOwner(address, opts.url, (ch, key) => ch.kick(agent, { ban: !!opts.ban || agent.startsWith('ip:'), ip: !!opts.ip, reason: opts.reason }, key));
      const who = r.kicked.length ? r.kicked.map(a => a.name).join(', ') : 'nobody currently here';
      console.log(green(`✔ Removed ${who}`) + (r.banned ? dim(' (banned from rejoining)') : ''));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('unban <address> <agent>')
  .description('Lift a ban in a channel you created (by name, agent id, or ip:<address>)')
  .option('-u, --url <url>', 'hub URL (default: the hub the channel was created on)')
  .action(async (address: string, agent: string, opts) => {
    try {
      const n = await asOwner(address, opts.url, (ch, key) => ch.unban(agent, key));
      console.log(n ? green(`✔ Lifted ${n} ban${n === 1 ? '' : 's'}`) : dim(`No ban matched ${agent}`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('bans <address>')
  .description('List the bans in a channel you created (banned addresses are counted, not shown)')
  .option('-u, --url <url>', 'hub URL (default: the hub the channel was created on)')
  .action(async (address: string, opts) => {
    try {
      const bans = await asOwner(address, opts.url, (ch, key) => ch.bans(key));
      if (!bans.length) return console.log(dim('No bans.'));
      for (const b of bans) {
        console.log(`${bold(b.name)} ${dim(`${b.ids.length} id${b.ids.length === 1 ? '' : 's'}, ${b.ipCount} address${b.ipCount === 1 ? '' : 'es'}, by ${b.by.name} ${new Date(b.at).toLocaleString()}${b.reason ? `: ${b.reason}` : ''}`)}`);
      }
    } catch (err) {
      fail(err);
    }
  });

for (const cmd of [program.command('close <address>'), channel.command('close <address>')]) {
  cmd
    .description('Close a channel you created, for everyone: members are removed, locks and open questions dropped')
    .option('-u, --url <url>', 'hub URL (default: the hub the channel was created on)')
    .action(closeAction);
}

program
  .command('llm [address]')
  .description('Put a model in a conversation as a member: any OpenAI-compatible endpoint, or any command that reads a prompt on stdin. Joins a hub directly, or over a serial/radio/TCP link to a crosstalk-bridge')
  .option('--openai <url>', 'OpenAI-compatible base URL, e.g. http://127.0.0.1:8080/v1 (llama-server), http://127.0.0.1:11434/v1 (Ollama)')
  .option('--model <name>', 'model name to request from --openai')
  .option('--exec <command>', 'command that reads the prompt on stdin and prints the reply, e.g. "llama-cli -m model.gguf -f /dev/stdin -n 200 --no-display-prompt"')
  .option('-n, --name <name>', 'member name; others reach it with @name', 'local-model')
  .option('--system <text>', 'extra instructions for the model')
  .option('--reply <when>', '"mention" (@name and DMs) or "all" (every message from a non-model member)', 'mention')
  .option('--history <n>', 'recent messages given as context', '8')
  .option('--max-tokens <n>', 'reply length limit for --openai', '256')
  .option('--timeout <seconds>', 'per-reply model timeout', '120')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('--serial <tty>', 'instead of a hub: talk to a crosstalk-bridge over this serial port (USB, UART, Bluetooth serial, radio module)')
  .option('--baud <rate>', 'serial speed', '115200')
  .option('--tcp <host:port>', 'instead of a hub: talk to a crosstalk-bridge --tcp-listen over TCP')
  .option('--reliable', 'checksums, acks, retries and message splitting for lossy links (radios); the bridge needs --reliable too')
  .option('--mtu <bytes>', 'with --reliable: payload bytes per radio packet', '64')
  .option('--bitrate <bps>', 'with --reliable: link speed, for --duty-cycle', '9600')
  .option('--duty-cycle <share>', 'with --reliable: most time spent transmitting, e.g. 0.01', '1')
  .action(async (address: string | undefined, opts) => {
    if (!!opts.openai === !!opts.exec) fail('Give exactly one of --openai <url> or --exec "<command>".');
    const viaDevice = !!(opts.serial || opts.tcp);
    if (viaDevice && opts.serial && opts.tcp) fail('Give one of --serial or --tcp.');
    if (!viaDevice && !address) fail('Give the channel address, or --serial / --tcp to reach one through a bridge.');
    if (opts.reply !== 'mention' && opts.reply !== 'all') fail('--reply must be "mention" or "all"');
    const { startModelAgent, openAIGenerator, execGenerator } = await import('./llm.js');
    const generate = opts.openai
      ? openAIGenerator({ baseUrl: opts.openai, model: opts.model, apiKey: process.env.CROSSTALK_MODEL_KEY, maxTokens: Number(opts.maxTokens) })
      : execGenerator(opts.exec);
    let link: any;
    if (viaDevice) {
      // The device side lives in @cross-talk/embedded (packages/embedded in the repo).
      const pkg = '@cross-talk/embedded';
      const embedded: any = await import(pkg).catch(() => fail(`--serial and --tcp need ${pkg} (packages/embedded in the CrossTalk repo).`));
      let stream: any;
      if (opts.serial) {
        stream = embedded.openSerialPort(opts.serial, Number(opts.baud));
      } else {
        const [host, port] = String(opts.tcp).split(/:(?=\d+$)/);
        const net = await import('node:net');
        stream = net.createConnection(Number(port), host || '127.0.0.1');
        await new Promise((resolve, reject) => stream.once('connect', resolve).once('error', reject)).catch(fail);
      }
      const transport = opts.reliable
        ? new embedded.ReliableLink(stream, { mtu: Number(opts.mtu), bitrate: Number(opts.bitrate), dutyCycle: Number(opts.dutyCycle) })
        : new embedded.ResyncingLink(stream, 2048);
      transport.on('error', (err: Error) => console.error(yellow(`! link: ${err.message}`)));
      link = embedded.deviceModelLink(transport, { name: opts.name });
    }
    try {
      const agent = await startModelAgent({
        link,
        channel: address ?? '',
        name: opts.name,
        url: opts.url,
        environment: 'bot',
        generate,
        system: opts.system,
        reply: opts.reply,
        history: Number(opts.history),
        timeoutMs: Number(opts.timeout) * 1000,
        log: line => console.log(`${time(Date.now())} ${line}`)
      });
      stayAlive();
      const stop = async () => { await agent.stop(); process.exit(0); };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('send <address> <text...>')
  .description('Post one message (stays present for ~10 min so replies can be awaited with `wait`). Text over the channel limit is posted as numbered parts unless --no-split')
  .option('--no-split', 'fail instead of splitting text that is over the channel limit')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, words: string[], opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      const text = words.join(' ');
      let parts: number | undefined;
      if (text.startsWith('!')) await agent.request('shorthand.send', { channel, shorthand: text });
      else parts = (await agent.request('message.send', { channel, content: text, ...(opts.split ? { split: true } : {}) })).parts;
      console.log(green(`✔ sent as ${agent.agent!.name}`) + (parts ? dim(` (in ${parts} parts)`) : ''));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('claim <address> <task...>')
  .description('Take on a task so the channel can track it; post progress (`crosstalk progress`) before each update is due or it shows as stalled')
  .option('-e, --every <minutes>', 'how often you will post progress', '10')
  .option('-p, --path <path...>', 'files or directories the work covers')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, words: string[], opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      const claim = await agent.request('claim.create', { channel, task: words.join(' '), everySeconds: Number(opts.every) * 60, paths: opts.path });
      console.log(green(`✔ claimed ${claim.id}: ${claim.task}`) + dim(` (next update due by ${new Date(claim.nextUpdateBy).toLocaleTimeString()})`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('progress <address> [note...]')
  .description('Heartbeat your claims in a channel (all of them, or --claim), optionally posting a note; --done or --drop to close. Handy from a git hook')
  .option('-c, --claim <id>', 'only this claim')
  .option('--done', 'mark finished')
  .option('--drop', 'give it up so someone else can take it')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, words: string[], opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      const status = opts.done ? 'done' : opts.drop ? 'dropped' : undefined;
      const { claims } = await agent.request('claim.update', { channel, claim: opts.claim, note: words.join(' ') || undefined, status });
      if (!claims.length) return console.log(dim(`${agent.agent!.name} holds no claims in this channel.`));
      for (const c of claims) console.log(green(`✔ ${c.status} ${c.id}: ${c.task}`));
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// Remote invites (#13): let agents outside this machine into one channel
// ---------------------------------------------------------------------------

/** "24h", "7d", "90m", "3600s" or a number of seconds. */
function parseDuration(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*$/i.exec(text);
  if (!m) fail(`Not a duration: "${text}" (try 24h, 7d or 90m)`);
  return Math.round(Number(m![1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m![2].toLowerCase() as '' | 's' | 'm' | 'h' | 'd']);
}

/** The owner key saved on this machine for `address` on `url`, or a clear failure. */
function ownerKeyFor(address: string, url: string): string {
  const owned = loadOwnedChannels().find(c => c.address === address && sameHub(c.url, url)) ?? loadOwnedChannels().find(c => c.address === address);
  if (!owned) fail(`No owner key for ${address} on this machine. Only the channel's creator can invite remote agents.`);
  return owned!.key;
}

program
  .command('invite <what> [address] [which]')
  .description('Invite agents into a channel. `invite xt_…` prints the invite text; `invite xt_… --remote` makes a key for agents outside this machine (needs `crosstalk serve --public`); `invite list xt_…`; `invite revoke xt_… <id|label|all>` (disconnects them)')
  .option('--remote', 'make an invite key that opens only this channel, through the hub\'s public door')
  .option('-l, --label <label>', 'name for the invite, shown on the agents it admits')
  .option('-e, --expires <duration>', 'how long the key works, e.g. 24h, 7d (default 24h)', '24h')
  .option('-m, --max-agents <n>', 'how many agents the key can admit')
  .option('--json', 'print raw JSON')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (what: string, address: string | undefined, which: string | undefined, opts) => {
    try {
      const sub = what === 'list' || what === 'revoke' ? what : 'create';
      const target = sub === 'create' ? what : address;
      if (!target || !CrossTalk.isAddress(target)) fail('Which channel? Give its address (xt_…).');
      if (sub === 'create' && !opts.remote) {
        console.log(inviteText({ address: target!, hub: opts.url }));
        return;
      }
      const ownerKey = ownerKeyFor(target!, opts.url);
      const { agent, channel } = await oneShot(target!, opts);
      try {
        if (sub === 'list') {
          const { invites } = await agent.request('invite.list', { channel, ownerKey });
          if (opts.json) return console.log(JSON.stringify(invites, null, 2));
          if (!invites.length) return console.log(dim('No invites for this channel.'));
          for (const i of invites) {
            const state = i.status === 'active' ? green(i.status) : dim(i.status);
            console.log(`${bold(i.label)} ${dim(i.id)} ${state} ${dim(`${i.admitted} admitted, ${i.online} online${i.maxAgents ? ` of ${i.maxAgents}` : ''}${i.expiresAt ? `, expires ${new Date(i.expiresAt).toLocaleString()}` : ''}`)}`);
          }
          return;
        }
        if (sub === 'revoke') {
          if (!which) fail('Revoke which invite? Give its id or label (see `crosstalk invite list`), or "all".');
          const { revoked, disconnected } = await agent.request('invite.revoke', { channel, ownerKey, invite: which! });
          for (const i of revoked) console.log(green(`✔ revoked ${i.label} (${i.id})`));
          console.log(dim(`${disconnected} agent(s) disconnected.`));
          return;
        }
        const health = (await (await fetch(`${httpBase(opts.url)}/health`)).json()) as { publicUrl?: string };
        const { key, invite } = await agent.request('invite.create', {
          channel,
          ownerKey,
          label: opts.label,
          expiresInSeconds: parseDuration(opts.expires),
          maxAgents: opts.maxAgents ? Number(opts.maxAgents) : undefined
        });
        if (opts.json) return console.log(JSON.stringify({ key, invite, publicUrl: health.publicUrl }, null, 2));
        if (!health.publicUrl) {
          console.error(yellow('! This hub has no public door yet, so remote agents can\'t use the key. Restart it with `crosstalk serve --public` (or --public-url <your tunnel>).'));
        }
        console.log(dim(`Invite ${invite.label} (${invite.id}) made. Send this to the remote agent; the key is shown only once.`));
        console.log(dim(`Revoke it any time: crosstalk invite revoke ${target} ${invite.label}\n`));
        console.log(remoteInviteText({ address: target!, publicUrl: health.publicUrl ?? '<public URL>', key, expiresAt: invite.expiresAt }));
      } finally {
        await agent.close().catch(() => {});
      }
    } catch (err) {
      fail(err);
    }
  });

// ---------------------------------------------------------------------------
// File locks from the shell: a background holder keeps them (see holder.ts)
// ---------------------------------------------------------------------------

const defaultChannel = () => (process.env.CROSSTALK_CHANNEL || '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? '';

function lockTarget(opts: { channel?: string; name: string; url: string }): HolderTarget {
  const channel = opts.channel || defaultChannel();
  if (!CrossTalk.isAddress(channel)) fail('Which channel? Pass --channel xt_… or set CROSSTALK_CHANNEL.');
  return { url: opts.url, channel, name: opts.name, token: process.env.CROSSTALK_AUTH_TOKEN || undefined };
}

/** The git checkout the CLI runs in, and `file` relative to it with forward slashes (what every lock is keyed by). */
function repoPath(file: string): { root: string; rel: string } {
  let root = process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || root;
  } catch {}
  const abs = path.resolve(file);
  const rel = path.relative(root, abs);
  return { root, rel: rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/') };
}

const holderCommand = () => [process.execPath, ...process.execArgv, process.argv[1], '_lock-holder'];
const until = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

program
  .command('lock <files...>')
  .description('Lock files in a channel until you unlock them, time runs out (kept while a file has uncommitted changes), or --until-commit sees them committed. Exit 1 if someone else holds one; then none are locked')
  .option('-c, --channel <address>', 'channel address (or $CROSSTALK_CHANNEL)')
  .option('-r, --reason <text>', 'what you are doing, shown to others', 'editing')
  .option('-m, --minutes <n>', 'how long to hold them; renewed past the hub\'s 30-minute cap', '30')
  .option('--until-commit', 'let go of each file as soon as its changes are committed')
  .option('-n, --name <name>', 'your agent name (or $CROSSTALK_AGENT_NAME)', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (files: string[], opts) => {
    try {
      const target = lockTarget(opts);
      const minutes = Number(opts.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) fail('--minutes must be a positive number');
      const paths = files.map(repoPath);
      await ensureHolder(target, holderCommand());
      const res = await askHolder(target, { op: 'lock', files: paths.map(p => p.rel), root: paths[0].root, reason: opts.reason, minutes, untilCommit: !!opts.untilCommit });
      if (!res.ok) {
        if (res.lock) {
          console.error(red(`✖ HELD ${res.lock.file} by ${res.lock.holder.name} since ${ago(res.lock.acquiredAt)}: ${res.lock.reason}`));
          console.error(dim('  Nothing was locked. Wait for it, or ask them in the channel.'));
        } else console.error(red(`✖ ${res.message}`));
        process.exit(1);
      }
      for (const l of res.locks ?? []) {
        console.log(green(`🔒 locked ${l.file}`) + dim(l.untilCommit ? ` until it is committed (at most until ${until(l.deadline)})` : ` until ${until(l.deadline)}`));
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('unlock [files...]')
  .description('Release locks taken with `crosstalk lock`. Prints NOT RELEASED and exits 3 for any file this agent did not hold')
  .option('-a, --all', 'release every lock you hold in the channel')
  .option('-c, --channel <address>', 'channel address (or $CROSSTALK_CHANNEL)')
  .option('-n, --name <name>', 'your agent name (or $CROSSTALK_AGENT_NAME)', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (files: string[], opts) => {
    try {
      const target = lockTarget(opts);
      if (!opts.all && !files.length) fail('Name the files to unlock, or pass --all.');
      const rels = files.map(f => repoPath(f).rel);
      const res = await holderIfRunning(target, { op: 'unlock', files: rels, all: !!opts.all });
      if (!res) {
        if (opts.all) return console.log(dim(`${target.name} holds no locks from \`crosstalk lock\` here.`));
        for (const f of rels) console.error(red(`✖ NOT RELEASED ${f}: no \`crosstalk lock\` holder is running for ${target.name} (locks taken over MCP are released there)`));
        process.exit(3);
      }
      if (!res.ok) fail(res.message);
      let missed = 0;
      for (const r of res.results ?? []) {
        if (r.released) console.log(green(`🔓 released ${r.file}`));
        else {
          missed++;
          console.error(red(`✖ NOT RELEASED ${r.file}: ${r.note ?? 'not held'}`));
        }
      }
      if (opts.all && !res.results?.length) console.log(dim('Nothing to release.'));
      if (missed) process.exit(3);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('locks')
  .description('List the locks in a channel: who holds each, for how long, and why')
  .option('--mine', 'only yours')
  .option('--json', 'print raw JSON')
  .option('-c, --channel <address>', 'channel address (or $CROSSTALK_CHANNEL)')
  .option('-n, --name <name>', 'your agent name (or $CROSSTALK_AGENT_NAME)', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async opts => {
    try {
      const target = lockTarget(opts);
      const headers: Record<string, string> = target.token ? { 'X-CrossTalk-Token': target.token } : {};
      const res = await fetch(`${httpBase(target.url)}/api/channels/${encodeURIComponent(target.channel)}`, { headers });
      if (res.status === 404) fail('No conversation at that address');
      if (!res.ok) fail(`Hub answered HTTP ${res.status}`);
      const snap = (await res.json()) as ChannelSnapshot;
      const mine = (l: FileLock) => l.holder.name.toLowerCase() === target.name.toLowerCase();
      const held = await holderIfRunning(target, { op: 'list' }).catch(() => undefined);
      const extra = new Map((held?.ok ? held.locks ?? [] : []).map(l => [l.file, l]));
      const locks = snap.locks.filter(l => !opts.mine || mine(l)).sort((a, b) => a.file.localeCompare(b.file));
      if (opts.json) return console.log(JSON.stringify(locks.map(l => ({ ...l, holderProcess: extra.get(l.file) })), null, 2));
      if (!locks.length) return console.log(dim(opts.mine ? `${target.name} holds no locks here.` : 'No locks in this channel.'));
      for (const l of locks) {
        const h = mine(l) ? extra.get(l.file) : undefined;
        const plan = h ? (h.untilCommit ? `until committed, at most ${until(h.deadline)}` : `until ${until(h.deadline)}`) + (h.extended ? `, extended ${h.extended}× for uncommitted changes` : '') : `lease ends ${until(l.expiresAt)}`;
        console.log(`${yellow('🔒')} ${bold(l.file)} ${dim('—')} ${mine(l) ? green(l.holder.name + ' (you)') : cyan(l.holder.name)} ${dim(`since ${ago(l.acquiredAt)}, ${plan}`)}: ${l.reason}`);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('check <file>')
  .description('Is this file locked by someone else? Exit 0 if free or yours, 1 if another agent holds it')
  .option('-c, --channel <address>', 'channel address (or $CROSSTALK_CHANNEL)')
  .option('-n, --name <name>', 'your agent name (or $CROSSTALK_AGENT_NAME)', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (file: string, opts) => {
    try {
      const target = lockTarget(opts);
      const rel = repoPath(file).rel;
      const params = new URLSearchParams({ channel: target.channel, file: rel }); // encodes [brackets] and spaces
      const headers: Record<string, string> = target.token ? { 'X-CrossTalk-Token': target.token } : {};
      const res = await fetch(`${httpBase(target.url)}/api/locks/check?${params}`, { headers });
      if (!res.ok) fail(`Hub answered HTTP ${res.status}`);
      const status = (await res.json()) as { locked: boolean; lock?: FileLock };
      if (!status.locked || !status.lock) return console.log(green(`free ${rel}`));
      if (status.lock.holder.name.toLowerCase() === target.name.toLowerCase()) return console.log(green(`yours ${rel}`) + dim(`: ${status.lock.reason}`));
      console.log(red(`HELD ${rel} by ${status.lock.holder.name} since ${ago(status.lock.acquiredAt)}: ${status.lock.reason}`));
      process.exit(1);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('run <command...>')
  .description('Run a heavy command (a build, a full test suite) only while holding one of a slot\'s places, so at most --max run at once across every agent in the channel. Queues when the slot is full; exits with the command\'s code. Put the command after --')
  .option('-s, --slot <name>', 'slot name, e.g. heavy or test-server')
  .option('--max <n>', 'places in the slot (the first holder fixes it)', '2')
  .option('--min-free-disk <size>', 'refuse to start (exit 1) below this much free disk, e.g. 5G')
  .option('--ttl <seconds>', 'lease, renewed every third of it while the command runs', '300')
  .option('-c, --channel <address>', 'channel address (or $CROSSTALK_CHANNEL)')
  .option('-n, --name <name>', 'your agent name (or $CROSSTALK_AGENT_NAME)', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (command: string[], opts) => {
    try {
      const target = lockTarget(opts);
      if (!opts.slot) fail('Which slot? Pass --slot <name>, e.g. --slot heavy.');
      const max = Number(opts.max);
      if (!Number.isInteger(max) || max < 1 || max > 64) fail('--max must be a whole number from 1 to 64');
      const ttl = Number(opts.ttl);
      if (!Number.isFinite(ttl) || ttl <= 0) fail('--ttl must be a positive number of seconds');
      const code = await runWithSlot({
        ...target,
        slot: opts.slot,
        max,
        ttlSeconds: ttl,
        minFreeBytes: opts.minFreeDisk ? parseSize(opts.minFreeDisk) : undefined,
        command
      });
      process.exit(code);
    } catch (err) {
      fail(err);
    }
  });

/** The background process behind `crosstalk lock`; not for direct use. */
program
  .command('_lock-holder')
  .description('(internal) hold file locks for `crosstalk lock`')
  .option('--url <url>', 'hub URL', defaultUrl())
  .option('--channel <address>', 'channel address')
  .option('--name <name>', 'agent name', defaultName())
  .action(async opts => {
    await runHolder({ url: opts.url, channel: opts.channel, name: opts.name, token: process.env.CROSSTALK_AUTH_TOKEN || undefined }).catch(err => {
      console.error(`holder failed: ${(err as Error).message}`);
      process.exit(1);
    });
  });

program
  .command('wait <address>')
  .description('Block until a message or DM arrives, print it and exit (exit code 2 on timeout)')
  .option('-t, --timeout <seconds>', 'give up after this long; 0 waits forever', '60')
  .option('-m, --mentions', 'only wake for messages that @mention you (and DMs)')
  .option('-s, --since <message-id>', 'first print anything posted after this message (the last one you saw) and exit if there is any; otherwise wait')
  .option('--on-message <command|url>', "don't exit: run the command (message JSON on stdin) or POST to the URL for each message")
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('--json', 'print raw JSON')
  .action(async (target: string, opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      // Read the id each time: after a hub restart the session is re-created with a new one.
      const me = () => agent.agent!.id;
      const startedAt = Date.now();
      const seconds = Number(opts.timeout);
      const deadline = seconds > 0 ? Date.now() + seconds * 1000 : Infinity;
      // Every message on this session counts, whichever channel it is in: the
      // hub hands each event out once, so skipping one here would lose it.
      const wanted = (f: ServerFrame): f is Extract<ServerFrame, { type: 'message' | 'dm' }> => {
        if (f.type === 'channel.kicked' && f.channel === channel) {
          console.log(red(`✖ ${f.by.name} removed you from this channel${f.reason ? `: ${f.reason}` : ''}${f.banned ? ' (banned)' : ''}`));
          process.exit(3);
        }
        // Your own messages never wake you (the hub echoes them back to you).
        return f.type === 'dm' || (f.type === 'message' && f.message.from.id !== me() && (!opts.mentions || !!f.message.mentions?.some(m => m.id === me())));
      };
      const show = (f: Extract<ServerFrame, { type: 'message' | 'dm' }>) =>
        opts.json ? JSON.stringify(f.message)
          : formatMessage(f.message, f.type === 'message' && f.message.channel !== channel ? f.message.channel : undefined);
      if (opts.since && !opts.onMessage) {
        // Catch up first: what arrived between the last wait and this one.
        // An id the hub no longer has (too old, or from another channel) catches up nothing.
        const { messages } = await agent.request('channel.state', { channel });
        const at = messages.findIndex(m => m.id === opts.since);
        const missed = (at < 0 ? [] : messages.slice(at + 1))
          .filter(m => m.from.id !== me() && (!opts.mentions || !!m.mentions?.some(x => x.id === me())));
        if (missed.length) {
          for (const m of missed) console.log(opts.json ? JSON.stringify(m) : formatMessage(m));
          return;
        }
      }
      let failures = 0;
      // listening ──session expired──▶ rejoining ──back in the channel──▶ listening
      let rejoining = false;
      while (Date.now() < deadline) {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        let events: ServerFrame[];
        try {
          if (rejoining) {
            await agent.open();
            await agent.request('channel.join', { channel });
            rejoining = false;
          }
          events = await agent.events(Math.min(remaining, 55));
          failures = 0;
        } catch (err) {
          // A long wait outlives network blips and hub restarts: retry, and
          // re-register and rejoin if the hub forgot the session.
          if (err instanceof CrossTalkError && err.code === 'forbidden') throw err; // banned
          if (++failures > 8) throw err;
          if (err instanceof CrossTalkError && err.code === 'not_registered') rejoining = true;
          await new Promise(r => setTimeout(r, Math.min(500 * 2 ** failures, 15_000)));
          continue;
        }
        const hits = events.filter(wanted);
        if (!hits.length) continue;
        if (!opts.onMessage) {
          for (const f of hits) {
            // Say when something was waiting from before this wait started, so "it fired" isn't mistaken for news.
            const early = f.message.timestamp < startedAt - 1000;
            console.log(show(f) + (early && !opts.json ? dim('  (arrived before this wait started)') : ''));
          }
          const lastId = [...hits].reverse().find(f => f.type === 'message')?.message.id;
          if (lastId && !opts.json) console.error(dim(`next: crosstalk wait ${channel} --since ${lastId} …`));
          return;
        }
        for (const f of hits) {
          console.log(show(f));
          await deliver(opts.onMessage, f.message).catch(err => console.error(yellow(`! --on-message failed: ${err.message}`)));
        }
      }
      console.error(dim(`no messages after ${opts.timeout}s`));
      process.exit(2);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('wake-hook <address> [url]')
  .description('Have the hub POST to <url> when you are @mentioned in the channel, even while nothing of yours is running (hub 2.10+). No url: show your hook. --clear removes it')
  .option('--on <when>', 'mentions (default) or all: any message from someone else', 'mentions')
  .option('--secret <secret>', 'sign each POST: X-CrossTalk-Signature: sha256=<HMAC of the body>')
  .option('--cooldown <seconds>', 'minimum time between POSTs', '30')
  .option('--clear', 'remove your hook')
  .option('-n, --name <name>', 'your agent name (the hook belongs to it)', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, hookUrl: string | undefined, opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      if (opts.clear) {
        const { cleared } = await agent.request('wake.clear', { channel });
        console.log(cleared ? green('✔ wake hook removed') : dim('no wake hook to remove'));
        return;
      }
      if (!hookUrl) {
        const { hook } = await agent.request('wake.get', { channel });
        if (!hook) return console.log(dim(`no wake hook for ${agent.agent!.name} here`));
        const last = hook.lastFiredAt ? `last fired ${new Date(hook.lastFiredAt).toLocaleTimeString()} → ${hook.lastError ?? `HTTP ${hook.lastStatus}`}` : 'not fired yet';
        return console.log(`${hook.url} ${dim(`(on ${hook.on}, cooldown ${hook.cooldownSeconds}s${hook.signed ? ', signed' : ''}; ${last})`)}`);
      }
      const hook = await agent.request('wake.set', { channel, url: hookUrl, on: opts.on, secret: opts.secret, cooldownSeconds: Number(opts.cooldown) });
      console.log(green(`✔ the hub will POST to ${hook.url} when ${hook.agent} is ${hook.on === 'all' ? 'sent any message' : '@mentioned'}`) + dim(` (cooldown ${hook.cooldownSeconds}s${hook.signed ? ', signed' : ''})`));
    } catch (err) {
      fail(err);
    }
  });

program
  .command('wake <address>')
  .description('Supervise an agent that can\'t be woken over MCP: when it is @mentioned and hasn\'t read the channel within the grace period, or its claim stalls, re-invoke it through an adapter')
  .requiredOption('-a, --agent <name>', 'the agent to wake, by its channel name')
  .option('--adapter <name>', `built-in adapter: ${Object.keys(ADAPTERS).join(', ')}`)
  .option('--target <pane>', 'tmux pane for --adapter tmux, e.g. "agents:0.1"')
  .option('--exec <command>', 'custom command; the prompt is on stdin and in $CROSSTALK_PROMPT')
  .option('-g, --grace <seconds>', 'how long the agent gets to notice on its own', '30')
  .option('--cooldown <seconds>', 'minimum time between wakes', '120')
  .option('--any', 'wake on any message from others, not only @mentions')
  .option('-q, --quiet', "don't post a note in the channel when waking")
  .option('-n, --name <name>', 'supervisor name', `${defaultName()}-wake`)
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, opts) => {
    if (!!opts.adapter === !!opts.exec) {
      fail(`Give exactly one of --adapter <name> or --exec "<command>". Adapters:\n${Object.entries(ADAPTERS).map(([k, v]) => `  ${k}: ${v.describe}`).join('\n')}`);
    }
    let adapter: WakeAdapter;
    try {
      if (opts.exec) adapter = execAdapter(opts.exec);
      else if (!ADAPTERS[opts.adapter]) return fail(`Unknown adapter "${opts.adapter}". Pick one of: ${Object.keys(ADAPTERS).join(', ')}`);
      else adapter = ADAPTERS[opts.adapter].make(opts.target);
    } catch (err) {
      return fail(err);
    }
    try {
      const ct = await CrossTalk.connect({ name: opts.name, url: opts.url, role: 'supervisor', environment: 'terminal' });
      const ch = await ct.joinChannel(target);
      new WakeSupervisor(ch, ct, {
        agent: opts.agent,
        adapter: adapter!,
        graceMs: Number(opts.grace) * 1000,
        cooldownMs: Number(opts.cooldown) * 1000,
        anyMessage: !!opts.any,
        announce: !opts.quiet,
        log: line => console.log(`${time(Date.now())} ${line}`)
      });
      console.log(green(`✔ Watching #${ch.name} for ${opts.agent}`) + dim(` (grace ${opts.grace}s, cooldown ${opts.cooldown}s)`));
      ct.on('disconnected', () => console.log(red('disconnected, reconnecting…')));
      ct.on('reconnected', () => console.log(green('reconnected')));
      stayAlive();
    } catch (err) {
      fail(err);
    }
  });

/** Hands one message to a --on-message target: POST to a URL, or a shell command with the JSON on stdin. */
async function deliver(target: string, message: ChannelMessage | DirectMessage): Promise<void> {
  const body = JSON.stringify(message);
  if (/^https?:\/\//.test(target)) {
    const res = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return;
  }
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target, {
      shell: true,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: {
        ...process.env,
        CROSSTALK_FROM: message.from.name,
        CROSSTALK_CHANNEL: 'channel' in message ? message.channel : '',
        CROSSTALK_TEXT: message.content
      }
    });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
    child.stdin.end(body);
  });
}

program
  .command('tail <address>')
  .description('Stream a conversation to stdout')
  .option('-n, --name <name>', 'observer name', `${defaultName()}-tail`)
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('-s, --since <messageId>', 'only print history newer than this message')
  .action(async (target: string, opts) => {
    try {
      const ct = await CrossTalk.connect({ name: opts.name, url: opts.url, role: 'observer', environment: 'terminal' });
      const ch = await ct.joinChannel(target, { since: opts.since });
      for (const m of ch.messages) console.log(formatMessage(m));
      ch.on('message', m => console.log(formatMessage(m)));
      ch.on('lock.acquired', l => console.log(yellow(`🔒 ${l.holder.name} locked ${l.file}: ${l.reason}`)));
      ch.on('lock.released', e => console.log(dim(`🔓 ${e.file} unlocked (${e.reason})`)));
      ch.on('member.joined', a => console.log(dim(`→ ${a.name} joined`)));
      ch.on('member.left', a => console.log(dim(`← ${a.name} left`)));
      ct.on('disconnected', () => console.log(red('disconnected, reconnecting…')));
      ct.on('reconnected', () => console.log(green('reconnected')));
      stayAlive();
    } catch (err) {
      fail(err);
    }
  });

program
  .command('dialect [expression...]')
  .description('Show the XDialect dictionary, or translate an expression to English')
  .action((words: string[]) => {
    if (!words.length) {
      console.log(bold(`${DIALECT_V1.name} v${DIALECT_V1.version}`));
      console.log(dim(DIALECT_V1.grammar.format));
      for (const t of Object.values(DIALECT_V1.tokens)) console.log(`  ${yellow(t.code.padEnd(9))} ${t.meaning}`);
      return;
    }
    const expr = words.join(' ');
    console.log(DialectEngine.toHuman(expr));
    console.log(dim(`${DialectEngine.packToBits(expr).length} bytes packed`));
  });

program
  .command('mcp')
  .description('Run the MCP server on stdio (same as `crosstalk-mcp`)')
  .action(async () => {
    const { runMcpServer } = await import('../mcp/server.js');
    await runMcpServer();
  });

/**
 * `--local` on any command: use the hub on this device (ws://localhost:4488)
 * instead of the CrossTalk internet hub, starting it in the background if it
 * isn't running. Stripped here so every command accepts it.
 */
async function ensureLocalHub(): Promise<void> {
  const health = `${LOCAL_URL.replace(/^ws/, 'http')}/health`;
  const up = () => fetch(health, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false);
  const running = await fetch(health, { signal: AbortSignal.timeout(1000) })
    .then(async r => (r.ok ? ((await r.json()) as { version?: string }) : undefined), () => undefined);
  if (running) {
    // An older hub (often one embedded in a long-running `crosstalk mcp`) lacks newer features.
    if (running.version && compareVersions(running.version, VERSION) < 0) {
      console.error(yellow(`! The hub on this device (${LOCAL_URL}) runs CrossTalk ${running.version}, older than this CLI (${VERSION}); newer features may not work. Stop it (and any old \`crosstalk mcp\` or \`crosstalk serve\` that runs it) so the next --local command starts a current one.`));
    }
    return;
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [process.argv[1], 'serve'], { detached: true, stdio: 'ignore', env: { ...process.env, CROSSTALK_NO_WELCOME: '1' } });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await up()) {
      console.error(dim(`Started a hub on this device (${LOCAL_URL}, pid ${child.pid}); it keeps running in the background. Stop it with: kill ${child.pid}`));
      return;
    }
  }
  fail(`Could not start a hub on this device. Run \`crosstalk serve\` in another terminal, then try again.`);
}

const quiet = command === 'mcp' || command === 'serve' || command === 'welcome' || argv.includes('--json') || argv.includes('-V') || argv.includes('--version');
if (!quiet) welcomeOnce();

(async () => {
  if (wantsLocal && command !== 'serve') await ensureLocalHub();
  await program.parseAsync(argv);
})().catch(err => {
  if (err instanceof CrossTalkError) fail(err);
  throw err;
});
