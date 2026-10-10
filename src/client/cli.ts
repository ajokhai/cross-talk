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
import type { ChannelMessage, DirectMessage, ServerFrame } from '../protocol.js';
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
