#!/usr/bin/env node
import os from 'node:os';
import readline from 'node:readline';
import { Command } from 'commander';
import { bold, cyan, dim, green, magenta, red, yellow } from 'colorette';
import { CrossTalk, CrossTalkError, DEFAULT_URL, type Channel } from './sdk.js';
import { HttpAgent } from './http.js';
import { startServer } from '../server/index.js';
import { startTelemetry } from '../server/telemetry.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { DialectEngine } from '../dialect/engine.js';
import { forgetOwnedChannels, keyFile, loadOwnedChannels, saveOwnedChannel, sameHub } from './keys.js';
import type { ChannelMessage, DirectMessage, ServerFrame, UserQuestion } from '../protocol.js';
import { SERVER_VERSION } from '../server/hub.js';

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

function printShareHint(address: string) {
  console.log(`\nAddress: ${bold(address)}`);
  console.log(dim(`Share it with the agents you want in this conversation:`));
  console.log(dim(`  CLI:   crosstalk up ${address}`));
  console.log(dim(`  Agent: "join CrossTalk channel ${address}"`));
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
    printShareHint(snap.channel.id);
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
  .option('--no-start', 'do not start a local hub if none is running')
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
    if (!address) printShareHint(ch.address);
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

    if (opts.list) {
      if (!queue.length) console.log(dim(`No open questions in ${channels.length} channel${channels.length === 1 ? '' : 's'}.`));
      for (const q of queue) console.log(formatQuestion(q, channels) + '\n');
      await ct.close();
      return;
    }

    console.log(green(`✔ Watching ${channels.length} channel${channels.length === 1 ? '' : 's'} for questions`) +
      (off.length ? yellow(` (${off.length} with questions off)`) : ''));
    console.log(dim('Type a number or an answer. Enter skips. /off or /on (this channel), /off all, /on all, /list, /quit'));

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
  .command('wait <address>')
  .description('Block until a message or DM arrives, print it and exit (exit code 2 on timeout)')
  .option('-t, --timeout <seconds>', 'give up after this long', '60')
  .option('-n, --name <name>', 'your agent name', defaultName())
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .option('--json', 'print raw JSON')
  .action(async (target: string, opts) => {
    try {
      const { agent, channel } = await oneShot(target, opts);
      const deadline = Date.now() + Number(opts.timeout) * 1000;
      while (Date.now() < deadline) {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        const events = await agent.events(Math.min(remaining, 55));
        const hits = events.filter((f): f is Extract<ServerFrame, { type: 'message' | 'dm' }> =>
          f.type === 'dm' || (f.type === 'message' && f.message.channel === channel));
        if (hits.length) {
          for (const f of hits) console.log(opts.json ? JSON.stringify(f.message) : formatMessage(f.message));
          return;
        }
      }
      console.error(dim(`no messages after ${opts.timeout}s`));
      process.exit(2);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('tail <address>')
  .description('Stream a conversation to stdout')
  .option('-n, --name <name>', 'observer name', `${defaultName()}-tail`)
  .option('-u, --url <url>', 'hub URL', defaultUrl())
  .action(async (target: string, opts) => {
    try {
      const ct = await CrossTalk.connect({ name: opts.name, url: opts.url, role: 'observer', environment: 'terminal' });
      const ch = await ct.joinChannel(target);
      for (const m of ch.messages) console.log(formatMessage(m));
      ch.on('message', m => console.log(formatMessage(m)));
      ch.on('lock.acquired', l => console.log(yellow(`🔒 ${l.holder.name} locked ${l.file}: ${l.reason}`)));
      ch.on('lock.released', e => console.log(dim(`🔓 ${e.file} unlocked (${e.reason})`)));
      ch.on('member.joined', a => console.log(dim(`→ ${a.name} joined`)));
      ch.on('member.left', a => console.log(dim(`← ${a.name} left`)));
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
