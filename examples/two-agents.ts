/**
 * Two agents coordinating on one channel: Planner opens a private channel and
 * shares its address, Builder joins by that address, they talk, and Builder
 * takes and releases a file lock while Planner sees the contention.
 *
 *   npx tsx examples/two-agents.ts                       # starts its own hub
 *   CROSSTALK_URL=ws://localhost:4488 npx tsx examples/two-agents.ts
 */
import { CrossTalk, CrossTalkError, startServer } from '../src/index.js';

const log = (who: string, text: string) => console.log(`${who.padEnd(8)} ${text}`);

async function main() {
  const own = process.env.CROSSTALK_URL ? undefined : await startServer({ port: 0, quiet: true });
  const url = process.env.CROSSTALK_URL ?? own!.url;

  const planner = await CrossTalk.connect({ name: 'Planner', role: 'lead', url });
  const builder = await CrossTalk.connect({ name: 'Builder', role: 'engineer', url });

  // Planner opens a private channel. Only agents given the address can join.
  const plan = await planner.createChannel('auth-refactor', { topic: 'Move sessions to JWT' });
  log('Planner', `opened "${plan.name}" at ${plan.address}`);

  // The address travels out of band (a DM on another channel, a PR comment, a prompt...).
  const build = await builder.joinChannel(plan.address);
  log('Builder', `joined; members: ${[...build.members.values()].map(m => m.name).join(', ')}`);

  plan.on('message', m => log('Planner', `<- ${m.from.name}: ${m.content}`));
  build.on('message', m => log('Builder', `<- ${m.from.name}: ${m.content}`));
  plan.on('lock.acquired', l => log('Planner', `sees ${l.holder.name} lock ${l.file} (${l.reason})`));
  plan.on('lock.released', e => log('Planner', `sees ${e.file} released (${e.reason})`));

  // Start waiting before sending so the reply can't slip past.
  const reply = builder.waitForMessage({ channel: build.address, timeoutMs: 5_000 });
  await plan.send('Can you take src/auth/session.ts? Swap the cookie store for signed JWTs.');
  await reply;

  const lock = await build.lock('src/auth/session.ts', 'JWT session store', 120);
  log('Builder', `locked ${lock.file} until ${new Date(lock.expiresAt).toLocaleTimeString()}`);
  await build.send('On it. Holding the lock while I edit.');

  // Planner tries to touch the same file and is turned away.
  try {
    await plan.lock('src/auth/session.ts', 'quick typo fix');
  } catch (err) {
    if (!(err instanceof CrossTalkError) || err.code !== 'lock_held') throw err;
    log('Planner', `lock refused: ${err.message}`);
  }

  await build.unlock('src/auth/session.ts');
  await build.shorthand('!REL @src/auth/session.ts &DONE &PROCEED');

  await new Promise(r => setTimeout(r, 200));
  await builder.close();
  await planner.close();
  await own?.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
