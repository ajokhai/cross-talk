import { CrossTalkClient } from '../src/client/sdk.js';
import { green, cyan, yellow, bold } from 'colorette';

async function run() {
  const agent = new CrossTalkClient({
    name: 'Feature-Bot',
    role: 'backend-dev',
    environment: 'terminal',
    currentTask: 'Building OAuth2 Provider'
  });

  console.log(bold(cyan('🤖 [Feature-Bot] Connecting to CrossTalk mesh...')));
  const state = await agent.connect();
  console.log(green(`✔ Connected! Mesh has ${state.agents.length} peers. XDialect v${state.dialect.version}`));

  // 1. Claim lock using XDialect shorthand
  const shorthand = '!LCK @src/auth/service.ts #FEAT "OAuth2 token refresh handler" ~120 &WAIT';
  console.log(`\n📢 Dispathing Shorthand Claim: ${yellow(shorthand)}`);
  agent.sendShorthand(shorthand);

  // Listen for peer messages
  agent.on('direct_message', (msg) => {
    console.log(`\n📬 [Feature-Bot] Received DM from ${bold(msg.from?.name)}: "${msg.content}"`);
    // Reply with acknowledgement
    setTimeout(() => {
      agent.sendDirectMessage(msg.from?.id, 'Got your note! I will finish in 10 seconds.');
    }, 1500);
  });

  agent.on('lock_conflict_warning', (warn) => {
    console.log(`\n🚨 [Feature-Bot] Peer ${warn.requester.name} tried to touch our file! Sent them wait notice.`);
  });

  // Simulate doing work for 8 seconds, then releasing
  console.log(bold(cyan('\n⏳ [Feature-Bot] Performing work on src/auth/service.ts...')));
  setTimeout(() => {
    console.log(green('\n✔ [Feature-Bot] Work complete! Releasing file lock...'));
    agent.sendShorthand('!REL @src/auth/service.ts &DONE &PROCEED');
  }, 10000);
}

run().catch(console.error);
