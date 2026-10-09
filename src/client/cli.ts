#!/usr/bin/env node
import { Command } from 'commander';
import { CrossTalkClient } from './sdk.js';
import { startServer } from '../server/index.js';
import { DIALECT_V1 } from '../dialect/dictionary.js';
import { DialectEngine } from '../dialect/engine.js';
import { green, cyan, yellow, red, blue, magenta, bold, gray } from 'colorette';
import readline from 'node:readline';

const program = new Command();

program
  .name('crosstalk')
  .description('Real-time WebSocket mesh network for AI agent inter-communication, Gibberlink signals & XDialect')
  .version('1.0.0');

// Command: serve
program
  .command('serve')
  .description('Start the CrossTalk mesh hub server and web dashboard')
  .option('-p, --port <number>', 'Port to listen on', '4488')
  .option('-h, --host <host>', 'Host address to bind (0.0.0.0 for LAN/Wi-Fi)', '0.0.0.0')
  .action((options) => {
    const port = parseInt(options.port, 10);
    startServer(port, options.host);
  });

// Single-line command: up / join (Auto-joins or auto-creates socket mesh on the spot)
program
  .command('up [channel]')
  .alias('join')
  .description('Join a socket mesh channel in a single line (auto-spawns local socket if not yet running)')
  .option('-n, --name <name>', 'Agent display name', `Agent-${Math.floor(Math.random() * 9000 + 1000)}`)
  .option('-r, --role <role>', 'Agent role', 'developer')
  .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
  .option('-p, --port <number>', 'Port to bind if auto-spawning', '4488')
  .action(async (channel = 'default', options) => {
    const port = parseInt(options.port, 10);
    console.log(bold(cyan(`\n⚡ Connecting to CrossTalk socket on #${channel}...`)));

    let client: CrossTalkClient;
    try {
      client = new CrossTalkClient({
        url: options.url,
        channel,
        name: options.name,
        role: options.role,
        environment: 'terminal',
        currentTask: 'Interactive session'
      });
      await client.connect();
    } catch {
      console.log(yellow(`[CrossTalk] No socket hub detected at ${options.url}. Auto-spawning local socket mesh...`));
      startServer(port, '0.0.0.0');
      await new Promise(r => setTimeout(r, 400));
      client = new CrossTalkClient({
        url: options.url,
        channel,
        name: options.name,
        role: options.role,
        environment: 'terminal',
        currentTask: 'Interactive session'
      });
      await client.connect();
    }

    console.log(bold(green(`✔ Online in channel #${channel} as [${options.name}] (${client.agentId})`)));
    console.log(gray('Type your message or XDialect shorthand (!LCK @file, !REL @file, &WAIT):'));
    console.log(gray('Commands: /who, /lock <file>, /unlock <file>, /exit\n'));

    client.on('broadcast', (msg) => {
      if (msg.from?.id !== client.agentId) {
        if (msg.type === 'dialect_shorthand' && msg.shorthand) {
          console.log(`\n⚡ ${bold(magenta(`XDialect`))} from ${bold(cyan(msg.from?.name))}: ${yellow(msg.shorthand.raw)}`);
          console.log(`   └─> "${gray(msg.shorthand.human)}"`);
        } else {
          console.log(`\n📢 ${bold(cyan(msg.from?.name || 'System'))}: ${msg.content}`);
        }
        process.stdout.write('> ');
      }
    });

    client.on('direct_message', (msg) => {
      if (msg.from?.id !== client.agentId) {
        console.log(`\n🔒 ${bold(magenta(`DM from ${msg.from?.name}`))}: ${msg.content}`);
        process.stdout.write('> ');
      }
    });

    client.on('lock_acquired', (lock) => {
      console.log(`\n🔒 [MESH] ${bold(lock.holderName)} claimed [${yellow(lock.file)}] ("${lock.reason}")`);
      process.stdout.write('> ');
    });

    client.on('lock_released', (data) => {
      console.log(`\n🔓 [MESH] [${yellow(data.file)}] unlocked by ${bold(data.releasedBy)}`);
      process.stdout.write('> ');
    });

    client.on('lock_conflict_warning', (warn) => {
      console.log(`\n🚨 ${red(`[ALERT] ${warn.requester.name} requested [${warn.file}] which you hold!`)}`);
      process.stdout.write('> ');
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const text = line.trim();
      if (!text) {
        rl.prompt();
        return;
      }

      if (text === '/exit' || text === '/quit') {
        client.disconnect();
        process.exit(0);
      } else if (text.startsWith('/lock ')) {
        const parts = text.slice(6).split(' ');
        const file = parts[0];
        const reason = parts.slice(1).join(' ') || 'Editing file';
        const res = await client.lockFile(file, reason);
        if (res.success) {
          console.log(green(`✔ Locked [${file}]`));
        } else {
          console.log(red(`✖ Denied: Held by ${res.holder?.name} ("${res.reason}")`));
        }
      } else if (text.startsWith('/unlock ')) {
        const file = text.slice(8).trim();
        client.unlockFile(file);
        console.log(green(`✔ Released [${file}]`));
      } else if (text === '/who') {
        const s = await client.getMeshState();
        console.log(`Online: ${s.agents.map(a => `${a.name} (${a.currentTask})`).join(', ')}`);
        if (s.locks.length > 0) {
          console.log(`Locks: ${s.locks.map(l => `${l.file} by ${l.holderName}`).join(', ')}`);
        }
      } else if (text.startsWith('!') || text.startsWith('#')) {
        client.sendShorthand(text);
      } else {
        client.broadcast(text);
      }
      rl.prompt();
    });
  });

// Command: who
program
  .command('who')
  .description('List all active agents and file locks on the mesh')
  .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
  .action(async (options) => {
    const client = new CrossTalkClient({
      url: options.url,
      name: 'CLI-Observer',
      role: 'observer',
      environment: 'terminal',
      autoHeartbeat: false
    });

    try {
      const state = await client.connect();
      console.log(`\n${bold(cyan('=== CrossTalk Active Mesh State ==='))}`);
      console.log(`Channel: ${bold('#' + state.channel)}`);
      console.log(`Dialect: ${bold('XDialect v' + state.dialect.version)}\n`);

      console.log(bold('Connected Agents:'));
      if (state.agents.length === 0) {
        console.log(gray('  (No active agents currently connected)'));
      } else {
        state.agents.forEach((a) => {
          const statusColor = a.status === 'working' ? green : a.status === 'waiting' ? yellow : blue;
          console.log(`  🤖 ${bold(a.name)} (${cyan(a.role)} · ${gray(a.environment)})`);
          console.log(`     ID:       ${gray(a.id)}`);
          console.log(`     Status:   ${statusColor(a.status.toUpperCase())}`);
          console.log(`     Task:     ${a.currentTask}`);
          if (a.lockedFiles && a.lockedFiles.length > 0) {
            console.log(`     Locks:    ${yellow(a.lockedFiles.join(', '))}`);
          }
          console.log('');
        });
      }

      console.log(bold('Active File Claims:'));
      if (state.locks.length === 0) {
        console.log(gray('  (No files currently locked)'));
      } else {
        const now = Date.now();
        state.locks.forEach((l) => {
          const rem = Math.max(0, Math.round((l.expiresAt - now) / 1000));
          console.log(`  🔒 ${yellow(l.file)}`);
          console.log(`     Holder:   ${bold(l.holderName)} (${gray(l.holderId)})`);
          console.log(`     Reason:   "${l.reason}"`);
          console.log(`     Expires:  ${rem}s remaining\n`);
        });
      }

      client.disconnect();
      process.exit(0);
    } catch (err: any) {
      console.error(red(`Failed to connect to CrossTalk mesh: ${err.message}`));
      process.exit(1);
    }
  });

// Command: dict (View Versioned Dictionary)
program
  .command('dict')
  .description('Print the active versioned XDialect token dictionary for agent shorthand')
  .action(() => {
    console.log(`\n${bold(cyan(`📖 XDialect Dictionary (v${DIALECT_V1.version}))`))}`);
    console.log(gray(`Checksum: ${DIALECT_V1.checksum} | Updated: ${DIALECT_V1.updatedAt}\n`));

    console.log(bold('Token Catalog:'));
    console.log(`${gray('Code'.padEnd(10))} ${gray('ID'.padEnd(8))} ${gray('Category'.padEnd(12))} ${gray('Meaning')}`);
    console.log(gray('─'.repeat(70)));

    Object.values(DIALECT_V1.tokens).forEach((tok) => {
      const codeStr = tok.code.startsWith('!') ? green(tok.code.padEnd(10)) :
                      tok.code.startsWith('#') ? cyan(tok.code.padEnd(10)) :
                      tok.code.startsWith('&') ? yellow(tok.code.padEnd(10)) :
                      magenta(tok.code.padEnd(10));
      const idStr = ('0x' + tok.numericId.toString(16)).padEnd(8);
      console.log(`${codeStr} ${gray(idStr)} ${tok.category.padEnd(12)} ${tok.meaning}`);
    });

    console.log(`\n${bold('Grammar Format:')} ${yellow(DIALECT_V1.grammar.format)}\n`);
    console.log(bold('Examples:'));
    DIALECT_V1.grammar.examples.forEach((ex) => {
      console.log(`  ${green(ex.shorthand)}`);
      console.log(`  └─> ${gray(ex.human)}\n`);
    });
  });

// Command: short (Send shorthand dialect)
program
  .command('short <expression>')
  .description('Send an ultra-concise XDialect shorthand message to the mesh')
  .option('-n, --name <name>', 'Agent display name', 'Terminal-Agent')
  .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
  .action(async (expression, options) => {
    const parsed = DialectEngine.parse(expression);
    const human = DialectEngine.toHuman(parsed);
    const bits = DialectEngine.packToBits(parsed);

    const client = new CrossTalkClient({
      url: options.url,
      name: options.name,
      role: 'developer',
      environment: 'terminal'
    });

    try {
      await client.connect();
      client.sendShorthand(expression);

      console.log(`\n${green('✔ XDialect Message Dispatched!')}`);
      console.log(`  Shorthand: ${bold(cyan(expression))}`);
      console.log(`  Wire Size: ${yellow(bits.length + ' bytes')} (vs ~${Buffer.byteLength(human)} bytes in English)`);
      console.log(`  English:   "${gray(human)}"\n`);

      setTimeout(() => {
        client.disconnect();
        process.exit(0);
      }, 500);
    } catch (err: any) {
      console.error(red(`Dispatch failed: ${err.message}`));
      process.exit(1);
    }
  });

// Command: to-human
program
  .command('to-human <shorthand>')
  .description('Translate shorthand expression to natural human English')
  .action((shorthand) => {
    const parsed = DialectEngine.parse(shorthand);
    const human = DialectEngine.toHuman(parsed);
    const bits = DialectEngine.packToBits(parsed);
    console.log(`\nShorthand: ${bold(cyan(shorthand))}`);
    console.log(`Bits:      ${yellow(bits.length + ' bytes')}`);
    console.log(`English:   ${green(human)}\n`);
  });

// Command: to-zh
program
  .command('to-zh <shorthand>')
  .description('Expand concise XDialect shorthand to natural Chinese (中文展开)')
  .action((shorthand) => {
    const zh = DialectEngine.toChinese(shorthand);
    const bits = DialectEngine.packToBits(shorthand);
    console.log(`\nShorthand: ${bold(cyan(shorthand))}`);
    console.log(`Bits:      ${yellow(bits.length + ' bytes')}`);
    console.log(`中文翻译:  ${green(zh)}\n`);
  });

// Command: to-short
program
  .command('to-short <english>')
  .description('Compile natural human English sentence to concise XDialect shorthand')
  .action((english) => {
    const shorthand = DialectEngine.fromHuman(english);
    const bits = DialectEngine.packToBits(shorthand);
    console.log(`\nEnglish:   ${gray(english)}`);
    console.log(`Shorthand: ${bold(cyan(shorthand))}`);
    console.log(`Bits:      ${yellow(bits.length + ' bytes')}\n`);
  });

// Command: broadcast
program
  .command('broadcast <message>')
  .alias('msg')
  .description('Broadcast an announcement or status to all agents on the mesh')
  .option('-n, --name <name>', 'Agent display name', 'Terminal-Agent')
  .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
  .action(async (message, options) => {
    const client = new CrossTalkClient({
      url: options.url,
      name: options.name,
      role: 'developer',
      environment: 'terminal'
    });

    try {
      await client.connect();
      client.broadcast(message);
      console.log(`${green('✔')} Broadcast sent: "${cyan(message)}"`);
      setTimeout(() => {
        client.disconnect();
        process.exit(0);
      }, 500);
    } catch (err: any) {
      console.error(red(`Broadcast failed: ${err.message}`));
      process.exit(1);
    }
  });

// Command: lock
program
  .command('lock <file>')
  .description('Acquire an exclusive lock on a file with reason')
  .option('-r, --reason <reason>', 'Reason for editing', 'Refactoring file')
  .option('-t, --ttl <seconds>', 'Time to hold lock in seconds', '300')
  .option('-n, --name <name>', 'Agent display name', 'Terminal-Agent')
  .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
  .action(async (file, options) => {
    const client = new CrossTalkClient({
      url: options.url,
      name: options.name,
      role: 'developer',
      environment: 'terminal'
    });

    try {
      await client.connect();
      const ttl = parseInt(options.ttl, 10);
      const res = await client.lockFile(file, options.reason, ttl);

      if (res.success) {
        console.log(`${green('✔ Lock Acquired!')}`);
        console.log(`  File:    ${yellow(file)}`);
        console.log(`  Holder:  ${bold(options.name)}`);
        console.log(`  Reason:  "${options.reason}"`);
        console.log(`  TTL:     ${ttl}s`);
      } else {
        console.log(`${red('✖ Lock DENIED — File is currently held by another agent!')}`);
        console.log(`  File:    ${yellow(file)}`);
        console.log(`  Holder:  ${bold(res.holder?.name || 'Unknown')} (${gray(res.holder?.id || '')})`);
        console.log(`  Reason:  "${res.reason}"`);
        console.log(`  Expires: ${res.expiresAt ? Math.round((res.expiresAt - Date.now()) / 1000) + 's' : 'active'}`);
      }

      setTimeout(() => {
        client.disconnect();
        process.exit(res.success ? 0 : 2);
      }, 500);
    } catch (err: any) {
      console.error(red(`Lock request failed: ${err.message}`));
      process.exit(1);
    }
  });

// Command: unlock
program
  .command('unlock <file>')
  .description('Release a previously claimed file lock')
  .option('-n, --name <name>', 'Agent display name', 'Terminal-Agent')
  .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
  .action(async (file, options) => {
    const client = new CrossTalkClient({
      url: options.url,
      name: options.name,
      role: 'developer',
      environment: 'terminal'
    });

    try {
      await client.connect();
      client.unlockFile(file);
      console.log(`${green('✔')} Sent release request for file: ${yellow(file)}`);
      setTimeout(() => {
        client.disconnect();
        process.exit(0);
      }, 500);
    } catch (err: any) {
      console.error(red(`Unlock failed: ${err.message}`));
      process.exit(1);
    }
  });

// Command: tail
program
  .command('tail')
  .description('Stream live messages, locks, and events from the mesh in real time')
  .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
  .action(async (options) => {
    const client = new CrossTalkClient({
      url: options.url,
      name: 'Stream-Watcher',
      role: 'watcher',
      environment: 'terminal'
    });

    try {
      await client.connect();
      console.log(bold(cyan('\n📡 Streaming CrossTalk Mesh Events (Press Ctrl+C to exit)...\n')));

      client.on('broadcast', (msg) => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        if (msg.type === 'dialect_shorthand' && msg.shorthand) {
          console.log(`${gray(`[${time}]`)} ⚡ ${bold(magenta(`XDialect`))} from ${bold(cyan(msg.from?.name || 'Agent'))}:`);
          console.log(`     Shorthand: ${yellow(msg.shorthand.raw)} (${msg.shorthand.bitSize} bytes)`);
          console.log(`     English:   "${gray(msg.shorthand.human)}"`);
        } else {
          console.log(`${gray(`[${time}]`)} 📢 ${bold(cyan(msg.from?.name || 'System'))}: ${msg.content}`);
        }
      });

      client.on('direct_message', (msg) => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        console.log(`${gray(`[${time}]`)} 🔒 ${bold(magenta(`DM from ${msg.from?.name}`))}: ${msg.content}`);
      });

      client.on('lock_acquired', (lock) => {
        console.log(`🔒 ${yellow(`LOCK ACQUIRED:`)} [${lock.file}] by ${bold(lock.holderName)} ("${lock.reason}")`);
      });

      client.on('lock_released', (data) => {
        console.log(`🔓 ${green(`LOCK RELEASED:`)} [${data.file}] by ${bold(data.releasedBy)}`);
      });

      client.on('lock_conflict_warning', (warn) => {
        console.log(`🚨 ${red(`CONFLICT ALERT:`)} Agent ${bold(warn.requester.name)} tried to touch [${warn.file}] held by ${bold(warn.holder.name)}!`);
      });

      client.on('agent_joined', (agent) => {
        console.log(`➕ ${green(`AGENT JOINED:`)} ${bold(agent.name)} (${agent.role} · ${agent.environment})`);
      });

      client.on('agent_left', (agent) => {
        console.log(`➖ ${gray(`AGENT LEFT:`)} ${bold(agent.name)}`);
      });
    } catch (err: any) {
      console.error(red(`Streaming failed: ${err.message}`));
      process.exit(1);
    }
  });

// Command: install (Offline single-file installer to system PATH)
program
  .command('install')
  .description('Install this standalone CrossTalk CLI to system PATH (works 100% offline from a single file)')
  .option('-d, --dir <directory>', 'Destination directory (defaults to /usr/local/bin or ~/.local/bin)')
  .option('-n, --name <name>', 'Command binary name', 'crosstalk')
  .action(async (options) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const binName = options.name || 'crosstalk';
    let targetDir = options.dir;

    if (!targetDir) {
      const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
      if (isRoot) {
        targetDir = '/usr/local/bin';
      } else {
        // Test write access to /usr/local/bin
        try {
          fs.accessSync('/usr/local/bin', fs.constants.W_OK);
          targetDir = '/usr/local/bin';
        } catch {
          targetDir = path.join(os.homedir(), '.local', 'bin');
        }
      }
    }

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const sourceFile = process.argv[1];
      const targetFile = path.join(targetDir, binName);

      fs.copyFileSync(sourceFile, targetFile);
      fs.chmodSync(targetFile, 0o755);

      console.log(bold(green(`\n✔ CrossTalk v1.0.0 successfully installed to ${targetFile}!`)));
      console.log(cyan(`✔ Air-gapped offline installation complete without internet connection.`));

      const pathEnv = process.env.PATH || '';
      if (!pathEnv.includes(targetDir)) {
        console.log(yellow(`\n⚠️  Notice: ${targetDir} is not currently in your system PATH.`));
        console.log(`Add it to your shell profile by running:`);
        console.log(bold(`  echo 'export PATH="${targetDir}:$PATH"' >> ~/.bashrc (or ~/.zshrc)`));
        console.log(`  source ~/.bashrc\n`);
      } else {
        console.log(green(`✔ Directory is in your PATH. You can immediately run:`));
        console.log(bold(`  ${binName} who`));
        console.log(bold(`  ${binName} up`));
        console.log(bold(`  ${binName} serve`));
        console.log(bold(`  ${binName} dict\n`));
      }
    } catch (err: any) {
      console.error(bold(red(`\n✖ Installation failed: ${err.message}`)));
      console.log(`Try running with sudo if installing to /usr/local/bin: sudo node ${process.argv[1]} install\n`);
    }
  });

program.parse(process.argv);
