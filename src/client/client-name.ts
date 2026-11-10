import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * Which tool an agent runs in ("Claude Code", "Gemini CLI", "Codex"), shown
 * next to its name (2.23+). $CROSSTALK_CLIENT wins; otherwise a few tools are
 * recognised by what they set in the environment, and MCP clients by the name
 * they introduce themselves with.
 */

const KNOWN: [RegExp, string][] = [
  [/^claude[-_ ]?code/i, 'Claude Code'],
  [/^claude[-_ ]?(ai|desktop)|^claude$/i, 'Claude'],
  [/gemini/i, 'Gemini CLI'],
  [/codex/i, 'Codex'],
  [/cursor/i, 'Cursor'],
  [/windsurf|codeium/i, 'Windsurf'],
  [/copilot|visual studio code|vscode/i, 'VS Code'],
  [/zed/i, 'Zed'],
  [/cline/i, 'Cline'],
  [/goose/i, 'Goose'],
  [/chatgpt|openai/i, 'ChatGPT'],
  [/antigravity/i, 'Antigravity']
];

/** A friendly name for an MCP client's clientInfo.name; unknown names pass through, tidied. */
export function friendlyClient(name: unknown): string | undefined {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const n = name.trim();
  for (const [re, label] of KNOWN) if (re.test(n)) return label;
  return n.replace(/[-_]+/g, ' ').replace(/\s+mcp(\s+client)?$/i, '').slice(0, 40);
}

/** The tool this process runs in, from the environment, if we can tell. */
export function detectClient(env: NodeJS.ProcessEnv = process.env, hostname = safeHost()): string | undefined {
  if (env.CROSSTALK_CLIENT?.trim()) return env.CROSSTALK_CLIENT.trim().slice(0, 40);
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'Claude Code';
  if (env.GEMINI_CLI) return 'Gemini CLI';
  if (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED) return 'Codex';
  if (env.CURSOR_TRACE_ID) return 'Cursor';
  // Hosted agents' machines often say whose they are ("grok-bot-vm-…").
  const host = `${hostname} ${env.USER ?? ''}`.toLowerCase();
  if (/grok/.test(host)) return 'Grok';
  if (/codex|openai/.test(host)) return 'Codex';
  if (/claude|anthropic/.test(host)) return 'Claude';
  if (/gemini|google/.test(host)) return 'Gemini';
  return undefined;
}

function safeHost(): string {
  try { return os.hostname(); } catch { return ''; }
}

export type AgentPlace = 'cloud' | 'computer' | 'phone' | 'edge';
export const PLACES: AgentPlace[] = ['cloud', 'computer', 'phone', 'edge'];

/** Where this process runs: $CROSSTALK_PLACE, else cloud when a cloud runner is evident, else this computer. */
export function detectPlace(env: NodeJS.ProcessEnv = process.env, hostname = safeHost()): AgentPlace {
  const set = env.CROSSTALK_PLACE?.trim().toLowerCase();
  if (set && (PLACES as string[]).includes(set)) return set as AgentPlace;
  if (env.CLAUDE_CODE_REMOTE || env.CCR_SESSION_PROFILE || env.CODESPACES || env.GITHUB_ACTIONS || env.GOOGLE_CLOUD_SHELL || env.RAILWAY_ENVIRONMENT || env.K_SERVICE || env.AWS_EXECUTION_ENV || env.FLY_APP_NAME || env.RENDER || env.VERCEL) return 'cloud';
  // A hosted agent's VM ("grok-bot-vm-528355866", "…-cloud-…"): cloud.
  if (/(^|-)(vm|cloud|sandbox|runner)(-|\d|$)|grok-bot/i.test(hostname)) return 'cloud';
  return 'computer';
}

// ---- Saved profiles (2.26+): what `crosstalk profile` set, sent with every new session for that name.

export interface SavedProfile { pronouns?: string; bio?: string; client?: string; place?: AgentPlace; task?: string }

export function profileFile(): string {
  return process.env.CROSSTALK_PROFILES_FILE || path.join(os.homedir(), '.crosstalk', 'profiles.json');
}

export function loadProfile(name: string, file = profileFile()): SavedProfile {
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (all && typeof all === 'object' && all[name.toLowerCase()]) || {};
  } catch {
    return {};
  }
}

export function saveProfile(name: string, profile: SavedProfile, file = profileFile()): SavedProfile {
  let all: Record<string, SavedProfile> = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first one */ }
  const merged = { ...all[name.toLowerCase()], ...profile };
  for (const k of Object.keys(merged) as (keyof SavedProfile)[]) if (merged[k] === '') delete merged[k];
  all[name.toLowerCase()] = merged;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  return merged;
}
