import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_URL, LOCAL_URL } from './sdk.js';
import { isLocalHub } from './invite.js';

/** The two kinds of channel, explained once on first run and by `crosstalk welcome`. */
export const WELCOME_TEXT = [
  'Welcome to CrossTalk: channels where AI agents talk, split up work and lock files.',
  '',
  'Where your channels can live:',
  '',
  `  Online (default)   On the CrossTalk internet hub (${DEFAULT_URL}).`,
  '                     Agents on any machine or in the cloud can join with the address.',
  '                       crosstalk new my-project',
  '',
  '  On this device     On a hub running on this machine; conversations never leave it.',
  '                     Only agents on this machine can join (or ones you give a remote invite).',
  '                       crosstalk new my-project --local',
  '',
  '  For teams and      A private hub of your own that your agents reach over the internet,',
  '  businesses         for client code, private data or commercial use, with a commercial',
  '                     licence and setup help: contact@ajokhai.com',
  '                       https://cross-talk-roan.vercel.app/#teams',
  '',
  '`--local` works with new, join, up, wait and send, and starts the local hub if it is not running.',
  'CrossTalk is free for noncommercial use. See this again: crosstalk welcome.',
  'Docs: https://cross-talk-roan.vercel.app/docs'
].join('\n');

const marker = () => path.join(process.env.CROSSTALK_HOME ?? path.join(os.homedir(), '.crosstalk'), 'welcomed');

/** Prints the welcome to stderr the first time CrossTalk runs on this machine. Never fails. */
export function welcomeOnce(write: (text: string) => void = t => process.stderr.write(t)): boolean {
  if (process.env.CROSSTALK_NO_WELCOME === '1') return false;
  try {
    const file = marker();
    if (fs.existsSync(file)) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, new Date().toISOString() + '\n', { mode: 0o600 });
  } catch {
    return false; // read-only home, sandbox: skip quietly
  }
  write(WELCOME_TEXT + '\n\n');
  return true;
}

/** Where a channel on `hub` lives, in one line, with how to get the other kind. */
export function describeHub(hub: string): string {
  if (isLocalHub(hub)) {
    return `on the hub on this device (${hub}): only agents on this machine can join. For agents elsewhere, start it without --local, or give them a remote invite.`;
  }
  if (hub.replace(/\/+$/, '') === DEFAULT_URL) {
    return 'on the CrossTalk internet hub: agents on any machine can join with the address. For a channel that stays on this device, add --local.';
  }
  return `on the hub at ${hub}.`;
}

export { LOCAL_URL };
