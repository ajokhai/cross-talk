import { CrossTalkClient } from '../src/client/sdk.js';
import { red, green, yellow, cyan, bold } from 'colorette';

async function run() {
  const agent = new CrossTalkClient({
    name: 'Refactor-Bot',
    role: 'refactor-specialist',
    environment: 'terminal',
    currentTask: 'Refactoring Auth Interfaces'
  });

  console.log(bold(cyan('🤖 [Refactor-Bot] Connecting to CrossTalk mesh...')));
  await agent.connect();
  console.log(green('✔ Connected to mesh!'));

  const targetFile = 'src/auth/service.ts';

  // 1. Attempt to claim lock on same file
  console.log(`\n🔍 [Refactor-Bot] Attempting to claim [${targetFile}]...`);
  const res = await agent.lockFile(targetFile, 'Refactoring token interfaces', 60);

  if (!res.success) {
    console.log(red(`\n✖ [Refactor-Bot] Collision detected! File is locked by ${bold(res.holder?.name || 'Peer')}`));
    console.log(`   Reason:   "${res.reason}"`);
    console.log(`   Expires:  ${res.expiresAt ? Math.round((res.expiresAt - Date.now()) / 1000) + 's' : 'active'}`);

    // 2. Politely message the holding agent
    if (res.holder?.id) {
      console.log(yellow(`\n💬 [Refactor-Bot] Sending DM to ${res.holder.name} asking for status...`));
      agent.sendDirectMessage(res.holder.id, 'Hey! I need to touch src/auth/service.ts too. Let me know when you are done!');
    }
  } else {
    console.log(bold(green(`\n✔ [Refactor-Bot] Lock acquired directly on [${targetFile}]! No conflicts.`)));
  }

  // 3. Listen for release signal
  agent.on('lock_released', async (data) => {
    if (data.file === targetFile) {
      console.log(green(`\n🎉 [Refactor-Bot] Notified! ${data.file} was just released by ${data.releasedBy}!`));
      console.log(cyan(`   Acquiring lock now for refactoring...`));
      const retry = await agent.lockFile(targetFile, 'Refactoring auth interfaces now', 60);
      if (retry.success) {
        console.log(bold(green(`   ✔ Lock acquired successfully! Starting refactor.`)));
      }
    }
  });

  agent.on('direct_message', (msg) => {
    console.log(`\n📬 [Refactor-Bot] Got response from ${msg.from?.name}: "${msg.content}"`);
  });
}

run().catch(console.error);
