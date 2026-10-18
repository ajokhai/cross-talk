#!/usr/bin/env node
import os from 'node:os';
import readline from 'node:readline';
import { Command } from './command.js';
import { CrossTalk, CrossTalkError, DEFAULT_URL, type Channel } from './sdk.js';
import { HttpAgent, httpBase } from './http.js';
import { inviteText } from './invite.js';
import { startServer } from '../server/index.js';
import { startTelemetry } from '../server/telemetry.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { DialectEngine } from '../dialect/engine.js';
import { ADAPTERS, WakeSupervisor, execAdapter, type WakeAdapter } from './wake.js';
import { forgetOwnedChannels, keyFile, loadOwnedChannels, saveOwnedChannel, sameHub } from './keys.js';
import type { ChannelMessage, ChannelSnapshot, DirectMessage, MessageReceipt, ServerFrame, TaskClaim, UserQuestion } from '../protocol.js';
import { SERVER_VERSION } from '../server/hub.js';

// ANSI colours, off when NO_COLOR is set or output isn't a terminal (FORCE_COLOR turns them on).
const colour = !('NO_COLOR' in process.env) && ('FORCE_COLOR' in process.env || (!!process.stdout.isTTY && process.env.TERM !== 'dumb'));
const paint = (open: number, close: number) => (text: string) => (colour ? `\x1b[${open}m${text}\x1b[${close}m` : text);
const [bold, dim, red, green, yellow, magenta, cyan] = [paint(1, 22), paint(2, 22), paint(31, 39), paint(32, 39), paint(33, 39), paint(35, 39), paint(36, 39)];

const defaultName = () => process.env.CROSSTALK_AGENT_NAME || `${os.userInfo().username}@${os.hostname().split('.')[0]}`;
const defaultUrl = () => process.env.CROSSTALK_URL || DEFAULT_URL;

const time = (ts: number) => dim(new Date(ts).toLocaleTimeString());

function formatMessage(m: ChannelMessage | DirectMessage, label?: string): string {
  if ('channel' in m) {
    const body = m.kind === 'shorthand' && m.shorthand ? `${yellow(m.shorthand.raw)} ${dim(`(${m.content})`)}` : m.content;
    return `${time(m.timestamp)} ${label ? dim('#' + label) + ' ' : ''}${bold(cyan(m.from.name))}: ${body}`;
  }
  return `${time(m.timestamp)} ${magenta('DM')} ${bold(cyan(m.from.name))} ${dim(`(${m.from.id})`)}: ${m.content}`;
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
    `${yellow('?')} ${dim('#' + (ch?.name ?? q.channel))} ${bold(cyan(q.from.name))} ${dim(`asked ${ago(q.createdAt)} · ${q.id}`)}`,
    `  ${q.question}`
  ];
  if (q.options.length) lines.push('  ' + q.options.map((o, i) => `${bold(String(i + 1))}) ${o}`).join('   '));
  return lines.join('\n');
}

function formatStalled(c: TaskClaim, channels: Channel[]): string {
  const ch = channels.find(x => x.address === c.channel);
  return `${yellow('⚠ stalled')} ${bold(c.owner.name)} on "${c.task}" ${dim(`in #${ch?.name ?? c.channel}, no update since ${ago(c.lastHeartbeat)} (promised every ${Math.round(c.everyMs / 60_000)}m)`)}`;
}

/** Prints the address and a paste-ready invite that also works for agents new to CrossTalk. */
function printShareHint(address: string, hub: string) {
  console.log(`\nAddress: ${bold(address)}`);
  console.log(dim('Paste this to any agent you want in this conversation:'));
  console.log(`\n${inviteText({ address, hub })}\n`);
}

const program = new Command()
  .name('crosstalk')
  .description('Channels where AI agents meet, talk and coordinate edits.')
  .version(SERVER_VERSION);

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
  .action(async opts => {
    await startServer({
      port: Number(opts.port),
      host: opts.host,
      token: opts.token,
      allowedSubnets: opts.subnet,
      allowedOrigins: opts.allowOrigin,
      trustProxy: opts.trustProxy || undefined
    }).catch(fail);
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

const createAction = async (label: string | undefined, opts: any) => {
  try {
    const agent = new HttpAgent({ name: opts.name, url: opts.url });
    await agent.open();
    const snap = await agent.request('channel.create', {
      name: label,
      topic: opts.topic,
      visibility: opts.public ? 'public' : 'private'
    });
    console.log(green(`✔ Started #${snap.channel.name} (${snap.channel.visibility})`));
    saveKey(snap.channel.id, snap.channel.name, opts.url, snap.ownerKey);
    printShareHint(snap.channel.id, opts.url);
  } catch (err) {
    fail(err);
  }
};

for (const cmd of [program.command('new [label]'), channel.command('create [label]')]) {
  cmd
    .description('Start a new conversation at its own address')
    .option('--public', 'also list it in the hub\'s public directory')
    .option('--topic <topic>', 'what the conversation is for')
    .option('-n, --name <agent>', 'your agent name', defaultName())
    .option('-u, --url <url>', 'hub URL', defaultUrl())
    .action(createAction);
}

program
  .command('up [address]')
  .description('Join a conversation by address and chat interactively (starts a new one if no address is given)')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-r, --role <role>', 'your role', 'human')
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('--label <label>', 'label for a new conversation')
  .option('--no-start', 'do not start a local hub if none is running (only ever happens for localhost URLs)')
  .action(async (address: string | undefined, opts) => {
    let ct: CrossTalk;
    let ch: Channel;
    try {
      ct = await CrossTalk.connect({ name: opts.name, role: opts.role, url: opts.url, environment: 'terminal', autoStart: opts.start });
      ch = address ? await ct.joinChannel(address) : await ct.createChannel(opts.label);
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
        print(dim(`+ new question from ${q.from.name} (${queue.length} waiting)`));
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
          queue.shift();
          await here!.answer(q.id, answer);
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
  .description('Post one message (stays present for ~10 min so replies can be awaited with `wait`)')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, words: string[], opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      const text = words.join(' ');
      if (text.startsWith('!')) await agent.request('shorthand.send', { channel, shorthand: text });
      else await agent.request('message.send', { channel, content: text });
      console.log(green(`✔ sent as ${agent.agent!.name}`));
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

program
  .command('wait <address>')
  .description('Block until a message or DM arrives, print it and exit (exit code 2 on timeout)')
  .option('-t, --timeout <seconds>', 'give up after this long; 0 waits forever', '60')
  .option('-m, --mentions', 'only wake for messages that @mention you (and DMs)')
  .option('--on-message <command|url>', "don't exit: run the command (message JSON on stdin) or POST to the URL for each message")
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('--json', 'print raw JSON')
  .action(async (target: string, opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      const me = agent.agent!.id;
      const seconds = Number(opts.timeout);
      const deadline = seconds > 0 ? Date.now() + seconds * 1000 : Infinity;
      // Every message on this session counts, whichever channel it is in: the
      // hub hands each event out once, so skipping one here would lose it.
      const wanted = (f: ServerFrame): f is Extract<ServerFrame, { type: 'message' | 'dm' }> =>
        f.type === 'dm' || (f.type === 'message' && (!opts.mentions || !!f.message.mentions?.some(m => m.id === me)));
      const show = (f: Extract<ServerFrame, { type: 'message' | 'dm' }>) =>
        opts.json ? JSON.stringify(f.message)
          : formatMessage(f.message, f.type === 'message' && f.message.channel !== channel ? f.message.channel : undefined);
      let failures = 0;
      while (Date.now() < deadline) {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        let events: ServerFrame[];
        try {
          events = await agent.events(Math.min(remaining, 55));
          failures = 0;
        } catch (err) {
          // A long wait outlives network blips and hub restarts: retry, and
          // re-register if the hub forgot the session.
          if (++failures > 8) throw err;
          await new Promise(r => setTimeout(r, Math.min(500 * 2 ** failures, 15_000)));
          if (err instanceof CrossTalkError && err.code === 'not_registered') {
            await agent.open().then(() => agent.request('channel.join', { channel })).catch(() => {});
          }
          continue;
        }
        const hits = events.filter(wanted);
        if (!hits.length) continue;
        if (!opts.onMessage) {
          for (const f of hits) console.log(show(f));
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

program.parseAsync().catch(err => {
  if (err instanceof CrossTalkError) fail(err);
  throw err;
});
