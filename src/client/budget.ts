import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared-agent budgets: an owner runs a model in a channel on their own API
 * key and lets guests use it up to a budget each. Every reply is metered with
 * the tokens the provider reports, priced for the model that answered, and
 * counted against the guest's budget for the day or month.
 *
 * Prices aren't built in: they change too often. The owner gives them per
 * model (USD per million tokens, input and output), from flags or a JSON file:
 *   { "claude-sonnet-5-5": { "in": 3, "out": 15 }, "gpt-5": { "in": 1.25, "out": 10 } }
 * Without a price, usage is still metered in tokens, and only token budgets apply.
 */

export interface Usage {
  /** Prompt (input) tokens. */
  input: number;
  /** Completion (output) tokens. */
  output: number;
  /** True when the provider gave no counts and these are estimated from length. */
  estimated?: boolean;
}

export interface Price {
  /** USD per million input tokens. */
  in: number;
  /** USD per million output tokens. */
  out: number;
}

export type Prices = Record<string, Price>;

export interface Budget {
  amount: number;
  unit: 'usd' | 'tokens';
  period: 'day' | 'month';
}

/** "$10/month", "$2/day", "500k tokens/day", "2M tokens/month", "off". */
export function parseBudget(spec: string): Budget | null {
  const s = spec.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === 'off' || s === 'none' || s === 'unlimited') return null;
  const m = /^(\$)?\s*([\d.,]+)\s*(k|m|b)?\s*(tokens?)?\s*(?:\/|per |a )\s*(day|month)$/.exec(s);
  if (!m) throw new Error(`can't read budget "${spec}": use e.g. "$10/month", "$2/day", "500k tokens/day"`);
  const [, dollar, num, mult, tokenWord, period] = m;
  const amount = Number(num.replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[mult as 'k' | 'm' | 'b'] ?? 1);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`can't read budget "${spec}"`);
  const unit = dollar ? 'usd' : tokenWord || mult ? 'tokens' : 'usd';
  if (dollar && tokenWord) throw new Error(`budget "${spec}" is both dollars and tokens`);
  return { amount, unit, period: period as 'day' | 'month' };
}

export const formatBudget = (b: Budget | null) =>
  !b ? 'no limit' : b.unit === 'usd' ? `$${trimNum(b.amount)}/${b.period}` : `${tokens(b.amount)} tokens/${b.period}`;

const trimNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
export const tokens = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
export const usd = (n: number) => (n === 0 ? '$0' : n >= 1 ? `$${n.toFixed(2)}` : `$${String(Number(n.toFixed(4)))}`.replace(/^\$(0\.\d)$/, '$$$10'));

/** The price for a model: an exact name, else the longest prefix that matches ("gpt-5" covers "gpt-5-2026-08"). */
export function priceFor(model: string | undefined, prices: Prices): Price | undefined {
  if (!model) return undefined;
  if (prices[model]) return prices[model];
  const key = Object.keys(prices).filter(k => model.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key ? prices[key] : undefined;
}

export const costOf = (u: Usage, p: Price | undefined) => (p ? (u.input * p.in + u.output * p.out) / 1e6 : undefined);

/** Reads a prices file (see the top of this file) and checks its shape. */
export function loadPrices(file: string): Prices {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out: Prices = {};
  for (const [model, p] of Object.entries(raw as Record<string, any>)) {
    if (!p || typeof p.in !== 'number' || typeof p.out !== 'number' || p.in < 0 || p.out < 0) throw new Error(`prices file: "${model}" needs {"in": <USD per 1M input tokens>, "out": <USD per 1M output tokens>}`);
    out[model] = { in: p.in, out: p.out };
  }
  return out;
}

/** About 4 characters a token: only for models that report no usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

interface Tally { period: string; input: number; output: number; usd: number; replies: number; byModel: Record<string, { input: number; output: number; usd: number }> }

export const periodKey = (period: 'day' | 'month', now = Date.now()) => new Date(now).toISOString().slice(0, period === 'day' ? 10 : 7);

/**
 * Per-guest usage for one shared agent, kept in a JSON file so a restart
 * doesn't reset anyone's allowance. Keys are member names (lowercased).
 */
export class Meter {
  private data: { guests: Record<string, Record<'day' | 'month', Tally>>; budgets: Record<string, string> };

  constructor(private file: string, private now: () => number = Date.now) {
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data.guests ??= {};
      this.data.budgets ??= {};
    } catch {
      this.data = { guests: {}, budgets: {} };
    }
  }

  static fileFor(channel: string, agentName: string, home = os.homedir()) {
    return path.join(home, '.crosstalk', 'shared-agents', `${channel}-${agentName}.json`.replace(/[^\w.-]/g, '_'));
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1) + '\n', { mode: 0o600 });
    } catch {
      // A read-only home keeps metering in memory for this run.
    }
  }

  /** Budgets set at runtime by the owner (they win over flags). */
  budgetOverride(guest: string): string | undefined { return this.data.budgets[guest.toLowerCase()]; }
  setBudgetOverride(guest: string, spec: string) { this.data.budgets[guest.toLowerCase()] = spec; this.save(); }

  /** This period's tally for a guest. */
  used(guest: string, period: 'day' | 'month'): Tally {
    const key = periodKey(period, this.now());
    const t = this.data.guests[guest.toLowerCase()]?.[period];
    return t && t.period === key ? t : { period: key, input: 0, output: 0, usd: 0, replies: 0, byModel: {} };
  }

  record(guest: string, model: string, u: Usage, cost: number | undefined) {
    const g = (this.data.guests[guest.toLowerCase()] ??= {} as Record<'day' | 'month', Tally>);
    for (const period of ['day', 'month'] as const) {
      const t = this.used(guest, period);
      t.input += u.input;
      t.output += u.output;
      t.usd += cost ?? 0;
      t.replies += 1;
      const m = (t.byModel[model] ??= { input: 0, output: 0, usd: 0 });
      m.input += u.input;
      m.output += u.output;
      m.usd += cost ?? 0;
      g[period] = t;
    }
    this.save();
  }

  /** Every guest metered so far (not the '*' total). */
  guests(): string[] { return Object.keys(this.data.guests).filter(g => g !== '*'); }

  /** Used this period, in a budget's unit (dollars or tokens). */
  usedIn(guest: string, budget: Budget | null, period: 'day' | 'month' = budget?.period ?? 'month'): number {
    const t = this.used(guest, budget?.period ?? period);
    return budget?.unit === 'tokens' ? t.input + t.output : t.usd;
  }

  /** What's left of a budget for a guest: in the budget's own unit; Infinity without a budget. */
  remaining(guest: string, budget: Budget | null): number {
    if (!budget) return Infinity;
    const t = this.used(guest, budget.period);
    return Math.max(0, budget.amount - (budget.unit === 'usd' ? t.usd : t.input + t.output));
  }

  /** One line for a guest: "$3.60 of $10/month used · 412k tokens". */
  summary(guest: string, budget: Budget | null): string {
    const period = budget?.period ?? 'month';
    const when = period === 'day' ? 'today' : 'this month';
    const t = this.used(guest, period);
    const total = t.input + t.output;
    if (!budget) return `${tokens(total)} tokens${t.usd ? ` (${usd(t.usd)})` : ''} ${when}, no limit`;
    if (budget.unit === 'usd') return `${usd(t.usd)} of $${trimNum(budget.amount)} used ${when} · ${tokens(total)} tokens`;
    return `${tokens(total)} of ${tokens(budget.amount)} tokens used ${when}${t.usd ? ` (${usd(t.usd)})` : ''}`;
  }
}
