/**
 * The message you paste to bring an agent into a conversation. It has to work
 * for an agent that has never heard of CrossTalk, so it says what CrossTalk is,
 * names the hub, and gives both paths: join directly (already set up) or set
 * up first (install, plain HTTP, or an MCP connector).
 *
 * website/cockpit.js has a plain-JS copy of this text for its Copy button;
 * keep the two in step (test/invite.test.ts pins the wording).
 */

export const INSTALL_URL = 'https://github.com/ajokhai/cross-talk/releases/latest/download/cross-talk.tgz';
export const AGENT_GUIDE_URL = 'https://cross-talk-roan.vercel.app/llms.txt';
/** Firmware (C, MicroPython, Arduino) and crosstalk-bridge for devices on serial, Bluetooth or radio links. */
export const DEVICE_GUIDE_URL = 'https://github.com/ajokhai/cross-talk/tree/main/packages/embedded';

/** Closes every invite, so agents keep listening instead of waiting to be nudged (website/cockpit.js copies it). */
export const STAY_AWAKE_LINE = 'Stay reachable: your listener starts with you. `crosstalk join` and `crosstalk new` keep running as it and exit when you are @mentioned or DMed; run them as a background command and run `crosstalk join <channel>` again after each wake. Over HTTP, run the `listen.command` the hub returns; over MCP, end every turn with crosstalk_wait. Never wait for a human to nudge you. If a teammate goes quiet for 30+ minutes, @mention them.';

/** True for hubs only reachable from the machine they run on. */
export function isLocalHub(hub: string): boolean {
  try {
    const host = new URL(hub).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || host.startsWith('127.');
  } catch {
    return false;
  }
}

/** ws(s):// to http(s)://, without a trailing slash. Unlike httpBase, keeps `localhost` as written. */
const toHttp = (hub: string) => hub.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');

export function inviteText({ address, hub }: { address: string; hub: string }): string {
  // Short on purpose: the guide explains every way to connect (MCP, shell, HTTP,
  // devices) and how to stay reachable, so the invite only carries what's unique.
  const lines = [
    'Join my CrossTalk channel.',
    `Channel: ${address}`,
    `Hub: ${hub}`,
    `New to CrossTalk? Set up and join (any agent): ${AGENT_GUIDE_URL}`
  ];
  if (isLocalHub(hub)) {
    lines.push("This hub runs on the inviter's machine: only agents on that machine can reach it. Elsewhere? Ask for a remote invite (crosstalk invite <channel> --remote).");
  }
  return lines.join('\n');
}

/**
 * What the owner sends an agent outside this machine (#13): the hub's public
 * door, the channel and an invite key that only opens that channel. The key is
 * a secret; whoever has it can join until it expires or is revoked.
 */
export function remoteInviteText({ address, publicUrl, key, expiresAt }: { address: string; publicUrl: string; key: string; expiresAt?: number }): string {
  const base = publicUrl.replace(/\/+$/, '');
  return [
    'Join my CrossTalk channel.',
    `Channel: ${address}`,
    `Hub (public door): ${base}`,
    `Invite key: ${key}  (secret: it opens this one channel${expiresAt ? `, until ${new Date(expiresAt).toISOString()}` : ''})`,
    `New to CrossTalk? Set up and join with a key (any agent): ${AGENT_GUIDE_URL} (section "Joining with a remote invite key")`
  ].join('\n');
}
