/**
 * A small command-line parser with the slice of commander's API (and help
 * layout) that the CLI uses: nested commands; `<required>`, `[optional]` and
 * variadic `args...`; options as `-s, --long <value>`, `--long <values...>`,
 * `--flag` and `--no-flag`, with defaults and required options; `--help`,
 * `help [command]` and `--version`. Option keys are camelCased (`--max-tokens`
 * is `opts.maxTokens`); the action gets the arguments, then the options.
 */

interface OptionSpec {
  flags: string;
  short?: string;
  long: string;
  key: string;
  takes: 'none' | 'one' | 'many';
  negate: boolean;
  description: string;
  fallback?: unknown;
  required: boolean;
}

interface ArgSpec {
  name: string;
  required: boolean;
  variadic: boolean;
}

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Fails the way commander does: `error: …` on stderr, exit code 1. */
function die(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

// Like commander, lines stop one short of the terminal width (80 when not a terminal).
const width = () => (process.stdout.columns || 80) - 1;

/** Breaks `text` into lines of at most `room` characters, at spaces. */
function wrap(text: string, room: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > room) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return [...lines, line];
}

/** Two columns, the second wrapped to the terminal width unless that would leave it narrower than 40. */
function table(rows: Array<[string, string]>, pad: number): string[] {
  const room = width() - pad - 2;
  return rows.map(([term, text]) =>
    `  ${term.padEnd(pad)}${(room < 40 ? [text] : wrap(text, room)).join(`\n  ${' '.repeat(pad)}`)}`.trimEnd());
}

export class Command {
  private title: string;
  private about = '';
  private ver?: string;
  private readonly args: ArgSpec[];
  private readonly options: OptionSpec[] = [];
  private readonly commands: Command[] = [];
  private handler?: (...args: any[]) => unknown;
  private parent?: Command;

  /** `spec`: the name and arguments, e.g. `send <address> <text...>`. */
  constructor(spec = '') {
    const [title = '', ...args] = spec.trim().split(/\s+/);
    this.title = title;
    this.args = args.map(a => ({ name: a.slice(1, -1).replace(/\.\.\.$/, ''), required: a.startsWith('<'), variadic: a.endsWith('...>') || a.endsWith('...]') }));
  }

  name(title: string): this {
    this.title = title;
    return this;
  }

  description(text: string): this {
    this.about = text;
    return this;
  }

  version(v: string): this {
    this.ver = v;
    return this;
  }

  command(spec: string): Command {
    const sub = new Command(spec);
    sub.parent = this;
    this.commands.push(sub);
    return sub;
  }

  option(flags: string, description: string, fallback?: unknown): this {
    return this.add(flags, description, fallback, false);
  }

  requiredOption(flags: string, description: string, fallback?: unknown): this {
    return this.add(flags, description, fallback, true);
  }

  action(fn: (...args: any[]) => unknown): this {
    this.handler = fn;
    return this;
  }

  private add(flags: string, description: string, fallback: unknown, required: boolean): this {
    const m = /^(?:-(\w), )?--([\w-]+)(?: <\w[^>]*?(\.\.\.)?>)?$/.exec(flags);
    if (!m) throw new Error(`Unsupported option flags: ${flags}`);
    const [, short, long, many] = m;
    const negate = long.startsWith('no-');
    this.options.push({
      flags, short, long, description, fallback, required, negate,
      key: camel(negate ? long.slice(3) : long),
      takes: flags.includes('<') ? (many ? 'many' : 'one') : 'none'
    });
    return this;
  }

  private path(): string {
    return this.parent ? `${this.parent.path()} ${this.title}` : this.title;
  }

  private usage(): string {
    const args = this.args.map(a => (a.required ? `<${a.name}${a.variadic ? '...' : ''}>` : `[${a.name}${a.variadic ? '...' : ''}]`));
    return [this.options.length ? '[options]' : '', ...(this.commands.length ? [] : args)].filter(Boolean).join(' ');
  }

  help(): string {
    const out = [`Usage: ${this.path()} ${this.commands.length ? '[options] [command]' : ['[options]', ...this.usage().split(' ').filter(s => s !== '[options]')].join(' ')}`.trimEnd(), ''];
    if (this.about) out.push(...wrap(this.about, width()), '');
    const options: Array<[string, string]> = this.options.map(o => {
      const shown = o.fallback !== undefined && o.takes !== 'none' ? ` (default: ${JSON.stringify(o.fallback)})` : '';
      return [o.flags, o.description + shown];
    });
    if (this.ver !== undefined) options.unshift(['-V, --version', 'output the version number']);
    options.push(['-h, --help', 'display help for command']);
    const commands: Array<[string, string]> = this.commands.map(c => [`${c.title} ${c.usage()}`.trimEnd(), c.about]);
    if (commands.length) commands.push(['help [command]', 'display help for command']);
    const pad = Math.max(...[...options, ...commands].map(([term]) => term.length)) + 2;
    out.push('Options:', ...table(options, pad));
    if (commands.length) out.push('', 'Commands:', ...table(commands, pad));
    return out.join('\n') + '\n';
  }

  async parseAsync(argv = process.argv.slice(2)): Promise<void> {
    const [first, ...rest] = argv;
    if (this.commands.length) {
      const sub = this.commands.find(c => c.title === first);
      if (sub) return sub.parseAsync(rest);
      if (first === 'help') {
        const target = this.commands.find(c => c.title === rest[0]) ?? this;
        process.stdout.write(target.help());
        return;
      }
      if (this.ver !== undefined && (first === '-V' || first === '--version')) {
        process.stdout.write(`${this.ver}\n`);
        return;
      }
      if (first === '-h' || first === '--help') {
        process.stdout.write(this.help());
        return;
      }
      if (!this.handler) {
        if (first === undefined) {
          process.stderr.write(this.help());
          process.exit(1);
        }
        die(first.startsWith('-') ? `unknown option '${first}'` : `unknown command '${first}'`);
      }
    }

    const values: Record<string, unknown> = {};
    for (const o of this.options) {
      if (o.fallback !== undefined) values[o.key] = o.fallback;
      // `--no-x` alone means x defaults to true; with a `--x` declared too, it stays unset.
      else if (o.negate && !this.options.some(p => !p.negate && p.key === o.key)) values[o.key] = true;
    }
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i];
      if (token === '--') {
        positional.push(...argv.slice(i + 1));
        break;
      }
      if (!token.startsWith('-') || token === '-') {
        positional.push(token);
        continue;
      }
      if (token === '-h' || token === '--help') {
        process.stdout.write(this.help());
        return;
      }
      const [flag, inline] = token.startsWith('--') ? [token.split('=')[0], token.includes('=') ? token.slice(token.indexOf('=') + 1) : undefined] : [token, undefined];
      const o = this.options.find(x => (flag.startsWith('--') ? `--${x.long}` === flag : `-${x.short}` === flag));
      if (!o) die(`unknown option '${flag}'`);
      if (o.takes === 'none') {
        values[o.key] = !o.negate;
      } else if (o.takes === 'one') {
        const value = inline ?? argv[++i];
        if (value === undefined) die(`option '${o.flags}' argument missing`);
        values[o.key] = value;
      } else {
        const list = Array.isArray(values[o.key]) && values[o.key] !== o.fallback ? (values[o.key] as string[]) : [];
        if (inline !== undefined) list.push(inline);
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) list.push(argv[++i]);
        if (!list.length) die(`option '${o.flags}' argument missing`);
        values[o.key] = list;
      }
    }
    for (const o of this.options) {
      if (o.required && values[o.key] === undefined) die(`required option '${o.flags}' not specified`);
    }
    const args = this.args.map((a, i) => {
      if (a.required && positional[i] === undefined) die(`missing required argument '${a.name}'`);
      return a.variadic ? positional.slice(i) : positional[i];
    });
    await this.handler?.(...args, values, this);
  }
}
