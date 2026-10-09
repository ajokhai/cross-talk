import { CrossTalkClient } from '../src/client/sdk.js';
import { green, cyan, yellow, red, magenta, bold } from 'colorette';

async function main() {
  console.log(bold(cyan('========================================================')));
  console.log(bold(cyan('⚡ Multi-Agent Coordination Simulation (CrossTalk & XDialect)')));
  console.log(bold(cyan('========================================================\n')));

  // Agent 1: Auth-Builder
  const agent1 = new CrossTalkClient({
    name: 'Auth-Builder',
    role: 'backend-engineer',
    environment: 'bot',
    currentTask: 'Implementing OAuth2 handler'
  });

  // Agent 2: Refactor-Bot
  const agent2 = new CrossTalkClient({
    name: 'Refactor-Bot',
    role: 'code-quality',
    environment: 'bot',
    currentTask: 'Refactoring auth interfaces'
  });

  await agent1.connect();
  console.log(green(`🤖 [Auth-Builder] Connected to mesh (${agent1.agentId})`));

  // 1. Agent 1 claims lock via XDialect shorthand
  const claimShorthand = '!LCK @src/auth.ts #FEAT "OAuth2 token verification" ~60 &WAIT';
  console.log(`\n📡 [Auth-Builder] Emitting XDialect: ${yellow(claimShorthand)}`);
  agent1.sendShorthand(claimShorthand);

  // Agent 1 listens for DMs
  agent1.on('direct_message', (msg) => {
    console.log(`\n📬 [Auth-Builder] DM received from ${bold(cyan(msg.from?.name))}: "${msg.content}"`);
  });

  // 2. Agent 2 connects 1 second later
  setTimeout(async () => {
    await agent2.connect();
    console.log(magenta(`\n🤖 [Refactor-Bot] Connected to mesh (${agent2.agentId})`));

    // Agent 2 tries to claim same file
    console.log(`🔍 [Refactor-Bot] Attempting to acquire lock on [src/auth.ts]...`);
    const lockRes = await agent2.lockFile('src/auth.ts', 'Refactoring auth controllers', 60);

    if (!lockRes.success) {
      console.log(red(`🚨 [Refactor-Bot] Collision detected! File held by ${bold(lockRes.holder?.name)}`));
      console.log(`   Reason:   "${lockRes.reason}"`);
      console.log(`   Action:   Holding off and messaging ${lockRes.holder?.name}...`);

      // Agent 2 DMs Agent 1
      agent2.sendDirectMessage(lockRes.holder?.id || '', '!DM "Hey, I need to touch src/auth.ts. Waiting for you to finish."');
    }

    // Agent 2 listens for release
    agent2.on('lock_released', async (data) => {
      if (data.file === 'src/auth.ts') {
        console.log(green(`\n🎉 [Refactor-Bot] Notified! [${data.file}] was released by ${data.releasedBy}!`));
        console.log(cyan(`   Acquiring lock now for refactoring...`));
        const retry = await agent2.lockFile('src/auth.ts', 'Refactoring auth controllers', 60);
        if (retry.success) {
          console.log(bold(green(`   ✔ [Refactor-Bot] Successfully claimed lock! Safe to edit.`)));
          
          setTimeout(() => {
            console.log(green(`\n🏁 Simulation finished successfully! Disconnecting bots.`));
            agent1.disconnect();
            agent2.disconnect();
            process.exit(0);
          }, 1000);
        }
      }
    });

    // 3. Agent 1 finishes work after 3 seconds and releases
    setTimeout(() => {
      console.log(bold(green(`\n✔ [Auth-Builder] Feature completed! Releasing [src/auth.ts] via XDialect...`)));
      agent1.sendShorthand('!REL @src/auth.ts &DONE &PROCEED');
    }, 3500);

  }, 1000);
}

main().catch(console.error);
