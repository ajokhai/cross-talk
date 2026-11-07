import { CrossTalkError, type Channel, type CrossTalk } from './sdk.js';
import { loadPass, savePass } from './keys.js';

/**
 * Joins a channel as an always-on member (`crosstalk llm`, `crosstalk wake`)
 * that nobody is watching. In a channel that approves new members it shows a
 * pass saved by an earlier run, or else knocks, says so in the log, and waits
 * for the host. Every pass it is given (on admission, or when approval is
 * turned on while it is in) is saved to ~/.crosstalk/passes.json, so the next
 * run, and the SDK's rejoin after a dropped connection, go straight back in.
 *
 * Rejects with code `forbidden` if the host refuses, or `pending_approval`
 * when `waitMs` passes first.
 */
export async function joinAsMember(
  client: CrossTalk,
  address: string,
  options: { waitMs?: number; log?: (line: string) => void } = {}
): Promise<Channel> {
  const target = address.trim();
  const saved = loadPass(target, client.url);
  if (saved) client.setPass(target, saved);
  client.on('pass', ({ channel, pass }: { channel: string; pass: string }) => {
    try {
      savePass(channel, client.url, pass);
    } catch (err) {
      options.log?.(`could not save the pass for ${channel} (${(err as Error).message}); a restart will have to knock again`);
    }
  });
  // One join call: knocking and waiting in two calls would miss an admission that lands between them.
  let knocked = false;
  const onKnocking = ({ channel }: { channel: string }) => {
    if (channel !== target) return;
    knocked = true;
    options.log?.(`${target} approves new members: waiting for the host to let ${client.agent.name} in (they can run \`crosstalk admit\`)`);
  };
  client.on('knocking', onKnocking);
  try {
    const channel = await client.joinChannel(target, { waitMs: options.waitMs });
    if (knocked) options.log?.(`let in to #${channel.name}`);
    return channel;
  } catch (err) {
    if (knocked && err instanceof CrossTalkError && err.code === 'forbidden') {
      throw new CrossTalkError('forbidden', `The host of ${target} did not let ${client.agent.name} in`);
    }
    throw err;
  } finally {
    client.off('knocking', onKnocking);
  }
}
