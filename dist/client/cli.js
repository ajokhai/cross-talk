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
    .option('-s, --subnet <cidr>', 'Lock sockets to specific subnet (e.g. 192.168.1.0/24, lan, local)')
    .action((options) => {
    const port = parseInt(options.port, 10);
    const subnets = options.subnet ? [options.subnet] : undefined;
    startServer(port, options.host, undefined, subnets);
});
// Single-line command: up (Auto-joins or auto-creates socket mesh on the spot)
program
    .command('up [channel]')
    .description('Join a socket mesh channel in a single line (auto-spawns local socket if not yet running)')
    .option('-n, --name <name>', 'Agent display name', `Agent-${Math.floor(Math.random() * 9000 + 1000)}`)
    .option('-r, --role <role>', 'Agent role', 'developer')
    .option('-b, --branch <branch>', 'Git branch name (auto-detected from git if omitted)')
    .option('-u, --url <url>', 'Server WebSocket URL', 'ws://localhost:4488')
    .option('-s, --subnet <cidr>', 'Subnet lock CIDR (e.g. 192.168.1.0/24, lan, local)')
    .option('-p, --port <number>', 'Port to bind if auto-spawning', '4488')
    .action(async (channel = 'default', options) => {
    const port = parseInt(options.port, 10);
    console.log(bold(cyan(`\n⚡ Connecting to CrossTalk socket on #${channel}...`)));
    let client;
    try {
        client = new CrossTalkClient({
            url: options.url,
            channel,
            name: options.name,
            role: options.role,
            environment: 'terminal',
            branch: options.branch,
            currentTask: 'Interactive session'
        });
        await client.connect();
    }
    catch {
        console.log(yellow(`[CrossTalk] No socket hub detected at ${options.url}. Auto-spawning local socket mesh...`));
        const subnets = options.subnet ? [options.subnet] : undefined;
        startServer(port, '0.0.0.0', undefined, subnets);
        await new Promise(r => setTimeout(r, 400));
        client = new CrossTalkClient({
            url: options.url,
            channel,
            name: options.name,
            role: options.role,
            environment: 'terminal',
            branch: options.branch,
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
            }
            else {
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
        }
        else if (text.startsWith('/lock ')) {
            const parts = text.slice(6).split(' ');
            const file = parts[0];
            const reason = parts.slice(1).join(' ') || 'Editing file';
            const res = await client.lockFile(file, reason);
            if (res.success) {
                console.log(green(`✔ Locked [${file}]`));
            }
            else {
                console.log(red(`✖ Denied: Held by ${res.holder?.name} ("${res.reason}")`));
            }
        }
        else if (text.startsWith('/unlock ')) {
            const file = text.slice(8).trim();
            client.unlockFile(file);
            console.log(green(`✔ Released [${file}]`));
        }
        else if (text === '/who') {
            const s = await client.getMeshState();
            console.log(`Online: ${s.agents.map(a => `${a.name} (${a.currentTask})`).join(', ')}`);
            if (s.locks.length > 0) {
                console.log(`Locks: ${s.locks.map(l => `${l.file} by ${l.holderName}`).join(', ')}`);
            }
        }
        else if (text.startsWith('!') || text.startsWith('#')) {
            client.sendShorthand(text);
        }
        else {
            client.broadcast(text);
        }
        rl.prompt();
    });
    const keepalive = setInterval(() => { }, 15000);
    const shutdown = async () => {
        clearInterval(keepalive);
        console.log(yellow('\n[CrossTalk] Disconnecting gracefully...'));
        await client.disconnect('user_exit');
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
});
// Command: invite / pair / share
program
    .command('invite')
    .alias('pair')
    .alias('share')
    .description('Generate cross-branch agent pairing invite with 3 communication options')
    .option('-c, --channel <channel>', 'Channel name', 'default')
    .option('-b, --branch <branch>', 'My git branch name (auto-detected if omitted)')
    .option('-s, --subnet <cidr>', 'Subnet boundary lock (e.g. 192.168.1.0/24, lan, local)')
    .option('-u, --url <url>', 'Hub URL or host address', 'localhost:4488')
    .action(async (options) => {
    const { execSync } = await import('node:child_process');
    let branch = options.branch;
    if (!branch) {
        try {
            branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'main';
        }
        catch {
            branch = 'main';
        }
    }
    const host = options.url.replace(/^(http|https|ws|wss):\/\//, '');
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const subnetLock = options.subnet || (isLocal ? '192.168.0.0/16' : 'any');
    const crypto = await import('node:crypto');
    const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const branchTag = branch.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8).toUpperCase() || 'SYNC';
    const code = `XT-${randomSuffix}-${branchTag}`;
    console.log(bold(cyan(`\n⚡ CrossTalk Agent Pairing & Cross-Branch Bridge`)));
    console.log(`${gray('My Active Branch:')} ${bold(green(branch))}\n`);
    console.log(`Give your friend (or their agent) ${bold('ONE')} of these 3 options to connect:\n`);
    console.log(bold(cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)));
    console.log(bold(`Option 1: Central Hosted Relay (Zero-Config · Recommended)`));
    console.log(bold(cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)));
    console.log(`  🔑 Session Code:  ${bold(yellow(code))}`);
    console.log(`  🔗 Web Join Link: ${cyan(`http://${host}/?room=${code}&branch=${branch}`)}\n`);
    console.log(`  💬 ${bold('What to tell your friend\'s agent in chat:')}`);
    console.log(`     ${green(`"Join CrossTalk session ${code} on branch feature-ui"`)}\n`);
    console.log(`  💻 ${bold('What your friend runs in terminal:')}`);
    console.log(`     ${cyan(`crosstalk join ${code} --branch feature-ui`)}\n`);
    console.log(bold(cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)));
    console.log(bold(`Option 2: Open Mesh (Distributed Discovery Rendezvous)`));
    console.log(bold(cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)));
    console.log(`  🌐 Topic:         ${yellow(`mesh://open/repo-${branchTag.toLowerCase()}`)}\n`);
    console.log(`  💬 ${bold('What to tell your friend\'s agent in chat:')}`);
    console.log(`     ${green(`"Connect to open mesh channel 'team-${branchTag.toLowerCase()}' on branch feature-ui"`)}\n`);
    console.log(`  💻 ${bold('What your friend runs in terminal:')}`);
    console.log(`     ${cyan(`crosstalk up team-${branchTag.toLowerCase()} --mode mesh --branch feature-ui`)}\n`);
    console.log(bold(cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)));
    console.log(bold(`Option 3: Direct Computer-to-Computer (Subnet Locked P2P)`));
    console.log(bold(cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)));
    console.log(`  📡 Direct Socket: ${cyan(`ws://${host}`)}`);
    console.log(`  🔒 Subnet Lock:   ${yellow(subnetLock)} ${gray('(Strict boundary: external packets rejected)')}\n`);
    console.log(`  💬 ${bold('What to tell your friend\'s agent in chat:')}`);
    console.log(`     ${green(`"Connect directly to peer ws://${host} on branch feature-ui with subnet lock ${subnetLock}"`)}\n`);
    console.log(`  💻 ${bold('What your friend runs in terminal:')}`);
    console.log(`     ${cyan(`crosstalk join ws://${host} --branch feature-ui --subnet ${subnetLock}`)}\n`);
});
// Command: join <target>
program
    .command('join <target>')
    .description('Join a CrossTalk session using an invite code (XT-XXXX), URL, or direct address')
    .option('-n, --name <name>', 'Agent display name', `Agent-${Math.floor(Math.random() * 9000 + 1000)}`)
    .option('-r, --role <role>', 'Agent role', 'developer')
    .option('-b, --branch <branch>', 'My git branch name (auto-detected if omitted)')
    .option('-s, --subnet <cidr>', 'Subnet lock CIDR', 'any')
    .action(async (target, options) => {
    let url = 'ws://localhost:4488';
    let channel = 'default';
    if (target.startsWith('XT-')) {
        channel = target;
        console.log(bold(cyan(`\n⚡ Joining session via Invite Code ${bold(yellow(target))}...`)));
    }
    else if (target.startsWith('ws://') || target.startsWith('wss://')) {
        url = target;
        console.log(bold(cyan(`\n⚡ Connecting directly to peer socket at ${cyan(url)}...`)));
    }
    else if (target.startsWith('http://') || target.startsWith('https://')) {
        try {
            const parsed = new URL(target);
            url = (parsed.protocol === 'https:' ? 'wss://' : 'ws://') + parsed.host;
            channel = parsed.searchParams.get('room') || 'default';
            console.log(bold(cyan(`\n⚡ Joining session via URL ${cyan(target)}...`)));
        }
        catch {
            channel = target;
        }
    }
    else {
        channel = target;
    }
    const client = new CrossTalkClient({
        url,
        channel,
        name: options.name,
        role: options.role,
        branch: options.branch,
        environment: 'terminal',
        currentTask: `Active in session #${channel}`
    });
    try {
        await client.connect();
        console.log(bold(green(`✔ Successfully linked to CrossTalk session [${channel}] on branch [${client['options']?.branch || 'main'}]!`)));
        console.log(gray('Cooperative file locks and peer notifications active.\n'));
        client.on('broadcast', (msg) => {
            if (!client.shouldSuppressAutoReply(msg) && msg.from?.id !== client.agentId) {
                const senderBranch = msg.branch ? ` (${msg.branch})` : '';
                console.log(`📢 ${bold(cyan((msg.from?.name || 'Peer') + senderBranch))}: ${msg.content}`);
            }
        });
        client.on('direct_message', (msg) => {
            if (!client.shouldSuppressAutoReply(msg) && msg.from?.id !== client.agentId) {
                const senderBranch = msg.branch ? ` (${msg.branch})` : '';
                console.log(`🔒 ${bold(magenta(`DM from ${(msg.from?.name || 'Peer') + senderBranch}`))}: ${msg.content}`);
            }
        });
        client.on('lock_acquired', (lock) => {
            const branchTag = lock.branch ? ` [branch: ${lock.branch}]` : '';
            console.log(`🔒 ${yellow(`LOCK ACQUIRED:`)} [${lock.file}] by ${bold(lock.holderName)}${branchTag} ("${lock.reason}")`);
        });
        client.on('lock_released', (data) => {
            console.log(`🔓 ${green(`LOCK RELEASED:`)} [${data.file}] by ${bold(data.releasedBy)}`);
        });
        const keepalive = setInterval(() => { }, 15000);
        const shutdown = async () => {
            clearInterval(keepalive);
            console.log(yellow('\n[CrossTalk] Disconnecting gracefully...'));
            await client.disconnect('user_exit');
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
    catch (err) {
        console.error(red(`\n✖ Connection failed: ${err.message}`));
        process.exit(1);
    }
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
        }
        else {
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
        }
        else {
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
    }
    catch (err) {
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
    }
    catch (err) {
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
    }
    catch (err) {
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
        }
        else {
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
    }
    catch (err) {
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
    }
    catch (err) {
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
            }
            else {
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
    }
    catch (err) {
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
        }
        else {
            // Test write access to /usr/local/bin
            try {
                fs.accessSync('/usr/local/bin', fs.constants.W_OK);
                targetDir = '/usr/local/bin';
            }
            catch {
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
        }
        else {
            console.log(green(`✔ Directory is in your PATH. You can immediately run:`));
            console.log(bold(`  ${binName} who`));
            console.log(bold(`  ${binName} up`));
            console.log(bold(`  ${binName} serve`));
            console.log(bold(`  ${binName} dict\n`));
        }
    }
    catch (err) {
        console.error(bold(red(`\n✖ Installation failed: ${err.message}`)));
        console.log(`Try running with sudo if installing to /usr/local/bin: sudo node ${process.argv[1]} install\n`);
    }
});
program.parse(process.argv);
