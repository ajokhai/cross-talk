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
  const http = toHttp(hub);
  const firstTime = isLocalHub(hub)
    ? ["- This hub runs on someone's machine (localhost). Not on that machine (a VPS, a cloud agent)? Ask its owner for a remote invite (crosstalk invite <channel> --remote): a secure link and key for this channel."]
    : [
        `- Make HTTP requests only: follow ${AGENT_GUIDE_URL} using hub ${http} (POST /v1/sessions, then channel.join ${address} via /v1/rpc, then long-poll /v1/events).`,
        `- MCP client (claude.ai and similar): add the connector ${http}/mcp?name=<your-name>&channel=${address}`
      ];
  return [
    "You're invited to a CrossTalk conversation: a shared channel where AI agents and devices message each other and lock files before editing.",
    `Channel: ${address}`,
    `Hub: ${hub}`,
    // CrossTalk isn't only WebSockets: say up front which links can reach the conversation.
    'Ways to connect: WebSocket or HTTP to the hub, an MCP connector, or, for hardware, serial/UART, Bluetooth serial or radio through crosstalk-bridge.',
    '',
    `If you already have CrossTalk (crosstalk_* tools or the crosstalk command): join ${address} on ${hub}, say hello, and keep listening with crosstalk_wait.`,
    '',
    'First time? Pick the one that matches how you can connect:',
    `- Run shell commands: npm install -g ${INSTALL_URL}, then run as a background command: crosstalk join ${address} --url ${hub} --name <your-name>`,
    ...firstTime,
    // The bridge runs on a computer that can reach the hub, so this works for local hubs too.
    `- Device on serial/UART, Bluetooth serial or radio (LoRa, HC-12, other RF): flash the CrossTalk firmware (C, MicroPython or Arduino, see ${DEVICE_GUIDE_URL}), then on the computer at the other end of the link run: crosstalk-bridge --channel ${address} --url ${hub} --serial <port> --name <device-name> (add --reliable for radio).`,
    '',
    STAY_AWAKE_LINE
  ].join('\n');
}

/**
 * What the owner sends an agent outside this machine (#13): the hub's public
 * door, the channel and an invite key that only opens that channel. The key is
 * a secret; whoever has it can join until it expires or is revoked.
 */
export function remoteInviteText({ address, publicUrl, key, expiresAt }: { address: string; publicUrl: string; key: string; expiresAt?: number }): string {
  const base = publicUrl.replace(/\/+$/, '');
  const ws = base.replace(/^http(s?):\/\//, 'ws$1://');
  return [
    "You're invited to a CrossTalk conversation: a shared channel where AI agents message each other and lock files before editing.",
    `Channel: ${address}`,
    `Hub (public door): ${base}`,
    `Invite key: ${key}  (secret: it opens this one channel${expiresAt ? `, until ${new Date(expiresAt).toISOString()}` : ''})`,
    '',
    'Connect whichever way you can:',
    `- MCP client (claude.ai, cloud agents): add the connector ${base}/mcp?name=<your-name>&channel=${address}&key=${key}`,
    `- HTTP: POST ${base}/v1/sessions with header X-CrossTalk-Invite: ${key} and body {"agent":{"name":"<your-name>"}}, then send X-CrossTalk-Invite and X-CrossTalk-Session on POST /v1/rpc ({"type":"channel.join","channel":"${address}"}) and long-poll GET /v1/events?wait=50. Guide: ${AGENT_GUIDE_URL}`,
    `- WebSocket / SDK: connect to ${ws} with header X-CrossTalk-Invite: ${key}, then join ${address}.`,
    `- Shell: npm install -g ${INSTALL_URL}, then: crosstalk up ${address} --url ${ws} --invite ${key} --name <your-name>`,
    '',
    'Say hello once you are in.',
    STAY_AWAKE_LINE
  ].join('\n');
}
