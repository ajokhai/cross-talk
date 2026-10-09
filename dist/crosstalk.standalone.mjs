#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/commander/lib/error.js
var require_error = __commonJS({
  "node_modules/commander/lib/error.js"(exports) {
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.code = code;
        this.exitCode = exitCode;
        this.nestedError = void 0;
      }
    };
    var InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
      }
    };
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
  }
});

// node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "node_modules/commander/lib/argument.js"(exports) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        this.description = description || "";
        this.variadic = false;
        this.parseArg = void 0;
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.argChoices = void 0;
        switch (name[0]) {
          case "<":
            this.required = true;
            this._name = name.slice(1, -1);
            break;
          case "[":
            this.required = false;
            this._name = name.slice(1, -1);
            break;
          default:
            this.required = true;
            this._name = name;
            break;
        }
        if (this._name.length > 3 && this._name.slice(-3) === "...") {
          this.variadic = true;
          this._name = this._name.slice(0, -3);
        }
      }
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        this.required = true;
        return this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        this.required = false;
        return this;
      }
    };
    function humanReadableArgName(arg) {
      const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports.Argument = Argument2;
    exports.humanReadableArgName = humanReadableArgName;
  }
});

// node_modules/commander/lib/help.js
var require_help = __commonJS({
  "node_modules/commander/lib/help.js"(exports) {
    var { humanReadableArgName } = require_argument();
    var Help2 = class {
      constructor() {
        this.helpWidth = void 0;
        this.sortSubcommands = false;
        this.sortOptions = false;
        this.showGlobalOptions = false;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
      visibleCommands(cmd) {
        const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
        const helpCommand = cmd._getHelpCommand();
        if (helpCommand && !helpCommand._hidden) {
          visibleCommands.push(helpCommand);
        }
        if (this.sortSubcommands) {
          visibleCommands.sort((a, b) => {
            return a.name().localeCompare(b.name());
          });
        }
        return visibleCommands;
      }
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a, b) {
        const getSortKey = (option) => {
          return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        };
        return getSortKey(a).localeCompare(getSortKey(b));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        const visibleOptions = cmd.options.filter((option) => !option.hidden);
        const helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          const removeShort = helpOption.short && cmd._findOption(helpOption.short);
          const removeLong = helpOption.long && cmd._findOption(helpOption.long);
          if (!removeShort && !removeLong) {
            visibleOptions.push(helpOption);
          } else if (helpOption.long && !removeLong) {
            visibleOptions.push(
              cmd.createOption(helpOption.long, helpOption.description)
            );
          } else if (helpOption.short && !removeShort) {
            visibleOptions.push(
              cmd.createOption(helpOption.short, helpOption.description)
            );
          }
        }
        if (this.sortOptions) {
          visibleOptions.sort(this.compareOptions);
        }
        return visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        const globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          const visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        if (this.sortOptions) {
          globalOptions.sort(this.compareOptions);
        }
        return globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
      visibleArguments(cmd) {
        if (cmd._argsDescription) {
          cmd.registeredArguments.forEach((argument) => {
            argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
          });
        }
        if (cmd.registeredArguments.find((argument) => argument.description)) {
          return cmd.registeredArguments;
        }
        return [];
      }
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => {
          return Math.max(max, helper.subcommandTerm(command).length);
        }, 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => {
          return Math.max(max, helper.argumentTerm(argument).length);
        }, 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        if (cmd._aliases[0]) {
          cmdName = cmdName + "|" + cmd._aliases[0];
        }
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        }
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        const extraInfo = [];
        if (option.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (option.defaultValue !== void 0) {
          const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
          if (showDefault) {
            extraInfo.push(
              `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
            );
          }
        }
        if (option.presetArg !== void 0 && option.optional) {
          extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
        }
        if (option.envVar !== void 0) {
          extraInfo.push(`env: ${option.envVar}`);
        }
        if (extraInfo.length > 0) {
          return `${option.description} (${extraInfo.join(", ")})`;
        }
        return option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        const extraInfo = [];
        if (argument.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (argument.defaultValue !== void 0) {
          extraInfo.push(
            `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
          );
        }
        if (extraInfo.length > 0) {
          const extraDescripton = `(${extraInfo.join(", ")})`;
          if (argument.description) {
            return `${argument.description} ${extraDescripton}`;
          }
          return extraDescripton;
        }
        return argument.description;
      }
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth || 80;
        const itemIndentWidth = 2;
        const itemSeparatorWidth = 2;
        function formatItem(term, description) {
          if (description) {
            const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
            return helper.wrap(
              fullText,
              helpWidth - itemIndentWidth,
              termWidth + itemSeparatorWidth
            );
          }
          return term;
        }
        function formatList(textArray) {
          return textArray.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));
        }
        let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
        const commandDescription = helper.commandDescription(cmd);
        if (commandDescription.length > 0) {
          output = output.concat([
            helper.wrap(commandDescription, helpWidth, 0),
            ""
          ]);
        }
        const argumentList = helper.visibleArguments(cmd).map((argument) => {
          return formatItem(
            helper.argumentTerm(argument),
            helper.argumentDescription(argument)
          );
        });
        if (argumentList.length > 0) {
          output = output.concat(["Arguments:", formatList(argumentList), ""]);
        }
        const optionList = helper.visibleOptions(cmd).map((option) => {
          return formatItem(
            helper.optionTerm(option),
            helper.optionDescription(option)
          );
        });
        if (optionList.length > 0) {
          output = output.concat(["Options:", formatList(optionList), ""]);
        }
        if (this.showGlobalOptions) {
          const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
            return formatItem(
              helper.optionTerm(option),
              helper.optionDescription(option)
            );
          });
          if (globalOptionList.length > 0) {
            output = output.concat([
              "Global Options:",
              formatList(globalOptionList),
              ""
            ]);
          }
        }
        const commandList = helper.visibleCommands(cmd).map((cmd2) => {
          return formatItem(
            helper.subcommandTerm(cmd2),
            helper.subcommandDescription(cmd2)
          );
        });
        if (commandList.length > 0) {
          output = output.concat(["Commands:", formatList(commandList), ""]);
        }
        return output.join("\n");
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Wrap the given string to width characters per line, with lines after the first indented.
       * Do not wrap if insufficient room for wrapping (minColumnWidth), or string is manually formatted.
       *
       * @param {string} str
       * @param {number} width
       * @param {number} indent
       * @param {number} [minColumnWidth=40]
       * @return {string}
       *
       */
      wrap(str, width, indent, minColumnWidth = 40) {
        const indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF";
        const manualIndent = new RegExp(`[\\n][${indents}]+`);
        if (str.match(manualIndent)) return str;
        const columnWidth = width - indent;
        if (columnWidth < minColumnWidth) return str;
        const leadingStr = str.slice(0, indent);
        const columnText = str.slice(indent).replace("\r\n", "\n");
        const indentString = " ".repeat(indent);
        const zeroWidthSpace = "\u200B";
        const breaks = `\\s${zeroWidthSpace}`;
        const regex = new RegExp(
          `
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`,
          "g"
        );
        const lines = columnText.match(regex) || [];
        return leadingStr + lines.map((line, i) => {
          if (line === "\n") return "";
          return (i > 0 ? indentString : "") + line.trimEnd();
        }).join("\n");
      }
    };
    exports.Help = Help2;
  }
});

// node_modules/commander/lib/option.js
var require_option = __commonJS({
  "node_modules/commander/lib/option.js"(exports) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
      constructor(flags, description) {
        this.flags = flags;
        this.description = description || "";
        this.required = flags.includes("<");
        this.optional = flags.includes("[");
        this.variadic = /\w\.\.\.[>\]]$/.test(flags);
        this.mandatory = false;
        const optionFlags = splitOptionFlags(flags);
        this.short = optionFlags.shortFlag;
        this.long = optionFlags.longFlag;
        this.negate = false;
        if (this.long) {
          this.negate = this.long.startsWith("--no-");
        }
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.presetArg = void 0;
        this.envVar = void 0;
        this.parseArg = void 0;
        this.hidden = false;
        this.argChoices = void 0;
        this.conflictsWith = [];
        this.implied = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        this.presetArg = arg;
        return this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        this.conflictsWith = this.conflictsWith.concat(names);
        return this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        if (typeof impliedOptionValues === "string") {
          newImplied = { [impliedOptionValues]: true };
        }
        this.implied = Object.assign(this.implied || {}, newImplied);
        return this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        this.envVar = name;
        return this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = true) {
        this.mandatory = !!mandatory;
        return this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = true) {
        this.hidden = !!hide;
        return this;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        if (this.long) {
          return this.long.replace(/^--/, "");
        }
        return this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as a object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        return camelcase(this.name().replace(/^no-/, ""));
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    };
    var DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map();
        this.negativeOptions = /* @__PURE__ */ new Map();
        this.dualOptions = /* @__PURE__ */ new Set();
        options.forEach((option) => {
          if (option.negate) {
            this.negativeOptions.set(option.attributeName(), option);
          } else {
            this.positiveOptions.set(option.attributeName(), option);
          }
        });
        this.negativeOptions.forEach((value, key) => {
          if (this.positiveOptions.has(key)) {
            this.dualOptions.add(key);
          }
        });
      }
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        const optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return true;
        const preset = this.negativeOptions.get(optionKey).presetArg;
        const negativeValue = preset !== void 0 ? preset : false;
        return option.negate === (negativeValue === value);
      }
    };
    function camelcase(str) {
      return str.split("-").reduce((str2, word) => {
        return str2 + word[0].toUpperCase() + word.slice(1);
      });
    }
    function splitOptionFlags(flags) {
      let shortFlag;
      let longFlag;
      const flagParts = flags.split(/[ |,]+/);
      if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
        shortFlag = flagParts.shift();
      longFlag = flagParts.shift();
      if (!shortFlag && /^-[^-]$/.test(longFlag)) {
        shortFlag = longFlag;
        longFlag = void 0;
      }
      return { shortFlag, longFlag };
    }
    exports.Option = Option2;
    exports.DualOptions = DualOptions;
  }
});

// node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "node_modules/commander/lib/suggestSimilar.js"(exports) {
    var maxDistance = 3;
    function editDistance(a, b) {
      if (Math.abs(a.length - b.length) > maxDistance)
        return Math.max(a.length, b.length);
      const d = [];
      for (let i = 0; i <= a.length; i++) {
        d[i] = [i];
      }
      for (let j = 0; j <= b.length; j++) {
        d[0][j] = j;
      }
      for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
          let cost = 1;
          if (a[i - 1] === b[j - 1]) {
            cost = 0;
          } else {
            cost = 1;
          }
          d[i][j] = Math.min(
            d[i - 1][j] + 1,
            // deletion
            d[i][j - 1] + 1,
            // insertion
            d[i - 1][j - 1] + cost
            // substitution
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
            d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
          }
        }
      }
      return d[a.length][b.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
      candidates = Array.from(new Set(candidates));
      const searchingOptions = word.startsWith("--");
      if (searchingOptions) {
        word = word.slice(2);
        candidates = candidates.map((candidate) => candidate.slice(2));
      }
      let similar = [];
      let bestDistance = maxDistance;
      const minSimilarity = 0.4;
      candidates.forEach((candidate) => {
        if (candidate.length <= 1) return;
        const distance = editDistance(word, candidate);
        const length = Math.max(word.length, candidate.length);
        const similarity = (length - distance) / length;
        if (similarity > minSimilarity) {
          if (distance < bestDistance) {
            bestDistance = distance;
            similar = [candidate];
          } else if (distance === bestDistance) {
            similar.push(candidate);
          }
        }
      });
      similar.sort((a, b) => a.localeCompare(b));
      if (searchingOptions) {
        similar = similar.map((candidate) => `--${candidate}`);
      }
      if (similar.length > 1) {
        return `
(Did you mean one of ${similar.join(", ")}?)`;
      }
      if (similar.length === 1) {
        return `
(Did you mean ${similar[0]}?)`;
      }
      return "";
    }
    exports.suggestSimilar = suggestSimilar;
  }
});

// node_modules/commander/lib/command.js
var require_command = __commonJS({
  "node_modules/commander/lib/command.js"(exports) {
    var EventEmitter2 = __require("node:events").EventEmitter;
    var childProcess = __require("node:child_process");
    var path3 = __require("node:path");
    var fs2 = __require("node:fs");
    var process2 = __require("node:process");
    var { Argument: Argument2, humanReadableArgName } = require_argument();
    var { CommanderError: CommanderError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2, DualOptions } = require_option();
    var { suggestSimilar } = require_suggestSimilar();
    var Command2 = class _Command extends EventEmitter2 {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
      constructor(name) {
        super();
        this.commands = [];
        this.options = [];
        this.parent = null;
        this._allowUnknownOption = false;
        this._allowExcessArguments = true;
        this.registeredArguments = [];
        this._args = this.registeredArguments;
        this.args = [];
        this.rawArgs = [];
        this.processedArgs = [];
        this._scriptPath = null;
        this._name = name || "";
        this._optionValues = {};
        this._optionValueSources = {};
        this._storeOptionsAsProperties = false;
        this._actionHandler = null;
        this._executableHandler = false;
        this._executableFile = null;
        this._executableDir = null;
        this._defaultCommandName = null;
        this._exitCallback = null;
        this._aliases = [];
        this._combineFlagAndOptionalValue = true;
        this._description = "";
        this._summary = "";
        this._argsDescription = void 0;
        this._enablePositionalOptions = false;
        this._passThroughOptions = false;
        this._lifeCycleHooks = {};
        this._showHelpAfterError = false;
        this._showSuggestionAfterError = true;
        this._outputConfiguration = {
          writeOut: (str) => process2.stdout.write(str),
          writeErr: (str) => process2.stderr.write(str),
          getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : void 0,
          getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : void 0,
          outputError: (str, write) => write(str)
        };
        this._hidden = false;
        this._helpOption = void 0;
        this._addImplicitHelpCommand = void 0;
        this._helpCommand = void 0;
        this._helpConfiguration = {};
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
      copyInheritedSettings(sourceCommand) {
        this._outputConfiguration = sourceCommand._outputConfiguration;
        this._helpOption = sourceCommand._helpOption;
        this._helpCommand = sourceCommand._helpCommand;
        this._helpConfiguration = sourceCommand._helpConfiguration;
        this._exitCallback = sourceCommand._exitCallback;
        this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
        this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
        this._allowExcessArguments = sourceCommand._allowExcessArguments;
        this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
        this._showHelpAfterError = sourceCommand._showHelpAfterError;
        this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
        return this;
      }
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        const result = [];
        for (let command = this; command; command = command.parent) {
          result.push(command);
        }
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
      command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
        let desc = actionOptsOrExecDesc;
        let opts = execOpts;
        if (typeof desc === "object" && desc !== null) {
          opts = desc;
          desc = null;
        }
        opts = opts || {};
        const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
        const cmd = this.createCommand(name);
        if (desc) {
          cmd.description(desc);
          cmd._executableHandler = true;
        }
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        cmd._hidden = !!(opts.noHelp || opts.hidden);
        cmd._executableFile = opts.executableFile || null;
        if (args) cmd.arguments(args);
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd.copyInheritedSettings(this);
        if (desc) return this;
        return cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        if (configuration === void 0) return this._helpConfiguration;
        this._helpConfiguration = configuration;
        return this;
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // functions to change where being written, stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // matching functions to specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // functions based on what is being written out
       *     outputError(str, write) // used for displaying errors, and not used for displaying help
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        if (configuration === void 0) return this._outputConfiguration;
        Object.assign(this._outputConfiguration, configuration);
        return this;
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = true) {
        if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
        this._showHelpAfterError = displayHelp;
        return this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = true) {
        this._showSuggestionAfterError = !!displaySuggestion;
        return this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name) {
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        }
        opts = opts || {};
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        if (opts.noHelp || opts.hidden) cmd._hidden = true;
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd._checkForBrokenPassThrough();
        return this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [fn] - custom argument processing function
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      argument(name, description, fn, defaultValue) {
        const argument = this.createArgument(name, description);
        if (typeof fn === "function") {
          argument.default(defaultValue).argParser(fn);
        } else {
          argument.default(fn);
        }
        this.addArgument(argument);
        return this;
      }
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        });
        return this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        const previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument && previousArgument.variadic) {
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        }
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        }
        this.registeredArguments.push(argument);
        return this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
      helpCommand(enableOrNameAndArgs, description) {
        if (typeof enableOrNameAndArgs === "boolean") {
          this._addImplicitHelpCommand = enableOrNameAndArgs;
          return this;
        }
        enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
        const [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/);
        const helpDescription = description ?? "display help for command";
        const helpCommand = this.createCommand(helpName);
        helpCommand.helpOption(false);
        if (helpArgs) helpCommand.arguments(helpArgs);
        if (helpDescription) helpCommand.description(helpDescription);
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        if (typeof helpCommand !== "object") {
          this.helpCommand(helpCommand, deprecatedDescription);
          return this;
        }
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
        if (hasImplicitHelpCommand) {
          if (this._helpCommand === void 0) {
            this.helpCommand(void 0, void 0);
          }
          return this._helpCommand;
        }
        return null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
      hook(event, listener) {
        const allowedValues = ["preSubcommand", "preAction", "postAction"];
        if (!allowedValues.includes(event)) {
          throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        if (this._lifeCycleHooks[event]) {
          this._lifeCycleHooks[event].push(listener);
        } else {
          this._lifeCycleHooks[event] = [listener];
        }
        return this;
      }
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        if (fn) {
          this._exitCallback = fn;
        } else {
          this._exitCallback = (err) => {
            if (err.code !== "commander.executeSubCommandAsync") {
              throw err;
            } else {
            }
          };
        }
        return this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        if (this._exitCallback) {
          this._exitCallback(new CommanderError2(exitCode, code, message));
        }
        process2.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
      action(fn) {
        const listener = (args) => {
          const expectedArgsCount = this.registeredArguments.length;
          const actionArgs = args.slice(0, expectedArgsCount);
          if (this._storeOptionsAsProperties) {
            actionArgs[expectedArgsCount] = this;
          } else {
            actionArgs[expectedArgsCount] = this.opts();
          }
          actionArgs.push(this);
          return fn.apply(this, actionArgs);
        };
        this._actionHandler = listener;
        return this;
      }
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
      _callParseArg(target, value, previous, invalidArgumentMessage) {
        try {
          return target.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `${invalidArgumentMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        const knownBy = (cmd) => {
          return [cmd.name()].concat(cmd.aliases());
        };
        const alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
          const newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        const oname = option.name();
        const name = option.attributeName();
        if (option.negate) {
          const positiveLongFlag = option.long.replace(/^--no-/, "--");
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(
              name,
              option.defaultValue === void 0 ? true : option.defaultValue,
              "default"
            );
          }
        } else if (option.defaultValue !== void 0) {
          this.setOptionValueWithSource(name, option.defaultValue, "default");
        }
        const handleOptionValue = (val, invalidValueMessage, valueSource) => {
          if (val == null && option.presetArg !== void 0) {
            val = option.presetArg;
          }
          const oldValue = this.getOptionValue(name);
          if (val !== null && option.parseArg) {
            val = this._callParseArg(option, val, oldValue, invalidValueMessage);
          } else if (val !== null && option.variadic) {
            val = option._concatValue(val, oldValue);
          }
          if (val == null) {
            if (option.negate) {
              val = false;
            } else if (option.isBoolean() || option.optional) {
              val = true;
            } else {
              val = "";
            }
          }
          this.setOptionValueWithSource(name, val, valueSource);
        };
        this.on("option:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "cli");
        });
        if (option.envVar) {
          this.on("optionEnv:" + oname, (val) => {
            const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
            handleOptionValue(val, invalidValueMessage, "env");
          });
        }
        return this;
      }
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags === "object" && flags instanceof Option2) {
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        }
        const option = this.createOption(flags, description);
        option.makeOptionMandatory(!!config.mandatory);
        if (typeof fn === "function") {
          option.default(defaultValue).argParser(fn);
        } else if (fn instanceof RegExp) {
          const regex = fn;
          fn = (val, def) => {
            const m = regex.exec(val);
            return m ? m[0] : def;
          };
          option.default(defaultValue).argParser(fn);
        } else {
          option.default(fn);
        }
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('-p, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: true },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = true) {
        this._combineFlagAndOptionalValue = !!combine;
        return this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = true) {
        this._allowUnknownOption = !!allowUnknown;
        return this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = true) {
        this._allowExcessArguments = !!allowExcess;
        return this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = true) {
        this._enablePositionalOptions = !!positional;
        return this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = true) {
        this._passThroughOptions = !!passThrough;
        this._checkForBrokenPassThrough();
        return this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
        }
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = true) {
        if (this.options.length) {
          throw new Error("call .storeOptionsAsProperties() before adding options");
        }
        if (Object.keys(this._optionValues).length) {
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        }
        this._storeOptionsAsProperties = !!storeAsProperties;
        return this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        if (this._storeOptionsAsProperties) {
          return this[key];
        }
        return this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        if (this._storeOptionsAsProperties) {
          this[key] = value;
        } else {
          this._optionValues[key] = value;
        }
        this._optionValueSources[key] = source;
        return this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        this._getCommandAndAncestors().forEach((cmd) => {
          if (cmd.getOptionValueSource(key) !== void 0) {
            source = cmd.getOptionValueSource(key);
          }
        });
        return source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv2, parseOptions) {
        if (argv2 !== void 0 && !Array.isArray(argv2)) {
          throw new Error("first parameter to parse must be array or undefined");
        }
        parseOptions = parseOptions || {};
        if (argv2 === void 0 && parseOptions.from === void 0) {
          if (process2.versions?.electron) {
            parseOptions.from = "electron";
          }
          const execArgv = process2.execArgv ?? [];
          if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
            parseOptions.from = "eval";
          }
        }
        if (argv2 === void 0) {
          argv2 = process2.argv;
        }
        this.rawArgs = argv2.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv2[1];
            userArgs = argv2.slice(2);
            break;
          case "electron":
            if (process2.defaultApp) {
              this._scriptPath = argv2[1];
              userArgs = argv2.slice(2);
            } else {
              userArgs = argv2.slice(1);
            }
            break;
          case "user":
            userArgs = argv2.slice(0);
            break;
          case "eval":
            userArgs = argv2.slice(1);
            break;
          default:
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        if (!this._name && this._scriptPath)
          this.nameFromFilename(this._scriptPath);
        this._name = this._name || "program";
        return userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv2, parseOptions) {
        const userArgs = this._prepareUserArgs(argv2, parseOptions);
        this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv2, parseOptions) {
        const userArgs = this._prepareUserArgs(argv2, parseOptions);
        await this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = false;
        const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          const localBin = path3.resolve(baseDir, baseName);
          if (fs2.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path3.extname(baseName))) return void 0;
          const foundExt = sourceExt.find(
            (ext) => fs2.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
          return void 0;
        }
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
        let executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs2.realpathSync(this._scriptPath);
          } catch (err) {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path3.resolve(
            path3.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            const legacyName = path3.basename(
              this._scriptPath,
              path3.extname(this._scriptPath)
            );
            if (legacyName !== this._name) {
              localFile = findFile(
                executableDir,
                `${legacyName}-${subcommand._name}`
              );
            }
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path3.extname(executableFile));
        let proc;
        if (process2.platform !== "win32") {
          if (launchWithNode) {
            args.unshift(executableFile);
            args = incrementNodeInspectorPort(process2.execArgv).concat(args);
            proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
          } else {
            proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
          }
        } else {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
        }
        if (!proc.killed) {
          const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
          signals.forEach((signal) => {
            process2.on(signal, () => {
              if (proc.killed === false && proc.exitCode === null) {
                proc.kill(signal);
              }
            });
          });
        }
        const exitCallback = this._exitCallback;
        proc.on("close", (code) => {
          code = code ?? 1;
          if (!exitCallback) {
            process2.exit(code);
          } else {
            exitCallback(
              new CommanderError2(
                code,
                "commander.executeSubCommandAsync",
                "(close)"
              )
            );
          }
        });
        proc.on("error", (err) => {
          if (err.code === "ENOENT") {
            const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
            const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
            throw new Error(executableMissing);
          } else if (err.code === "EACCES") {
            throw new Error(`'${executableFile}' not executable`);
          }
          if (!exitCallback) {
            process2.exit(1);
          } else {
            const wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err;
            exitCallback(wrappedError);
          }
        });
        this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        const subCommand = this._findCommand(commandName);
        if (!subCommand) this.help({ error: true });
        let promiseChain;
        promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        );
        promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler) {
            this._executeSubCommand(subCommand, operands.concat(unknown));
          } else {
            return subCommand._parseCommand(operands, unknown);
          }
        });
        return promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        if (!subcommandName) {
          this.help();
        }
        const subCommand = this._findCommand(subcommandName);
        if (subCommand && !subCommand._executableHandler) {
          subCommand.help();
        }
        return this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
      _checkNumberOfArguments() {
        this.registeredArguments.forEach((arg, i) => {
          if (arg.required && this.args[i] == null) {
            this.missingArgument(arg.name());
          }
        });
        if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
          return;
        }
        if (this.args.length > this.registeredArguments.length) {
          this._excessArguments(this.args);
        }
      }
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        const myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
          }
          return parsedValue;
        };
        this._checkNumberOfArguments();
        const processedArgs = [];
        this.registeredArguments.forEach((declaredArg, index) => {
          let value = declaredArg.defaultValue;
          if (declaredArg.variadic) {
            if (index < this.args.length) {
              value = this.args.slice(index);
              if (declaredArg.parseArg) {
                value = value.reduce((processed, v) => {
                  return myParseArg(declaredArg, v, processed);
                }, declaredArg.defaultValue);
              }
            } else if (value === void 0) {
              value = [];
            }
          } else if (index < this.args.length) {
            value = this.args[index];
            if (declaredArg.parseArg) {
              value = myParseArg(declaredArg, value, declaredArg.defaultValue);
            }
          }
          processedArgs[index] = value;
        });
        this.processedArgs = processedArgs;
      }
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        if (promise && promise.then && typeof promise.then === "function") {
          return promise.then(() => fn());
        }
        return fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise;
        const hooks = [];
        this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks.push({ hookedCommand, callback });
          });
        });
        if (event === "postAction") {
          hooks.reverse();
        }
        hooks.forEach((hookDetail) => {
          result = this._chainOrCall(result, () => {
            return hookDetail.callback(hookDetail.hookedCommand, this);
          });
        });
        return result;
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        if (this._lifeCycleHooks[event] !== void 0) {
          this._lifeCycleHooks[event].forEach((hook) => {
            result = this._chainOrCall(result, () => {
              return hook(this, subCommand);
            });
          });
        }
        return result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
      _parseCommand(operands, unknown) {
        const parsed = this.parseOptions(unknown);
        this._parseOptionsEnv();
        this._parseOptionsImplied();
        operands = operands.concat(parsed.operands);
        unknown = parsed.unknown;
        this.args = operands.concat(unknown);
        if (operands && this._findCommand(operands[0])) {
          return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
        }
        if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
          return this._dispatchHelpCommand(operands[1]);
        }
        if (this._defaultCommandName) {
          this._outputHelpIfRequested(unknown);
          return this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
        }
        if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
          this.help({ error: true });
        }
        this._outputHelpIfRequested(parsed.unknown);
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        const checkForUnknownOptions = () => {
          if (parsed.unknown.length > 0) {
            this.unknownOption(parsed.unknown[0]);
          }
        };
        const commandEvent = `command:${this.name()}`;
        if (this._actionHandler) {
          checkForUnknownOptions();
          this._processArguments();
          let promiseChain;
          promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
          promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          );
          if (this.parent) {
            promiseChain = this._chainOrCall(promiseChain, () => {
              this.parent.emit(commandEvent, operands, unknown);
            });
          }
          promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
          return promiseChain;
        }
        if (this.parent && this.parent.listenerCount(commandEvent)) {
          checkForUnknownOptions();
          this._processArguments();
          this.parent.emit(commandEvent, operands, unknown);
        } else if (operands.length) {
          if (this._findCommand("*")) {
            return this._dispatchSubcommand("*", operands, unknown);
          }
          if (this.listenerCount("command:*")) {
            this.emit("command:*", operands, unknown);
          } else if (this.commands.length) {
            this.unknownCommand();
          } else {
            checkForUnknownOptions();
            this._processArguments();
          }
        } else if (this.commands.length) {
          checkForUnknownOptions();
          this.help({ error: true });
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      }
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (!name) return void 0;
        return this.commands.find(
          (cmd) => cmd._name === name || cmd._aliases.includes(name)
        );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
              cmd.missingMandatoryOptionValue(anOption);
            }
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        const definedNonDefaultOptions = this.options.filter((option) => {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === void 0) {
            return false;
          }
          return this.getOptionValueSource(optionKey) !== "default";
        });
        const optionsWithConflicting = definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        );
        optionsWithConflicting.forEach((option) => {
          const conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          if (conflictingAndDefined) {
            this._conflictingOption(option, conflictingAndDefined);
          }
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} argv
       * @return {{operands: string[], unknown: string[]}}
       */
      parseOptions(argv2) {
        const operands = [];
        const unknown = [];
        let dest = operands;
        const args = argv2.slice();
        function maybeOption(arg) {
          return arg.length > 1 && arg[0] === "-";
        }
        let activeVariadicOption = null;
        while (args.length) {
          const arg = args.shift();
          if (arg === "--") {
            if (dest === unknown) dest.push(arg);
            dest.push(...args);
            break;
          }
          if (activeVariadicOption && !maybeOption(arg)) {
            this.emit(`option:${activeVariadicOption.name()}`, arg);
            continue;
          }
          activeVariadicOption = null;
          if (maybeOption(arg)) {
            const option = this._findOption(arg);
            if (option) {
              if (option.required) {
                const value = args.shift();
                if (value === void 0) this.optionMissingArgument(option);
                this.emit(`option:${option.name()}`, value);
              } else if (option.optional) {
                let value = null;
                if (args.length > 0 && !maybeOption(args[0])) {
                  value = args.shift();
                }
                this.emit(`option:${option.name()}`, value);
              } else {
                this.emit(`option:${option.name()}`);
              }
              activeVariadicOption = option.variadic ? option : null;
              continue;
            }
          }
          if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
            const option = this._findOption(`-${arg[1]}`);
            if (option) {
              if (option.required || option.optional && this._combineFlagAndOptionalValue) {
                this.emit(`option:${option.name()}`, arg.slice(2));
              } else {
                this.emit(`option:${option.name()}`);
                args.unshift(`-${arg.slice(2)}`);
              }
              continue;
            }
          }
          if (/^--[^=]+=/.test(arg)) {
            const index = arg.indexOf("=");
            const option = this._findOption(arg.slice(0, index));
            if (option && (option.required || option.optional)) {
              this.emit(`option:${option.name()}`, arg.slice(index + 1));
              continue;
            }
          }
          if (maybeOption(arg)) {
            dest = unknown;
          }
          if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
            if (this._findCommand(arg)) {
              operands.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg);
              if (args.length > 0) operands.push(...args);
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg);
            if (args.length > 0) dest.push(...args);
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          const result = {};
          const len = this.options.length;
          for (let i = 0; i < len; i++) {
            const key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        );
        if (typeof this._showHelpAfterError === "string") {
          this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
        } else if (this._showHelpAfterError) {
          this._outputConfiguration.writeErr("\n");
          this.outputHelp({ error: true });
        }
        const config = errorOptions || {};
        const exitCode = config.exitCode || 1;
        const code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process2.env) {
            const optionKey = option.attributeName();
            if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) {
              if (option.required || option.optional) {
                this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
              } else {
                this.emit(`optionEnv:${option.name()}`);
              }
            }
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        const dualHelper = new DualOptions(this.options);
        const hasCustomOptionValue = (optionKey) => {
          return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        };
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        const message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        const message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        const message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        const findBestOptionFromValue = (option2) => {
          const optionKey = option2.attributeName();
          const optionValue = this.getOptionValue(optionKey);
          const negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          );
          const positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
            return negativeOption;
          }
          return positiveOption || option2;
        };
        const getErrorMessage = (option2) => {
          const bestOption = findBestOptionFromValue(option2);
          const optionKey = bestOption.attributeName();
          const source = this.getOptionValueSource(optionKey);
          if (source === "env") {
            return `environment variable '${bestOption.envVar}'`;
          }
          return `option '${bestOption.flags}'`;
        };
        const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
        this.error(message, { code: "commander.conflictingOption" });
      }
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
        let suggestion = "";
        if (flag.startsWith("--") && this._showSuggestionAfterError) {
          let candidateFlags = [];
          let command = this;
          do {
            const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
            candidateFlags = candidateFlags.concat(moreFlags);
            command = command.parent;
          } while (command && !command._enablePositionalOptions);
          suggestion = suggestSimilar(flag, candidateFlags);
        }
        const message = `error: unknown option '${flag}'${suggestion}`;
        this.error(message, { code: "commander.unknownOption" });
      }
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        const expected = this.registeredArguments.length;
        const s = expected === 1 ? "" : "s";
        const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
        const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        const unknownName = this.args[0];
        let suggestion = "";
        if (this._showSuggestionAfterError) {
          const candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name());
            if (command.alias()) candidateNames.push(command.alias());
          });
          suggestion = suggestSimilar(unknownName, candidateNames);
        }
        const message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str, flags, description) {
        if (str === void 0) return this._version;
        this._version = str;
        flags = flags || "-V, --version";
        description = description || "output the version number";
        const versionOption = this.createOption(flags, description);
        this._versionOptionName = versionOption.attributeName();
        this._registerOption(versionOption);
        this.on("option:" + versionOption.name(), () => {
          this._outputConfiguration.writeOut(`${str}
`);
          this._exit(0, "commander.version", str);
        });
        return this;
      }
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str, argsDescription) {
        if (str === void 0 && argsDescription === void 0)
          return this._description;
        this._description = str;
        if (argsDescription) {
          this._argsDescription = argsDescription;
        }
        return this;
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str) {
        if (str === void 0) return this._summary;
        this._summary = str;
        return this;
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
          command = this.commands[this.commands.length - 1];
        }
        if (alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        const matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        command._aliases.push(alias);
        return this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        if (aliases === void 0) return this._aliases;
        aliases.forEach((alias) => this.alias(alias));
        return this;
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str) {
        if (str === void 0) {
          if (this._usage) return this._usage;
          const args = this.registeredArguments.map((arg) => {
            return humanReadableArgName(arg);
          });
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        this._usage = str;
        return this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str) {
        if (str === void 0) return this._name;
        this._name = str;
        return this;
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        this._name = path3.basename(filename, path3.extname(filename));
        return this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path4) {
        if (path4 === void 0) return this._executableDir;
        this._executableDir = path4;
        return this;
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        const helper = this.createHelp();
        if (helper.helpWidth === void 0) {
          helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
        }
        return helper.formatHelp(this, helper);
      }
      /**
       * @private
       */
      _getHelpContext(contextOptions) {
        contextOptions = contextOptions || {};
        const context = { error: !!contextOptions.error };
        let write;
        if (context.error) {
          write = (arg) => this._outputConfiguration.writeErr(arg);
        } else {
          write = (arg) => this._outputConfiguration.writeOut(arg);
        }
        context.write = contextOptions.write || write;
        context.command = this;
        return context;
      }
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        if (typeof contextOptions === "function") {
          deprecatedCallback = contextOptions;
          contextOptions = void 0;
        }
        const context = this._getHelpContext(contextOptions);
        this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context));
        this.emit("beforeHelp", context);
        let helpInformation = this.helpInformation(context);
        if (deprecatedCallback) {
          helpInformation = deprecatedCallback(helpInformation);
          if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
            throw new Error("outputHelp callback must return a string or a Buffer");
          }
        }
        context.write(helpInformation);
        if (this._getHelpOption()?.long) {
          this.emit(this._getHelpOption().long);
        }
        this.emit("afterHelp", context);
        this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", context)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        if (typeof flags === "boolean") {
          if (flags) {
            this._helpOption = this._helpOption ?? void 0;
          } else {
            this._helpOption = null;
          }
          return this;
        }
        flags = flags ?? "-h, --help";
        description = description ?? "display help for command";
        this._helpOption = this.createOption(flags, description);
        return this;
      }
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        if (this._helpOption === void 0) {
          this.helpOption(void 0, void 0);
        }
        return this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        this._helpOption = option;
        return this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = process2.exitCode || 0;
        if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
          exitCode = 1;
        }
        this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
      addHelpText(position, text) {
        const allowedValues = ["beforeAll", "before", "after", "afterAll"];
        if (!allowedValues.includes(position)) {
          throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        const helpEvent = `${position}Help`;
        this.on(helpEvent, (context) => {
          let helpStr;
          if (typeof text === "function") {
            helpStr = text({ error: context.error, command: context.command });
          } else {
            helpStr = text;
          }
          if (helpStr) {
            context.write(`${helpStr}
`);
          }
        });
        return this;
      }
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        const helpOption = this._getHelpOption();
        const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
        if (helpRequested) {
          this.outputHelp();
          this._exit(0, "commander.helpDisplayed", "(outputHelp)");
        }
      }
    };
    function incrementNodeInspectorPort(args) {
      return args.map((arg) => {
        if (!arg.startsWith("--inspect")) {
          return arg;
        }
        let debugOption;
        let debugHost = "127.0.0.1";
        let debugPort = "9229";
        let match;
        if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
          debugOption = match[1];
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
          debugOption = match[1];
          if (/^\d+$/.test(match[3])) {
            debugPort = match[3];
          } else {
            debugHost = match[3];
          }
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
          debugOption = match[1];
          debugHost = match[3];
          debugPort = match[4];
        }
        if (debugOption && debugPort !== "0") {
          return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
        }
        return arg;
      });
    }
    exports.Command = Command2;
  }
});

// node_modules/commander/index.js
var require_commander = __commonJS({
  "node_modules/commander/index.js"(exports) {
    var { Argument: Argument2 } = require_argument();
    var { Command: Command2 } = require_command();
    var { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2 } = require_option();
    exports.program = new Command2();
    exports.createCommand = (name) => new Command2(name);
    exports.createOption = (flags, description) => new Option2(flags, description);
    exports.createArgument = (name, description) => new Argument2(name, description);
    exports.Command = Command2;
    exports.Option = Option2;
    exports.Argument = Argument2;
    exports.Help = Help2;
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
    exports.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = __require("bufferutil");
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && (typeof params.client_max_window_bits === "number" ? opts.clientMaxWindowBits > params.client_max_window_bits : !params.client_max_window_bits)) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = __require("utf-8-validate");
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var {
      types: { isUint8Array }
    } = __require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter2 = __require("events");
    var https = __require("https");
    var http2 = __require("http");
    var net = __require("net");
    var tls = __require("tls");
    var { randomBytes, createHash } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL: URL2 } = __require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter2 {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            if (!options || options.protocols === void 0) {
              protocols = [];
            } else if (Array.isArray(options.protocols)) {
              protocols = options.protocols;
            } else {
              protocols = [options.protocols];
            }
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              if (options.protocols === void 0) {
                protocols = [];
              } else if (Array.isArray(options.protocols)) {
                protocols = options.protocols;
              } else {
                protocols = [options.protocols];
              }
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        this._readyState = _WebSocket.CLOSING;
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        protocols: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http2.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter2 = __require("events");
    var http2 = __require("http");
    var { Duplex } = __require("stream");
    var { createHash } = __require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter2 {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http2.createServer((req, res) => {
            const body = http2.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http2.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http2.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// node_modules/ws/wrapper.mjs
var import_stream, import_extension, import_permessage_deflate, import_receiver, import_sender, import_subprotocol, import_websocket, import_websocket_server;
var init_wrapper = __esm({
  "node_modules/ws/wrapper.mjs"() {
    import_stream = __toESM(require_stream(), 1);
    import_extension = __toESM(require_extension(), 1);
    import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
    import_receiver = __toESM(require_receiver(), 1);
    import_sender = __toESM(require_sender(), 1);
    import_subprotocol = __toESM(require_subprotocol(), 1);
    import_websocket = __toESM(require_websocket(), 1);
    import_websocket_server = __toESM(require_websocket_server(), 1);
  }
});

// src/server/gibberlink.ts
var GibberlinkEngine;
var init_gibberlink = __esm({
  "src/server/gibberlink.ts"() {
    "use strict";
    GibberlinkEngine = class {
      // Preset frequency plans
      static MODES = {
        audible_fast: {
          baseHz: 1875,
          stepHz: 93.75,
          symbolDurationMs: 15,
          numTones: 16
          // 16-FSK (4 bits per symbol)
        },
        audible_standard: {
          baseHz: 1500,
          stepHz: 75,
          symbolDurationMs: 25,
          numTones: 16
        },
        ultrasonic: {
          baseHz: 17e3,
          stepHz: 125,
          symbolDurationMs: 20,
          numTones: 16
        }
      };
      /**
       * Encodes text or structured intent into a pure Gibberlink Signal Stream packet.
       * This transmits the exact frequency-shift keying (FSK) audio signals directly
       * over data streams without requiring acoustic audio conversion.
       */
      static encode(input, modeName = "audible_fast", metadata) {
        const mode = this.MODES[modeName] || this.MODES.audible_fast;
        const text = typeof input === "string" ? input : JSON.stringify(input);
        const textBytes = Buffer.from(text, "utf8");
        const crc = this.computeCrc16(textBytes);
        const payloadTones = [];
        for (let i = 0; i < textBytes.length; i++) {
          const b = textBytes[i];
          payloadTones.push(b >> 4 & 15);
          payloadTones.push(b & 15);
        }
        payloadTones.push(crc >> 12 & 15);
        payloadTones.push(crc >> 8 & 15);
        payloadTones.push(crc >> 4 & 15);
        payloadTones.push(crc & 15);
        const preambleTones = [15, 0, 15, 0];
        const postambleTones = [0, 15];
        const allTones = [...preambleTones, ...payloadTones, ...postambleTones];
        const frequencies = allTones.map((toneIdx) => {
          return Math.round((mode.baseHz + toneIdx * mode.stepHz) * 100) / 100;
        });
        const totalDurationMs = allTones.length * mode.symbolDurationMs;
        return {
          protocol: "gibberlink/signal-stream-v1",
          version: "1.0",
          mode: modeName,
          baseFrequencyHz: mode.baseHz,
          stepFrequencyHz: mode.stepHz,
          symbolDurationMs: mode.symbolDurationMs,
          totalDurationMs,
          preambleTones,
          payloadTones,
          postambleTones,
          frequencies,
          crc,
          rawBytes: Array.from(textBytes),
          text,
          metadata,
          timestamp: Date.now()
        };
      }
      /**
       * Decodes a Gibberlink Signal Stream packet directly back to its original intent/text.
       */
      static decode(packet) {
        try {
          const tones = packet.payloadTones;
          if (!tones || tones.length < 4) {
            return { valid: false, text: "", durationMs: 0, toneCount: 0 };
          }
          const dataNibbles = tones.slice(0, tones.length - 4);
          const crcNibbles = tones.slice(tones.length - 4);
          const expectedCrc = crcNibbles[0] << 12 | crcNibbles[1] << 8 | crcNibbles[2] << 4 | crcNibbles[3];
          const bytes = [];
          for (let i = 0; i < dataNibbles.length; i += 2) {
            const high = dataNibbles[i] || 0;
            const low = dataNibbles[i + 1] || 0;
            bytes.push(high << 4 | low);
          }
          const buf = Buffer.from(bytes);
          const computedCrc = this.computeCrc16(buf);
          const valid = computedCrc === expectedCrc;
          const text = buf.toString("utf8");
          let data = void 0;
          try {
            data = JSON.parse(text);
          } catch {
          }
          return {
            valid,
            text,
            data,
            toneCount: packet.frequencies.length,
            durationMs: packet.totalDurationMs
          };
        } catch (err) {
          return { valid: false, text: "", durationMs: 0, toneCount: 0 };
        }
      }
      /**
       * Generates a raw PCM audio buffer (Float32Array) from the signal packet.
       * Allows synthesizing the exact Gibberlink acoustic modem sound on demand.
       */
      static synthesizePcm(packet, sampleRate = 44100) {
        const symbolSamples = Math.floor(sampleRate * packet.symbolDurationMs / 1e3);
        const totalSamples = symbolSamples * packet.frequencies.length;
        const buffer = new Float32Array(totalSamples);
        let sampleOffset = 0;
        for (const freq of packet.frequencies) {
          const angularFreq = 2 * Math.PI * freq;
          for (let s = 0; s < symbolSamples; s++) {
            const t = s / sampleRate;
            const window = 0.5 * (1 - Math.cos(2 * Math.PI * s / (symbolSamples - 1 || 1)));
            const sampleValue = Math.sin(angularFreq * t) * window * 0.7;
            buffer[sampleOffset + s] = sampleValue;
          }
          sampleOffset += symbolSamples;
        }
        return buffer;
      }
      /**
       * CRC-16-CCITT implementation for signal packet integrity
       */
      static computeCrc16(buffer) {
        let crc = 65535;
        for (let i = 0; i < buffer.length; i++) {
          crc ^= buffer[i] << 8;
          for (let j = 0; j < 8; j++) {
            if ((crc & 32768) !== 0) {
              crc = (crc << 1 ^ 4129) & 65535;
            } else {
              crc = crc << 1 & 65535;
            }
          }
        }
        return crc & 65535;
      }
    };
  }
});

// src/dialect/dictionary.ts
var DIALECT_V1;
var init_dictionary = __esm({
  "src/dialect/dictionary.ts"() {
    "use strict";
    DIALECT_V1 = {
      version: "1.0.0",
      name: "XDialect-AgentMesh",
      checksum: "sha256-xd1-0001",
      updatedAt: "2026-10-09",
      tokens: {
        // Actions (Prefix: !)
        "!LCK": {
          code: "!LCK",
          numericId: 16,
          category: "action",
          meaning: "Claim exclusive lock on file",
          humanTemplate: 'Claiming exclusive file lock on {target} for {intent}: "{reason}".',
          zhMeaning: "\u7533\u8BF7\u6587\u4EF6\u72EC\u5360\u9501",
          zhTemplate: "\u7533\u8BF7\u72EC\u5360\u9501\u5B9A\u6587\u4EF6 {target} \u8FDB\u884C{intent}\uFF1A\u201C{reason}\u201D\u3002"
        },
        "!REL": {
          code: "!REL",
          numericId: 17,
          category: "action",
          meaning: "Release lock on file",
          humanTemplate: "Releasing file lock on {target}. File is now open for other agents.",
          zhMeaning: "\u91CA\u653E\u6587\u4EF6\u9501",
          zhTemplate: "\u5DF2\u91CA\u653E\u6587\u4EF6 {target} \u7684\u9501\uFF0C\u5176\u4ED6\u667A\u80FD\u4F53\u53EF\u5B89\u5168\u7F16\u8F91\u3002"
        },
        "!BCST": {
          code: "!BCST",
          numericId: 18,
          category: "action",
          meaning: "Broadcast announcement to mesh",
          humanTemplate: "Announcing to all agents: {reason}.",
          zhMeaning: "\u5168\u7F51\u5E7F\u64AD\u516C\u544A",
          zhTemplate: "\u5411\u7F51\u7EDC\u4E2D\u6240\u6709\u667A\u80FD\u4F53\u5E7F\u64AD\uFF1A\u201C{reason}\u201D\u3002"
        },
        "!DM": {
          code: "!DM",
          numericId: 19,
          category: "action",
          meaning: "Direct message to specific agent",
          humanTemplate: "Direct message to {recipient}: {reason}.",
          zhMeaning: "\u5B9A\u5411\u79C1\u4FE1\u53D1\u9001",
          zhTemplate: "\u53D1\u9001\u79C1\u4FE1\u7ED9\u667A\u80FD\u4F53 {recipient}\uFF1A\u201C{reason}\u201D\u3002"
        },
        "!WARN": {
          code: "!WARN",
          numericId: 20,
          category: "action",
          meaning: "File collision or conflict alert",
          humanTemplate: "Conflict Alert: {target} is currently locked! Please hold.",
          zhMeaning: "\u6587\u4EF6\u51B2\u7A81\u8B66\u544A",
          zhTemplate: "\u51B2\u7A81\u8B66\u544A\uFF1A\u6587\u4EF6 {target} \u5F53\u524D\u5DF2\u88AB\u9501\u5B9A\uFF01\u8BF7\u7A0D\u7B49\u3002"
        },
        "!PASS": {
          code: "!PASS",
          numericId: 21,
          category: "action",
          meaning: "Handoff task / file lock to another agent",
          humanTemplate: 'Handing off {target} to {recipient} with context: "{reason}".',
          zhMeaning: "\u79FB\u4EA4\u4EFB\u52A1\u4E0E\u6587\u4EF6\u9501",
          zhTemplate: "\u5C06\u6587\u4EF6 {target} \u79FB\u4EA4\u7ED9\u667A\u80FD\u4F53 {recipient}\uFF0C\u8BF4\u660E\uFF1A\u201C{reason}\u201D\u3002"
        },
        // Intents / Verbs (Prefix: #)
        "#REF": {
          code: "#REF",
          numericId: 48,
          category: "intent",
          meaning: "Refactoring existing code without changing external behavior",
          humanTemplate: "refactoring",
          zhMeaning: "\u4EE3\u7801\u91CD\u6784",
          zhTemplate: "\u91CD\u6784\u4EE3\u7801"
        },
        "#FEAT": {
          code: "#FEAT",
          numericId: 49,
          category: "intent",
          meaning: "Implementing new feature or capability",
          humanTemplate: "implementing new feature",
          zhMeaning: "\u65B0\u529F\u80FD\u5F00\u53D1",
          zhTemplate: "\u5B9E\u73B0\u65B0\u529F\u80FD"
        },
        "#FIX": {
          code: "#FIX",
          numericId: 50,
          category: "intent",
          meaning: "Fixing bug or error condition",
          humanTemplate: "fixing bug",
          zhMeaning: "\u4FEE\u590D\u7F3A\u9677",
          zhTemplate: "\u4FEE\u590D\u9519\u8BEF\u7F3A\u9677"
        },
        "#TEST": {
          code: "#TEST",
          numericId: 51,
          category: "intent",
          meaning: "Running or authoring test suites",
          humanTemplate: "testing",
          zhMeaning: "\u6D4B\u8BD5\u7528\u4F8B\u6267\u884C",
          zhTemplate: "\u7F16\u5199\u6216\u8FD0\u884C\u6D4B\u8BD5"
        },
        "#BLD": {
          code: "#BLD",
          numericId: 52,
          category: "intent",
          meaning: "Compiling or building codebase",
          humanTemplate: "building",
          zhMeaning: "\u4EE3\u7801\u7F16\u8BD1\u4E0E\u6784\u5EFA",
          zhTemplate: "\u7F16\u8BD1\u6784\u5EFA\u9879\u76EE"
        },
        "#MIG": {
          code: "#MIG",
          numericId: 53,
          category: "intent",
          meaning: "Database or schema migration",
          humanTemplate: "migrating schema",
          zhMeaning: "\u6570\u636E\u7ED3\u6784\u8FC1\u79FB",
          zhTemplate: "\u6570\u636E\u5E93\u6216\u534F\u8BAE\u8FC1\u79FB"
        },
        "#REV": {
          code: "#REV",
          numericId: 54,
          category: "intent",
          meaning: "Code review or auditing",
          humanTemplate: "reviewing",
          zhMeaning: "\u4EE3\u7801\u5BA1\u67E5",
          zhTemplate: "\u5BA1\u67E5\u4EE3\u7801"
        },
        "#DOC": {
          code: "#DOC",
          numericId: 55,
          category: "intent",
          meaning: "Updating documentation or comments",
          humanTemplate: "documenting",
          zhMeaning: "\u6587\u6863\u66F4\u65B0",
          zhTemplate: "\u7F16\u5199\u6587\u6863\u4E0E\u6CE8\u91CA"
        },
        // Flow & Coordination Control (Prefix: &)
        "&WAIT": {
          code: "&WAIT",
          numericId: 80,
          category: "flow",
          meaning: "Hang on / do not touch until finished",
          humanTemplate: "Hang on for me to finish before touching it.",
          zhMeaning: "\u7B49\u6211\u5B8C\u6210\u518D\u4FEE\u6539",
          zhTemplate: "\u8BF7\u7A0D\u5019\uFF0C\u7B49\u6211\u4FEE\u6539\u5B8C\u6210\u518D\u64CD\u4F5C\u3002"
        },
        "&ACK": {
          code: "&ACK",
          numericId: 81,
          category: "flow",
          meaning: "Acknowledged / will wait",
          humanTemplate: "Understood, holding off.",
          zhMeaning: "\u5DF2\u6536\u5230\uFF0C\u6682\u4E0D\u4FEE\u6539",
          zhTemplate: "\u5DF2\u786E\u8BA4\uFF0C\u6682\u505C\u4FEE\u6539\u5E76\u4FDD\u6301\u7B49\u5F85\u3002"
        },
        "&DONE": {
          code: "&DONE",
          numericId: 82,
          category: "flow",
          meaning: "Task finished / ready for next step",
          humanTemplate: "Finished work.",
          zhMeaning: "\u5DE5\u4F5C\u5B8C\u6210",
          zhTemplate: "\u64CD\u4F5C\u5DF2\u5B8C\u6210\u3002"
        },
        "&PROCEED": {
          code: "&PROCEED",
          numericId: 83,
          category: "flow",
          meaning: "Clear to proceed",
          humanTemplate: "You are clear to proceed now.",
          zhMeaning: "\u53EF\u4EE5\u7EE7\u7EED\u64CD\u4F5C",
          zhTemplate: "\u5176\u4ED6\u667A\u80FD\u4F53\u73B0\u5728\u53EF\u4EE5\u7EE7\u7EED\u63A8\u8FDB\u3002"
        },
        // Queries (Prefix: ?)
        "?WHO": {
          code: "?WHO",
          numericId: 112,
          category: "action",
          meaning: "Query active agents on mesh",
          humanTemplate: "Who is active on the channel?"
        },
        "?LOCKS": {
          code: "?LOCKS",
          numericId: 113,
          category: "action",
          meaning: "Query currently held file locks",
          humanTemplate: "What files are currently locked?"
        }
      },
      grammar: {
        format: '<ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL_SEC>] [^<RECIPIENT>] [&<FLOW>]',
        examples: [
          {
            shorthand: '!LCK @src/auth.ts #REF "jwt validation" ~180 &WAIT',
            human: "I am editing src/auth.ts, refactoring jwt validation (180s lock). Hang on for me to finish before touching it.",
            meaning: "Locks src/auth.ts for 3 minutes for jwt refactoring and instructs peers to wait."
          },
          {
            shorthand: "!REL @src/auth.ts &DONE &PROCEED",
            human: "Finished work on src/auth.ts. Lock released. You are clear to proceed now.",
            meaning: "Releases lock on src/auth.ts and signals peers that it is safe to edit."
          },
          {
            shorthand: '!DM ^Agent-2 &ACK "waiting for your commit"',
            human: "Direct message to Agent-2: Understood, holding off; waiting for your commit.",
            meaning: "Direct acknowledgement to peer agent."
          },
          {
            shorthand: "!WARN @src/db.ts #MIG &WAIT",
            human: "Conflict Alert: src/db.ts is locked for database migration! Hang on for me to finish before touching it.",
            meaning: "Warns that src/db.ts cannot be touched."
          }
        ]
      }
    };
  }
});

// src/dialect/engine.ts
var DialectEngine;
var init_engine = __esm({
  "src/dialect/engine.ts"() {
    "use strict";
    init_dictionary();
    DialectEngine = class {
      static dictionary = DIALECT_V1;
      static getDictionary() {
        return this.dictionary;
      }
      /**
       * Parses a concise shorthand string into a structured dialect message.
       * Format: <ACTION> [@<FILE>] [#<INTENT>] ["<REASON>"] [~<TTL>] [^<RECIPIENT>] [&<FLOW>...]
       */
      static parse(shorthand) {
        const trimmed = shorthand.trim();
        const result = {
          rawShorthand: trimmed,
          flow: []
        };
        let working = trimmed;
        const quoteMatch = working.match(/"([^"]+)"|'([^']+)'/);
        if (quoteMatch) {
          result.reason = quoteMatch[1] || quoteMatch[2];
          working = working.replace(quoteMatch[0], " ");
        }
        const tokens = working.split(/\s+/).filter(Boolean);
        for (const tok of tokens) {
          if (tok.startsWith("!")) {
            result.action = tok.toUpperCase();
          } else if (tok.startsWith("@")) {
            result.target = tok.slice(1);
          } else if (tok.startsWith("#")) {
            result.intent = tok.toUpperCase();
          } else if (tok.startsWith("~")) {
            result.ttl = parseInt(tok.slice(1), 10) || 300;
          } else if (tok.startsWith("^")) {
            result.recipient = tok.slice(1);
          } else if (tok.startsWith("&")) {
            result.flow?.push(tok.toUpperCase());
          } else if (!result.reason && !tok.startsWith("?") && !tok.startsWith("!")) {
            result.reason = tok;
          } else if (tok.startsWith("?")) {
            result.action = tok.toUpperCase();
          }
        }
        return result;
      }
      /**
       * Reversibly translates shorthand into natural, fluid human-readable English.
       */
      static toHuman(input) {
        const parsed = typeof input === "string" ? this.parse(input) : input;
        const parts = [];
        const targetStr = parsed.target ? `"${parsed.target}"` : "the file";
        const reasonStr = parsed.reason ? `("${parsed.reason}")` : "";
        const intentDesc = parsed.intent && this.dictionary.tokens[parsed.intent] ? this.dictionary.tokens[parsed.intent].humanTemplate : parsed.intent ? parsed.intent.slice(1).toLowerCase() : "";
        switch (parsed.action) {
          case "!LCK": {
            const intentPart = intentDesc ? `, ${intentDesc} ${reasonStr}` : reasonStr ? ` to ${reasonStr}` : "";
            parts.push(`I am editing ${targetStr}${intentPart}.`);
            if (parsed.ttl) {
              parts.push(`(Holding lock for ${parsed.ttl}s).`);
            }
            break;
          }
          case "!REL": {
            parts.push(`Finished editing ${targetStr}. Lock released and ready for others.`);
            break;
          }
          case "!BCST": {
            parts.push(`Announcement: ${parsed.reason || "General broadcast"}.`);
            break;
          }
          case "!DM": {
            const to = parsed.recipient ? `to ${parsed.recipient}` : "";
            parts.push(`Direct message ${to}: ${parsed.reason || ""}.`);
            break;
          }
          case "!WARN": {
            parts.push(`Warning: Collision on ${targetStr}! Currently locked.`);
            break;
          }
          case "!PASS": {
            parts.push(`Handoff: Passing ${targetStr} to ${parsed.recipient || "next agent"} (${parsed.reason || ""}).`);
            break;
          }
          case "?WHO": {
            parts.push("Checking which agents are currently active on the channel.");
            break;
          }
          case "?LOCKS": {
            parts.push("Querying currently held file locks.");
            break;
          }
          default: {
            if (parsed.reason) parts.push(parsed.reason);
          }
        }
        if (parsed.flow && parsed.flow.length > 0) {
          for (const f of parsed.flow) {
            const token = this.dictionary.tokens[f];
            if (token) {
              parts.push(token.humanTemplate);
            }
          }
        }
        return parts.join(" ");
      }
      /**
       * Expands concise XDialect shorthand into natural Chinese (中文支持).
       */
      static toChinese(shorthand) {
        const parsed = this.parse(shorthand);
        if (!parsed) return shorthand;
        const parts = [];
        const targetStr = parsed.target ? `"${parsed.target}"` : "";
        const reasonStr = parsed.reason ? `\uFF08${parsed.reason}\uFF09` : "";
        let intentDesc = "";
        if (parsed.intent) {
          const token = this.dictionary.tokens[parsed.intent];
          intentDesc = token?.zhMeaning || token?.meaning || parsed.intent;
        }
        switch (parsed.action) {
          case "!LCK": {
            const intentPart = intentDesc ? `\uFF0C\u8FDB\u884C${intentDesc}${reasonStr}` : reasonStr ? `\u8FDB\u884C${reasonStr}` : "";
            parts.push(`\u6B63\u5728\u7F16\u8F91 ${targetStr}${intentPart}\u3002`);
            if (parsed.ttl) {
              parts.push(`\uFF08\u4FDD\u6301\u9501\u5B9A ${parsed.ttl} \u79D2\uFF09\u3002`);
            }
            break;
          }
          case "!REL": {
            parts.push(`\u5DF2\u5B8C\u6210\u5BF9 ${targetStr} \u7684\u4FEE\u6539\u3002\u6587\u4EF6\u9501\u5DF2\u91CA\u653E\uFF0C\u5176\u4ED6\u667A\u80FD\u4F53\u53EF\u5B89\u5168\u7F16\u8F91\u3002`);
            break;
          }
          case "!BCST": {
            parts.push(`\u5E7F\u64AD\u516C\u544A\uFF1A${parsed.reason || "\u901A\u7528\u6D88\u606F"}\u3002`);
            break;
          }
          case "!DM": {
            const to = parsed.recipient ? `\u53D1\u7ED9 ${parsed.recipient}` : "";
            parts.push(`\u5B9A\u5411\u79C1\u4FE1${to}\uFF1A${parsed.reason || ""}\u3002`);
            break;
          }
          case "!WARN": {
            parts.push(`\u51B2\u7A81\u8B66\u62A5\uFF1A\u6587\u4EF6 ${targetStr} \u5DF2\u88AB\u5176\u4ED6\u667A\u80FD\u4F53\u9501\u5B9A\uFF01\u8BF7\u52FF\u4FEE\u6539\u3002`);
            break;
          }
          case "!PASS": {
            parts.push(`\u4EFB\u52A1\u79FB\u4EA4\uFF1A\u5C06\u6587\u4EF6 ${targetStr} \u79FB\u4EA4\u7ED9 ${parsed.recipient || "\u4E0B\u4E00\u667A\u80FD\u4F53"}\uFF08${parsed.reason || ""}\uFF09\u3002`);
            break;
          }
          case "?WHO": {
            parts.push("\u6B63\u5728\u67E5\u8BE2\u7F51\u7EDC\u4E2D\u5F53\u524D\u6D3B\u8DC3\u7684\u667A\u80FD\u4F53\u3002");
            break;
          }
          case "?LOCKS": {
            parts.push("\u6B63\u5728\u67E5\u8BE2\u5F53\u524D\u6240\u6709\u88AB\u9501\u5B9A\u7684\u6587\u4EF6\u72B6\u6001\u3002");
            break;
          }
          default: {
            if (parsed.reason) parts.push(parsed.reason);
          }
        }
        if (parsed.flow && parsed.flow.length > 0) {
          for (const f of parsed.flow) {
            const token = this.dictionary.tokens[f];
            if (token && token.zhTemplate) {
              parts.push(token.zhTemplate);
            } else if (token) {
              parts.push(token.humanTemplate);
            }
          }
        }
        return parts.join(" ");
      }
      /**
       * Compiles natural human English or Chinese statements into concise XDialect shorthand.
       */
      static fromHuman(text) {
        const lower = text.toLowerCase();
        const tokens = [];
        const fileMatch = text.match(/(?:file|path|editing|touching|modify|修改|编辑|锁定|文件)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i) || text.match(/([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
        const file = fileMatch ? fileMatch[1] : null;
        if (lower.includes("lock") || lower.includes("editing") || lower.includes("i'm editing") || lower.includes("modifying") || text.includes("\u9501\u5B9A") || text.includes("\u6B63\u5728\u4FEE\u6539") || text.includes("\u6B63\u5728\u7F16\u8F91")) {
          tokens.push("!LCK");
        } else if (lower.includes("release") || lower.includes("unlock") || lower.includes("finished editing") || text.includes("\u91CA\u653E") || text.includes("\u89E3\u9501") || text.includes("\u4FEE\u6539\u5B8C\u6210") || text.includes("\u6539\u5B8C\u4E86")) {
          tokens.push("!REL");
        } else if (lower.includes("who is") || lower.includes("who is active") || text.includes("\u8C01\u5728") || text.includes("\u6D3B\u8DC3")) {
          tokens.push("?WHO");
        } else if (lower.includes("what files") || lower.includes("check locks") || text.includes("\u9501") || text.includes("\u5360\u7528")) {
          tokens.push("?LOCKS");
        } else {
          tokens.push("!BCST");
        }
        if (file) {
          tokens.push(`@${file}`);
        }
        if (lower.includes("refactor") || text.includes("\u91CD\u6784")) tokens.push("#REF");
        else if (lower.includes("fix") || lower.includes("bug") || text.includes("\u4FEE\u590D") || text.includes("bug") || text.includes("\u7F3A\u9677")) tokens.push("#FIX");
        else if (lower.includes("feature") || lower.includes("add") || text.includes("\u529F\u80FD") || text.includes("\u5F00\u53D1") || text.includes("\u65B0\u589E")) tokens.push("#FEAT");
        else if (lower.includes("test") || text.includes("\u6D4B\u8BD5")) tokens.push("#TEST");
        else if (lower.includes("migrate") || lower.includes("migration") || text.includes("\u8FC1\u79FB")) tokens.push("#MIG");
        if (lower.includes("hang on") || lower.includes("wait") || lower.includes("don't touch") || lower.includes("hold off") || text.includes("\u7B49\u6211") || text.includes("\u7A0D\u7B49") || text.includes("\u522B\u78B0") || text.includes("\u8BF7\u7A0D\u5019") || text.includes("\u5148\u522B\u6539")) {
          tokens.push("&WAIT");
        }
        if (lower.includes("done") || lower.includes("finished") || text.includes("\u5B8C\u6210") || text.includes("\u597D\u4E86")) {
          tokens.push("&DONE");
        }
        if (lower.includes("proceed") || lower.includes("clear") || text.includes("\u53EF\u4EE5\u7EE7\u7EED") || text.includes("\u53EF\u4EE5\u5F00\u59CB")) {
          tokens.push("&PROCEED");
        }
        return tokens.join(" ");
      }
      /**
       * Packs shorthand expression into ultra-compact binary bitstream bytes (15-30 bytes).
       * 
       * Bit Layout:
       * [0] Action numeric ID (0x10..0x15)
       * [1] Intent numeric ID (0x30..0x37)
       * [2] Flow flags bitfield (bit0=&WAIT, bit1=&ACK, bit2=&DONE, bit3=&PROCEED)
       * [3..4] TTL in seconds (uint16)
       * [5] Target string length (uint8)
       * [6..N] Target UTF-8 bytes
       * [N+1] Reason string length (uint8)
       * [N+2..M] Reason UTF-8 bytes
       */
      static packToBits(input) {
        const parsed = typeof input === "string" ? this.parse(input) : input;
        const actionTok = parsed.action ? this.dictionary.tokens[parsed.action] : null;
        const actionId = actionTok ? actionTok.numericId : 0;
        const intentTok = parsed.intent ? this.dictionary.tokens[parsed.intent] : null;
        const intentId = intentTok ? intentTok.numericId : 0;
        let flowBits = 0;
        if (parsed.flow?.includes("&WAIT")) flowBits |= 1 << 0;
        if (parsed.flow?.includes("&ACK")) flowBits |= 1 << 1;
        if (parsed.flow?.includes("&DONE")) flowBits |= 1 << 2;
        if (parsed.flow?.includes("&PROCEED")) flowBits |= 1 << 3;
        const ttl = parsed.ttl || 300;
        const targetBuf = Buffer.from(parsed.target || "", "utf8");
        const reasonBuf = Buffer.from(parsed.reason || "", "utf8");
        const totalLen = 5 + 1 + targetBuf.length + 1 + reasonBuf.length;
        const buf = Buffer.alloc(totalLen);
        buf.writeUInt8(actionId, 0);
        buf.writeUInt8(intentId, 1);
        buf.writeUInt8(flowBits, 2);
        buf.writeUInt16BE(ttl, 3);
        buf.writeUInt8(targetBuf.length, 5);
        targetBuf.copy(buf, 6);
        const reasonOffset = 6 + targetBuf.length;
        buf.writeUInt8(reasonBuf.length, reasonOffset);
        reasonBuf.copy(buf, reasonOffset + 1);
        return buf;
      }
      /**
       * Unpacks a compact binary bitstream buffer back into structured AST, shorthand, and English.
       */
      static unpackFromBits(buf) {
        if (buf.length < 7) {
          return {
            parsed: { rawShorthand: "" },
            shorthand: "",
            human: ""
          };
        }
        const actionId = buf.readUInt8(0);
        const intentId = buf.readUInt8(1);
        const flowBits = buf.readUInt8(2);
        const ttl = buf.readUInt16BE(3);
        const targetLen = buf.readUInt8(5);
        const target = buf.subarray(6, 6 + targetLen).toString("utf8");
        const reasonOffset = 6 + targetLen;
        const reasonLen = reasonOffset < buf.length ? buf.readUInt8(reasonOffset) : 0;
        const reason = reasonOffset + 1 + reasonLen <= buf.length ? buf.subarray(reasonOffset + 1, reasonOffset + 1 + reasonLen).toString("utf8") : "";
        let actionCode;
        let intentCode;
        for (const [code, tok] of Object.entries(this.dictionary.tokens)) {
          if (tok.numericId === actionId) actionCode = code;
          if (tok.numericId === intentId) intentCode = code;
        }
        const flow = [];
        if (flowBits & 1 << 0) flow.push("&WAIT");
        if (flowBits & 1 << 1) flow.push("&ACK");
        if (flowBits & 1 << 2) flow.push("&DONE");
        if (flowBits & 1 << 3) flow.push("&PROCEED");
        const parts = [];
        if (actionCode) parts.push(actionCode);
        if (target) parts.push(`@${target}`);
        if (intentCode) parts.push(intentCode);
        if (reason) parts.push(`"${reason}"`);
        if (ttl && ttl !== 300) parts.push(`~${ttl}`);
        flow.forEach((f) => parts.push(f));
        const shorthand = parts.join(" ");
        const parsed = {
          action: actionCode,
          target: target || void 0,
          intent: intentCode,
          reason: reason || void 0,
          ttl,
          flow,
          rawShorthand: shorthand
        };
        const human = this.toHuman(parsed);
        return { parsed, shorthand, human };
      }
    };
  }
});

// src/server/locks.ts
import path from "node:path";
var LockManager;
var init_locks = __esm({
  "src/server/locks.ts"() {
    "use strict";
    LockManager = class {
      locks = /* @__PURE__ */ new Map();
      // normalizedFilePath -> FileLock
      cleanupInterval = null;
      constructor() {
        this.cleanupInterval = setInterval(() => {
          this.cleanExpiredLocks();
        }, 5e3);
      }
      normalizePath(filePath) {
        if (!filePath) return "";
        let normalized = path.normalize(filePath).replace(/\\/g, "/");
        if (normalized.startsWith("./")) {
          normalized = normalized.slice(2);
        }
        return normalized;
      }
      acquire(rawPath, agent, reason, ttlSeconds = 300, channel = "default") {
        const file = this.normalizePath(rawPath);
        const now = Date.now();
        const existing = this.locks.get(file);
        if (existing && existing.expiresAt > now) {
          if (existing.holderId === agent.id) {
            existing.expiresAt = now + ttlSeconds * 1e3;
            existing.reason = reason;
            return { success: true, lock: existing };
          }
          const remainingSeconds = Math.max(0, Math.round((existing.expiresAt - now) / 1e3));
          return {
            success: false,
            existingHolder: {
              id: existing.holderId,
              name: existing.holderName,
              reason: existing.reason,
              expiresAt: existing.expiresAt,
              remainingSeconds
            }
          };
        }
        const lock = {
          file,
          holderId: agent.id,
          holderName: agent.name,
          reason,
          acquiredAt: now,
          expiresAt: now + ttlSeconds * 1e3,
          channel
        };
        this.locks.set(file, lock);
        return { success: true, lock };
      }
      release(rawPath, agentId, force = false) {
        const file = this.normalizePath(rawPath);
        const existing = this.locks.get(file);
        if (!existing) {
          return { success: false };
        }
        if (!force && existing.holderId !== agentId) {
          return { success: false, lock: existing };
        }
        this.locks.delete(file);
        return { success: true, lock: existing };
      }
      releaseAllByAgent(agentId) {
        const released = [];
        for (const [file, lock] of this.locks.entries()) {
          if (lock.holderId === agentId) {
            released.push(lock);
            this.locks.delete(file);
          }
        }
        return released;
      }
      isLocked(rawPath) {
        const file = this.normalizePath(rawPath);
        const existing = this.locks.get(file);
        if (!existing) return { locked: false };
        if (existing.expiresAt <= Date.now()) {
          this.locks.delete(file);
          return { locked: false };
        }
        return { locked: true, lock: existing };
      }
      getLocks(channel) {
        const now = Date.now();
        const active = [];
        for (const [file, lock] of this.locks.entries()) {
          if (lock.expiresAt > now) {
            if (!channel || lock.channel === channel) {
              active.push(lock);
            }
          } else {
            this.locks.delete(file);
          }
        }
        return active;
      }
      getLocksByAgent(agentId) {
        return this.getLocks().filter((l) => l.holderId === agentId);
      }
      cleanExpiredLocks() {
        const now = Date.now();
        for (const [file, lock] of this.locks.entries()) {
          if (lock.expiresAt <= now) {
            this.locks.delete(file);
          }
        }
      }
      destroy() {
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = null;
        }
      }
    };
  }
});

// src/server/storage.ts
async function createMeshStorage() {
  const uri = process.env.MONGODB_URI;
  if (uri && uri.trim() !== "") {
    const mongo = new MongoStorage(uri.trim());
    const ok = await mongo.connect();
    if (ok) return mongo;
  }
  return new InMemoryStorage(100);
}
var InMemoryStorage, MongoStorage;
var init_storage = __esm({
  "src/server/storage.ts"() {
    "use strict";
    InMemoryStorage = class {
      history = /* @__PURE__ */ new Map();
      totalMessages = 0;
      maxCapacity;
      constructor(maxCapacity = 100) {
        this.maxCapacity = maxCapacity;
      }
      async recordMessage(channel, msg) {
        this.totalMessages++;
        if (!this.history.has(channel)) {
          this.history.set(channel, []);
        }
        const list = this.history.get(channel);
        list.push(msg);
        if (list.length > this.maxCapacity) {
          list.shift();
        }
      }
      async getTotalMessageCount() {
        return this.totalMessages;
      }
      async getRecentMessages(channel, limit = 100) {
        const list = this.history.get(channel) || [];
        return list.slice(-limit);
      }
      async close() {
      }
    };
    MongoStorage = class {
      inMemoryFallback = new InMemoryStorage(100);
      client = null;
      db = null;
      isConnected = false;
      uri;
      dbName;
      constructor(uri, dbName = "crosstalk") {
        this.uri = uri;
        this.dbName = dbName;
      }
      async connect() {
        try {
          const { MongoClient } = await import("mongodb");
          this.client = new MongoClient(this.uri, {
            connectTimeoutMS: 5e3,
            serverSelectionTimeoutMS: 5e3
          });
          await this.client.connect();
          this.db = this.client.db(this.dbName);
          const collections = await this.db.listCollections({ name: "crosstalk_messages" }).toArray();
          if (collections.length === 0) {
            try {
              await this.db.createCollection("crosstalk_messages", {
                capped: true,
                size: 1048576,
                max: 100
              });
            } catch (_) {
            }
          }
          this.isConnected = true;
          console.log(`[MeshStorage] Connected to MongoDB (${this.dbName}). Ring buffer capped at 100 documents.`);
          return true;
        } catch (err) {
          console.warn(`[MeshStorage] MongoDB connection skipped or failed (${err.message}). Using ultra-light in-memory ring buffer.`);
          this.isConnected = false;
          return false;
        }
      }
      async recordMessage(channel, msg) {
        await this.inMemoryFallback.recordMessage(channel, msg);
        if (this.isConnected && this.db) {
          try {
            await this.db.collection("crosstalk_stats").updateOne(
              { _id: "global_metrics" },
              { $inc: { totalMessages: 1 }, $set: { lastActive: Date.now() } },
              { upsert: true }
            );
            await this.db.collection("crosstalk_messages").insertOne({
              id: msg.id,
              type: msg.type,
              channel,
              from: msg.from,
              content: msg.content,
              timestamp: msg.timestamp
            });
          } catch (err) {
          }
        }
      }
      async getTotalMessageCount() {
        if (this.isConnected && this.db) {
          try {
            const doc = await this.db.collection("crosstalk_stats").findOne({ _id: "global_metrics" });
            if (doc && typeof doc.totalMessages === "number") {
              return doc.totalMessages;
            }
          } catch (_) {
          }
        }
        return this.inMemoryFallback.getTotalMessageCount();
      }
      async getRecentMessages(channel, limit = 100) {
        if (this.isConnected && this.db) {
          try {
            const docs = await this.db.collection("crosstalk_messages").find({ channel }).sort({ $natural: -1 }).limit(limit).toArray();
            if (docs.length > 0) {
              return docs.reverse().map((d) => ({
                id: d.id,
                type: d.type,
                channel: d.channel,
                from: d.from,
                content: d.content,
                timestamp: d.timestamp
              }));
            }
          } catch (_) {
          }
        }
        return this.inMemoryFallback.getRecentMessages(channel, limit);
      }
      async close() {
        if (this.client) {
          try {
            await this.client.close();
          } catch (_) {
          }
        }
      }
    };
  }
});

// src/server/subnet.ts
var SubnetGuard;
var init_subnet = __esm({
  "src/server/subnet.ts"() {
    "use strict";
    SubnetGuard = class {
      /**
       * Normalizes an IP string (unwraps IPv6 mapped IPv4 like ::ffff:192.168.1.10)
       */
      static normalizeIp(rawIp) {
        if (!rawIp) return "127.0.0.1";
        let ip = rawIp.trim();
        if (ip.startsWith("::ffff:")) {
          ip = ip.substring(7);
        }
        if (ip === "::1") {
          return "127.0.0.1";
        }
        return ip;
      }
      /**
       * Converts IPv4 string to 32-bit unsigned integer
       */
      static ipv4ToInt(ip) {
        const parts = ip.split(".");
        if (parts.length !== 4) return null;
        let n = 0;
        for (let i = 0; i < 4; i++) {
          const byte = parseInt(parts[i], 10);
          if (isNaN(byte) || byte < 0 || byte > 255) return null;
          n = (n << 8) + byte;
        }
        return n >>> 0;
      }
      /**
       * Checks if an IPv4 address is inside an IPv4 CIDR block (e.g. 192.168.1.0/24)
       */
      static matchesCidr(ip, cidr) {
        const cleanIp = this.normalizeIp(ip);
        const ipInt = this.ipv4ToInt(cleanIp);
        if (ipInt === null) {
          if (ip === "::1" && (cidr === "127.0.0.1/32" || cidr === "localhost" || cidr === "local")) {
            return true;
          }
          return false;
        }
        const [base, prefixStr] = cidr.split("/");
        const prefix = prefixStr !== void 0 ? parseInt(prefixStr, 10) : 32;
        if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
        const baseInt = this.ipv4ToInt(base);
        if (baseInt === null) return false;
        if (prefix === 0) return true;
        const mask = ~0 << 32 - prefix >>> 0;
        return (ipInt & mask) === (baseInt & mask);
      }
      /**
       * Checks if an IP is within private RFC1918 LAN space (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
       */
      static isPrivateOrLocal(ip) {
        const clean = this.normalizeIp(ip);
        return this.matchesCidr(clean, "127.0.0.0/8") || this.matchesCidr(clean, "10.0.0.0/8") || this.matchesCidr(clean, "172.16.0.0/12") || this.matchesCidr(clean, "192.168.0.0/16") || clean === "127.0.0.1" || clean === "localhost";
      }
      /**
       * Validates whether a client IP is allowed by a list of allowed subnets / rules
       * Supported rule presets:
       *  - 'any' | '*' | 'global' -> allow any IP
       *  - 'local' | 'localhost'  -> allow 127.0.0.0/8 only
       *  - 'lan' | 'private'      -> allow RFC1918 LAN ranges
       *  - CIDR like '192.168.1.0/24' or '10.50.0.0/16'
       *  - Single IP like '192.168.1.45'
       */
      static isAllowed(clientIp, allowedRules) {
        if (!allowedRules || allowedRules.length === 0) {
          return true;
        }
        const cleanIp = this.normalizeIp(clientIp);
        for (const rule of allowedRules) {
          const r = rule.trim().toLowerCase();
          if (!r) continue;
          if (r === "*" || r === "any" || r === "global") {
            return true;
          }
          if (r === "local" || r === "localhost") {
            if (cleanIp === "127.0.0.1" || this.matchesCidr(cleanIp, "127.0.0.0/8")) {
              return true;
            }
          }
          if (r === "lan" || r === "private") {
            if (this.isPrivateOrLocal(cleanIp)) {
              return true;
            }
          }
          const cidr = r.includes("/") ? r : `${r}/32`;
          if (this.matchesCidr(cleanIp, cidr)) {
            return true;
          }
        }
        return false;
      }
    };
  }
});

// src/server/hub.ts
import crypto from "node:crypto";
var MeshHub;
var init_hub = __esm({
  "src/server/hub.ts"() {
    "use strict";
    init_wrapper();
    init_locks();
    init_gibberlink();
    init_dictionary();
    init_engine();
    init_storage();
    init_subnet();
    MeshHub = class {
      clients = /* @__PURE__ */ new Map();
      // agentId -> ConnectedClient
      lockManager = new LockManager();
      storage;
      messageHistory = /* @__PURE__ */ new Map();
      // channel -> MessageEvent[]
      inboxes = /* @__PURE__ */ new Map();
      // agentId -> MessageEvent[]
      maxHistoryPerChannel = 100;
      maxInboxPerAgent = 50;
      totalMessagesRouted = 0;
      startTime = Date.now();
      allowedSubnets = [];
      constructor(storage, allowedSubnets) {
        this.storage = storage || new InMemoryStorage(this.maxHistoryPerChannel);
        this.allowedSubnets = allowedSubnets || [];
        this.storage.getTotalMessageCount().then((cnt) => {
          if (cnt > 0) this.totalMessagesRouted = cnt;
        }).catch(() => {
        });
      }
      setAllowedSubnets(subnets) {
        this.allowedSubnets = subnets;
      }
      getAllowedSubnets() {
        return this.allowedSubnets;
      }
      async initStorage(channel = "default") {
        try {
          const recent = await this.storage.getRecentMessages(channel, this.maxHistoryPerChannel);
          if (recent.length > 0) {
            this.messageHistory.set(channel, [...recent]);
          }
          const count = await this.storage.getTotalMessageCount();
          if (count > 0) {
            this.totalMessagesRouted = count;
          }
        } catch (_) {
        }
      }
      getStorage() {
        return this.storage;
      }
      getLockManager() {
        return this.lockManager;
      }
      handleConnection(ws, req) {
        let currentAgentId = null;
        const clientIp = req?.socket?.remoteAddress || req?.headers["x-forwarded-for"]?.split(",")[0] || "127.0.0.1";
        if (!SubnetGuard.isAllowed(clientIp, this.allowedSubnets)) {
          console.warn(`[MeshHub] \u26D4 Connection rejected from ${clientIp}: outside authorized subnet policy.`);
          ws.close(4003, "Subnet policy violation");
          return;
        }
        ws.on("message", (raw) => {
          try {
            const text = typeof raw === "string" ? raw : raw.toString("utf8");
            const packet = JSON.parse(text);
            this.processPacket(ws, packet, clientIp, (id) => {
              currentAgentId = id;
            });
          } catch (err) {
            this.send(ws, {
              type: "error",
              message: `Malformed packet: ${err.message}`
            });
          }
        });
        ws.on("close", () => {
          if (currentAgentId) {
            this.handleDisconnect(currentAgentId);
          }
        });
        ws.on("error", (err) => {
          console.error(`[MeshHub] Socket error for agent ${currentAgentId || "unknown"}:`, err);
        });
      }
      processPacket(ws, packet, clientIp, setAgentId) {
        switch (packet.type) {
          case "register": {
            const channel = packet.channel || "default";
            const rawAgent = packet.agent;
            const id = rawAgent.id || `agent-${crypto.randomBytes(4).toString("hex")}`;
            setAgentId(id);
            const agent = {
              id,
              name: rawAgent.name || `Agent-${id.slice(0, 6)}`,
              role: rawAgent.role || "assistant",
              environment: rawAgent.environment || "ide",
              workspace: rawAgent.workspace || "default-workspace",
              status: "idle",
              currentTask: rawAgent.currentTask || "Connected to CrossTalk mesh",
              lockedFiles: [],
              connectedAt: Date.now(),
              lastSeen: Date.now(),
              gibberlinkCapable: rawAgent.gibberlinkCapable ?? true,
              dialectVersion: rawAgent.dialectVersion || DIALECT_V1.version,
              branch: rawAgent.branch || "main",
              subnet: clientIp
            };
            const existing = this.clients.get(id);
            if (existing && existing.ws !== ws) {
              try {
                existing.ws.close();
              } catch {
              }
            }
            this.clients.set(id, { ws, agent, channel });
            if (!this.inboxes.has(id)) {
              this.inboxes.set(id, []);
            }
            const activeLocks = this.lockManager.getLocks(channel);
            const currentAgents = this.getAgentsInChannel(channel);
            const recentMessages = this.getRecentMessages(channel);
            this.send(ws, {
              type: "registered",
              agentId: id,
              channel,
              dialect: DIALECT_V1,
              mesh: {
                agents: currentAgents,
                locks: activeLocks,
                recentMessages
              }
            });
            this.broadcastToChannel(
              channel,
              {
                type: "agent_joined",
                agent
              },
              [id]
            );
            this.recordAndBroadcastSystemMessage(
              channel,
              `Agent [${agent.name}] (${agent.role} in ${agent.environment}) connected with XDialect v${agent.dialectVersion}.`
            );
            console.log(`[MeshHub] Registered ${agent.name} (${id}) on channel '${channel}' with XDialect v${DIALECT_V1.version}`);
            break;
          }
          case "heartbeat": {
            const client = this.getClientByWs(ws);
            if (!client) break;
            client.agent.lastSeen = Date.now();
            if (packet.status) client.agent.status = packet.status;
            if (packet.currentTask) client.agent.currentTask = packet.currentTask;
            this.broadcastToChannel(client.channel, {
              type: "agent_updated",
              agent: client.agent
            });
            break;
          }
          case "broadcast": {
            const client = this.getClientByWs(ws);
            if (!client) {
              this.send(ws, { type: "error", message: "Not registered yet" });
              return;
            }
            const msg = {
              id: `msg-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
              type: "broadcast",
              channel: client.channel,
              from: client.agent,
              content: packet.content,
              timestamp: Date.now(),
              metadata: packet.metadata
            };
            this.appendMessageHistory(client.channel, msg);
            this.broadcastToChannel(client.channel, {
              type: "broadcast",
              message: msg
            });
            console.log(`[MeshHub] [${client.channel}] ${client.agent.name}: ${packet.content}`);
            break;
          }
          case "shorthand_broadcast": {
            const client = this.getClientByWs(ws);
            if (!client) {
              this.send(ws, { type: "error", message: "Not registered yet" });
              return;
            }
            const shorthand = packet.shorthand;
            const parsed = DialectEngine.parse(shorthand);
            const human = DialectEngine.toHuman(parsed);
            const bits = DialectEngine.packToBits(parsed);
            if (parsed.action === "!LCK" && parsed.target) {
              const res = this.lockManager.acquire(
                parsed.target,
                client.agent,
                parsed.reason || parsed.intent || "Shorthand lock",
                parsed.ttl || 300,
                client.channel
              );
              if (res.success && res.lock) {
                if (!client.agent.lockedFiles.includes(res.lock.file)) {
                  client.agent.lockedFiles.push(res.lock.file);
                }
                this.broadcastToChannel(client.channel, {
                  type: "lock_acquired",
                  lock: res.lock,
                  byMe: false
                }, [client.agent.id]);
              }
            } else if (parsed.action === "!REL" && parsed.target) {
              const res = this.lockManager.release(parsed.target, client.agent.id);
              if (res.success && res.lock) {
                client.agent.lockedFiles = client.agent.lockedFiles.filter((f) => f !== res.lock?.file);
                this.broadcastToChannel(client.channel, {
                  type: "lock_released",
                  file: res.lock.file,
                  releasedBy: client.agent.name
                });
              }
            }
            const msg = {
              id: `shorthand-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
              type: "dialect_shorthand",
              channel: client.channel,
              from: client.agent,
              content: human,
              timestamp: Date.now(),
              metadata: packet.metadata,
              shorthand: {
                raw: shorthand,
                human,
                bitSize: bits.length,
                action: parsed.action,
                target: parsed.target,
                intent: parsed.intent
              }
            };
            this.appendMessageHistory(client.channel, msg);
            this.broadcastToChannel(client.channel, {
              type: "broadcast",
              message: msg
            });
            console.log(`[MeshHub] [XDialect] ${client.agent.name}: "${shorthand}" -> (${bits.length} wire bytes)`);
            break;
          }
          case "direct_message": {
            const client = this.getClientByWs(ws);
            if (!client) {
              this.send(ws, { type: "error", message: "Not registered yet" });
              return;
            }
            const targetClient = this.clients.get(packet.to);
            const msg = {
              id: `dm-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
              type: "direct_message",
              channel: client.channel,
              from: client.agent,
              to: packet.to,
              content: packet.content,
              timestamp: Date.now(),
              isAck: packet.isAck,
              replyExpected: packet.replyExpected,
              branch: client.agent.branch,
              metadata: packet.metadata
            };
            this.addToInbox(packet.to, msg);
            if (targetClient) {
              this.send(targetClient.ws, {
                type: "direct_message",
                message: msg
              });
            }
            this.send(ws, {
              type: "direct_message_sent",
              messageId: msg.id,
              to: packet.to,
              timestamp: Date.now()
            });
            console.log(`[MeshHub] DM [${client.agent.name} -> ${targetClient?.agent.name || packet.to}]: ${packet.content}`);
            break;
          }
          case "disconnect": {
            const client = this.getClientByWs(ws);
            if (client) {
              console.log(`[MeshHub] Agent ${client.agent.name} initiated graceful disconnect: ${packet.reason || "client_shutdown"}`);
              this.handleDisconnect(client.agent.id);
            }
            break;
          }
          case "gibberlink_signal": {
            const client = this.getClientByWs(ws);
            if (!client) {
              this.send(ws, { type: "error", message: "Not registered yet" });
              return;
            }
            const signal = packet.signal;
            const decoded = GibberlinkEngine.decode(signal);
            if (decoded.valid && decoded.data && typeof decoded.data === "object") {
              if (decoded.data.action === "LOCK" && decoded.data.file) {
                this.lockManager.acquire(
                  decoded.data.file,
                  client.agent,
                  decoded.data.reason || "Gibberlink signal lock",
                  decoded.data.ttlSeconds || 300,
                  client.channel
                );
              } else if (decoded.data.action === "UNLOCK" && decoded.data.file) {
                this.lockManager.release(decoded.data.file, client.agent.id);
              }
            }
            const msg = {
              id: `glink-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
              type: "gibberlink_signal",
              channel: client.channel,
              from: client.agent,
              to: packet.to,
              content: decoded.text || signal.text || "[Gibberlink Audio Signal Stream]",
              timestamp: Date.now(),
              gibberlinkSignal: signal
            };
            this.appendMessageHistory(client.channel, msg);
            if (packet.to) {
              this.addToInbox(packet.to, msg);
              const targetClient = this.clients.get(packet.to);
              if (targetClient) {
                this.send(targetClient.ws, {
                  type: "gibberlink_signal",
                  message: msg,
                  signal
                });
              }
              this.send(ws, {
                type: "gibberlink_signal",
                message: msg,
                signal
              });
            } else {
              this.broadcastToChannel(client.channel, {
                type: "gibberlink_signal",
                message: msg,
                signal
              });
            }
            console.log(`[MeshHub] [Gibberlink Signal] ${client.agent.name} emitted ${signal.frequencies.length} tones (${signal.totalDurationMs}ms audio signal)`);
            break;
          }
          case "get_dialect": {
            this.send(ws, {
              type: "dialect_dictionary",
              dictionary: DIALECT_V1
            });
            break;
          }
          case "lock_acquire": {
            const client = this.getClientByWs(ws);
            if (!client) {
              this.send(ws, { type: "error", message: "Not registered yet" });
              return;
            }
            const res = this.lockManager.acquire(
              packet.file,
              client.agent,
              packet.reason,
              packet.ttlSeconds || 300,
              client.channel
            );
            if (res.success && res.lock) {
              if (!client.agent.lockedFiles.includes(res.lock.file)) {
                client.agent.lockedFiles.push(res.lock.file);
              }
              this.broadcastToChannel(client.channel, {
                type: "lock_acquired",
                lock: res.lock,
                byMe: false
              }, [client.agent.id]);
              this.send(ws, {
                type: "lock_acquired",
                lock: res.lock,
                byMe: true
              });
              this.recordAndBroadcastSystemMessage(
                client.channel,
                `File claimed: [${res.lock.file}] locked by ${client.agent.name} ("${packet.reason}")`
              );
            } else if (res.existingHolder) {
              const holderClient = this.clients.get(res.existingHolder.id);
              const holderAgent = holderClient ? holderClient.agent : {
                id: res.existingHolder.id,
                name: res.existingHolder.name,
                role: "agent",
                environment: "unknown",
                workspace: "",
                status: "working",
                currentTask: res.existingHolder.reason,
                lockedFiles: [packet.file],
                connectedAt: 0,
                lastSeen: 0
              };
              this.send(ws, {
                type: "lock_denied",
                file: packet.file,
                holder: holderAgent,
                reason: res.existingHolder.reason,
                expiresAt: res.existingHolder.expiresAt
              });
              if (holderClient) {
                this.send(holderClient.ws, {
                  type: "lock_conflict_warning",
                  file: packet.file,
                  requester: client.agent,
                  holder: holderAgent,
                  reason: packet.reason
                });
                const conflictNotice = {
                  id: `warn-${Date.now()}`,
                  type: "system",
                  channel: client.channel,
                  from: client.agent,
                  to: holderClient.agent.id,
                  content: `Conflict Warning: Agent ${client.agent.name} attempted to lock file '${packet.file}' which you currently hold (Reason: "${packet.reason}").`,
                  timestamp: Date.now()
                };
                this.addToInbox(holderClient.agent.id, conflictNotice);
              }
            }
            break;
          }
          case "lock_release": {
            const client = this.getClientByWs(ws);
            if (!client) {
              this.send(ws, { type: "error", message: "Not registered yet" });
              return;
            }
            const res = this.lockManager.release(packet.file, client.agent.id);
            if (res.success && res.lock) {
              client.agent.lockedFiles = client.agent.lockedFiles.filter((f) => f !== res.lock?.file);
              this.broadcastToChannel(client.channel, {
                type: "lock_released",
                file: res.lock.file,
                releasedBy: client.agent.name
              });
              this.recordAndBroadcastSystemMessage(
                client.channel,
                `File released: [${res.lock.file}] is now unlocked by ${client.agent.name}.`
              );
            }
            break;
          }
          case "query_state": {
            const client = this.getClientByWs(ws);
            const channel = client?.channel || "default";
            this.send(ws, {
              type: "state_snapshot",
              agents: this.getAgentsInChannel(channel),
              locks: this.lockManager.getLocks(channel),
              recentMessages: this.getRecentMessages(channel)
            });
            break;
          }
          case "fetch_inbox": {
            const client = this.getClientByWs(ws);
            if (!client) return;
            const since = packet.since || 0;
            const agentInbox = this.inboxes.get(client.agent.id) || [];
            const filtered = agentInbox.filter((m) => m.timestamp >= since);
            this.send(ws, {
              type: "inbox_batch",
              messages: filtered
            });
            break;
          }
        }
      }
      handleDisconnect(agentId) {
        const client = this.clients.get(agentId);
        if (!client) return;
        this.clients.delete(agentId);
        const releasedLocks = this.lockManager.releaseAllByAgent(agentId);
        for (const lock of releasedLocks) {
          this.broadcastToChannel(client.channel, {
            type: "lock_released",
            file: lock.file,
            releasedBy: client.agent.name
          });
        }
        this.broadcastToChannel(client.channel, {
          type: "agent_left",
          agentId,
          name: client.agent.name,
          reason: "Disconnected"
        });
        this.recordAndBroadcastSystemMessage(
          client.channel,
          `Agent [${client.agent.name}] disconnected.`
        );
        console.log(`[MeshHub] Disconnected agent ${client.agent.name} (${agentId})`);
      }
      broadcastToChannel(channel, packet, excludeIds = []) {
        for (const [id, client] of this.clients.entries()) {
          if (client.channel === channel && !excludeIds.includes(id)) {
            this.send(client.ws, packet);
          }
        }
      }
      send(ws, packet) {
        if (ws.readyState === import_websocket.default.OPEN) {
          ws.send(JSON.stringify(packet));
        }
      }
      getClientByWs(ws) {
        for (const client of this.clients.values()) {
          if (client.ws === ws) return client;
        }
        return void 0;
      }
      getAgentsInChannel(channel) {
        const list = [];
        for (const client of this.clients.values()) {
          if (client.channel === channel) {
            list.push(client.agent);
          }
        }
        return list;
      }
      getAllAgents() {
        return Array.from(this.clients.values()).map((c) => c.agent);
      }
      getRecentMessages(channel) {
        return this.messageHistory.get(channel) || [];
      }
      appendMessageHistory(channel, msg) {
        this.totalMessagesRouted++;
        if (!this.messageHistory.has(channel)) {
          this.messageHistory.set(channel, []);
        }
        const history = this.messageHistory.get(channel);
        history.push(msg);
        if (history.length > this.maxHistoryPerChannel) {
          history.shift();
        }
        this.storage.recordMessage(channel, msg).catch(() => {
        });
      }
      getStats(channel = "default") {
        const channelHistory = this.messageHistory.get(channel) || [];
        const locks = this.lockManager.getLocks(channel);
        return {
          totalMessagesRouted: this.totalMessagesRouted,
          activePeers: this.clients.size,
          activeLocks: locks.length,
          uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1e3),
          recentHistoryCount: channelHistory.length,
          maxBufferCapacity: this.maxHistoryPerChannel,
          channel,
          meshVersion: DIALECT_V1.version,
          storageMode: this.storage.constructor?.name === "MongoStorage" ? "mongodb" : "memory",
          timestamp: Date.now()
        };
      }
      addToInbox(agentId, msg) {
        if (!this.inboxes.has(agentId)) {
          this.inboxes.set(agentId, []);
        }
        const inbox = this.inboxes.get(agentId);
        inbox.push(msg);
        if (inbox.length > this.maxInboxPerAgent) {
          inbox.shift();
        }
      }
      recordAndBroadcastSystemMessage(channel, content) {
        const msg = {
          id: `sys-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
          type: "system",
          channel,
          content,
          timestamp: Date.now()
        };
        this.appendMessageHistory(channel, msg);
        this.broadcastToChannel(channel, {
          type: "broadcast",
          message: msg
        });
      }
      injectBroadcast(channel, fromName, content, role = "system") {
        const syntheticAgent = {
          id: `ext-${Date.now()}`,
          name: fromName,
          role,
          environment: "terminal",
          workspace: "local",
          status: "working",
          currentTask: content,
          lockedFiles: [],
          connectedAt: Date.now(),
          lastSeen: Date.now(),
          gibberlinkCapable: true
        };
        const msg = {
          id: `msg-${Date.now()}`,
          type: "broadcast",
          channel,
          from: syntheticAgent,
          content,
          timestamp: Date.now()
        };
        this.appendMessageHistory(channel, msg);
        this.broadcastToChannel(channel, {
          type: "broadcast",
          message: msg
        });
        return msg;
      }
      createInvite(options = {}) {
        const channel = options.channel || "default";
        const branch = options.branch || "main";
        const host = options.host || "localhost:4488";
        const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
        const cleanHost = host.replace(/^(http|https|ws|wss):\/\//, "");
        const wsScheme = host.startsWith("https") ? "wss" : "ws";
        const httpScheme = host.startsWith("https") ? "https" : "http";
        const randomSuffix = crypto.randomBytes(2).toString("hex").toUpperCase();
        const branchTag = branch.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8).toUpperCase() || "SYNC";
        const code = `XT-${randomSuffix}-${branchTag}`;
        const subnetLock = options.allowedSubnet || (isLocal ? "192.168.0.0/16" : "any");
        return {
          code,
          channel,
          branch,
          subnetLock,
          options: {
            centralRelay: {
              name: "Central Hosted Bridge (Key / Code / Link)",
              code,
              joinLink: `${httpScheme}://${cleanHost}/?room=${code}&branch=${branch}`,
              wsUrl: `${wsScheme}://${cleanHost}`,
              agentPrompt: `Join CrossTalk session ${code} on branch ${branch}`,
              cliCommand: `crosstalk join ${code} --branch ${branch}`
            },
            openMesh: {
              name: "Open Mesh (Discovery Topic Rendezvous)",
              topic: `mesh://open/repo-${branchTag.toLowerCase()}`,
              agentPrompt: `Connect to open mesh channel 'team-${branchTag.toLowerCase()}' on branch ${branch}`,
              cliCommand: `crosstalk up team-${branchTag.toLowerCase()} --mode mesh --branch ${branch}`
            },
            directP2P: {
              name: "Direct Computer-to-Computer (Subnet Locked)",
              address: `${wsScheme}://${cleanHost}`,
              subnetLock,
              agentPrompt: `Connect directly to peer ${wsScheme}://${cleanHost} on branch ${branch} with subnet lock ${subnetLock}`,
              cliCommand: `crosstalk join ${wsScheme}://${cleanHost} --branch ${branch} --subnet ${subnetLock}`
            }
          }
        };
      }
    };
  }
});

// node_modules/colorette/index.js
import * as tty from "tty";
var env, argv, platform, isDisabled, isForced, isWindows, isDumbTerminal, isCompatibleTerminal, isCI, isColorSupported, replaceClose, clearBleed, filterEmpty, init, colors, createColors, reset, bold, dim, italic, underline, inverse, hidden, strikethrough, black, red, green, yellow, blue, magenta, cyan, white, gray, bgBlack, bgRed, bgGreen, bgYellow, bgBlue, bgMagenta, bgCyan, bgWhite, blackBright, redBright, greenBright, yellowBright, blueBright, magentaBright, cyanBright, whiteBright, bgBlackBright, bgRedBright, bgGreenBright, bgYellowBright, bgBlueBright, bgMagentaBright, bgCyanBright, bgWhiteBright;
var init_colorette = __esm({
  "node_modules/colorette/index.js"() {
    ({
      env = {},
      argv = [],
      platform = ""
    } = typeof process === "undefined" ? {} : process);
    isDisabled = "NO_COLOR" in env || argv.includes("--no-color");
    isForced = "FORCE_COLOR" in env || argv.includes("--color");
    isWindows = platform === "win32";
    isDumbTerminal = env.TERM === "dumb";
    isCompatibleTerminal = tty && tty.isatty && tty.isatty(1) && env.TERM && !isDumbTerminal;
    isCI = "CI" in env && ("GITHUB_ACTIONS" in env || "GITLAB_CI" in env || "CIRCLECI" in env);
    isColorSupported = !isDisabled && (isForced || isWindows && !isDumbTerminal || isCompatibleTerminal || isCI);
    replaceClose = (index, string, close, replace, head = string.substring(0, index) + replace, tail = string.substring(index + close.length), next = tail.indexOf(close)) => head + (next < 0 ? tail : replaceClose(next, tail, close, replace));
    clearBleed = (index, string, open, close, replace) => index < 0 ? open + string + close : open + replaceClose(index, string, close, replace) + close;
    filterEmpty = (open, close, replace = open, at = open.length + 1) => (string) => string || !(string === "" || string === void 0) ? clearBleed(
      ("" + string).indexOf(close, at),
      string,
      open,
      close,
      replace
    ) : "";
    init = (open, close, replace) => filterEmpty(`\x1B[${open}m`, `\x1B[${close}m`, replace);
    colors = {
      reset: init(0, 0),
      bold: init(1, 22, "\x1B[22m\x1B[1m"),
      dim: init(2, 22, "\x1B[22m\x1B[2m"),
      italic: init(3, 23),
      underline: init(4, 24),
      inverse: init(7, 27),
      hidden: init(8, 28),
      strikethrough: init(9, 29),
      black: init(30, 39),
      red: init(31, 39),
      green: init(32, 39),
      yellow: init(33, 39),
      blue: init(34, 39),
      magenta: init(35, 39),
      cyan: init(36, 39),
      white: init(37, 39),
      gray: init(90, 39),
      bgBlack: init(40, 49),
      bgRed: init(41, 49),
      bgGreen: init(42, 49),
      bgYellow: init(43, 49),
      bgBlue: init(44, 49),
      bgMagenta: init(45, 49),
      bgCyan: init(46, 49),
      bgWhite: init(47, 49),
      blackBright: init(90, 39),
      redBright: init(91, 39),
      greenBright: init(92, 39),
      yellowBright: init(93, 39),
      blueBright: init(94, 39),
      magentaBright: init(95, 39),
      cyanBright: init(96, 39),
      whiteBright: init(97, 39),
      bgBlackBright: init(100, 49),
      bgRedBright: init(101, 49),
      bgGreenBright: init(102, 49),
      bgYellowBright: init(103, 49),
      bgBlueBright: init(104, 49),
      bgMagentaBright: init(105, 49),
      bgCyanBright: init(106, 49),
      bgWhiteBright: init(107, 49)
    };
    createColors = ({ useColor = isColorSupported } = {}) => useColor ? colors : Object.keys(colors).reduce(
      (colors2, key) => ({ ...colors2, [key]: String }),
      {}
    );
    ({
      reset,
      bold,
      dim,
      italic,
      underline,
      inverse,
      hidden,
      strikethrough,
      black,
      red,
      green,
      yellow,
      blue,
      magenta,
      cyan,
      white,
      gray,
      bgBlack,
      bgRed,
      bgGreen,
      bgYellow,
      bgBlue,
      bgMagenta,
      bgCyan,
      bgWhite,
      blackBright,
      redBright,
      greenBright,
      yellowBright,
      blueBright,
      magentaBright,
      cyanBright,
      whiteBright,
      bgBlackBright,
      bgRedBright,
      bgGreenBright,
      bgYellowBright,
      bgBlueBright,
      bgMagentaBright,
      bgCyanBright,
      bgWhiteBright
    } = createColors());
  }
});

// src/server/index.ts
import http from "node:http";
import fs from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
async function startServer(port = 4488, host = "0.0.0.0", customStorage, allowedSubnets) {
  const storage = customStorage || await createMeshStorage();
  const hub = new MeshHub(storage, allowedSubnets);
  await hub.initStorage("default");
  const webDir = path2.join(__dirname, "web");
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    if (pathname === "/api/state") {
      const channel = url.searchParams.get("channel") || "default";
      const agents = hub.getAgentsInChannel(channel);
      const locks = hub.getLockManager().getLocks(channel);
      const messages = hub.getRecentMessages(channel);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ channel, agents, locks, messages }, null, 2));
      return;
    }
    if (pathname === "/api/who") {
      const allAgents = hub.getAllAgents();
      const allLocks = hub.getLockManager().getLocks();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ agents: allAgents, locks: allLocks }, null, 2));
      return;
    }
    if (pathname === "/api/dialect" || pathname === "/api/dialect/v1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(DIALECT_V1, null, 2));
      return;
    }
    if (pathname === "/api/stats") {
      const channel = url.searchParams.get("channel") || "default";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(hub.getStats(channel), null, 2));
      return;
    }
    if (pathname === "/api/history") {
      const channel = url.searchParams.get("channel") || "default";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 100);
      const messages = hub.getRecentMessages(channel).slice(-limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ channel, count: messages.length, limit, messages }, null, 2));
      return;
    }
    if (pathname === "/api/invite") {
      const channel = url.searchParams.get("channel") || "default";
      const branch = url.searchParams.get("branch") || "main";
      const allowedSubnet = url.searchParams.get("subnet") || void 0;
      const host2 = req.headers.host || `localhost:${port}`;
      const invite = hub.createInvite({ channel, branch, allowedSubnet, host: host2 });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(invite, null, 2));
      return;
    }
    if (pathname === "/api/broadcast" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const channel = parsed.channel || "default";
          const from = parsed.from || "Human-Operator";
          const content = parsed.content || "";
          if (!content) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "content required" }));
            return;
          }
          const msg = hub.injectBroadcast(channel, from, content, parsed.role || "human");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: msg }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (pathname === "/api/check-lock" && req.method === "GET") {
      const file = url.searchParams.get("file");
      if (!file) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "file param required" }));
        return;
      }
      const lockStatus = hub.getLockManager().isLocked(file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(lockStatus));
      return;
    }
    let filePath = path2.join(webDir, pathname === "/" ? "index.html" : pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path2.join(webDir, "index.html");
    }
    if (fs.existsSync(filePath)) {
      const ext = path2.extname(filePath);
      const mimeTypes = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".sh": "application/x-sh",
        ".py": "text/x-python",
        ".h": "text/x-c",
        ".svg": "image/svg+xml",
        ".json": "application/json"
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });
  const wss = new import_websocket_server.default({ server });
  wss.on("connection", (ws, req) => {
    hub.handleConnection(ws, req);
  });
  server.listen(port, host, () => {
    console.log(`
${bold(green("\u26A1 CrossTalk Mesh Network Server Running!"))}`);
    console.log(`\u{1F4E1} WebSocket URL:      ${cyan(`ws://localhost:${port}`)}`);
    console.log(`\u{1F310} Live Dashboard:     ${cyan(`http://localhost:${port}`)}`);
    console.log(`\u{1F4D6} Dialect Dictionary: ${cyan(`http://localhost:${port}/api/dialect`)}
`);
  });
  return { server, wss, hub };
}
var __filename, __dirname;
var init_server = __esm({
  "src/server/index.ts"() {
    "use strict";
    init_wrapper();
    init_hub();
    init_dictionary();
    init_storage();
    init_colorette();
    __filename = fileURLToPath(import.meta.url);
    __dirname = path2.dirname(__filename);
    if (process.argv[1] && (process.argv[1].endsWith("server/index.ts") || process.argv[1].endsWith("server/index.js"))) {
      const port = parseInt(process.env.CROSSTALK_PORT || "4488", 10);
      startServer(port);
    }
  }
});

// node_modules/commander/esm.mjs
var import_index = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index.default;

// src/client/sdk.ts
init_wrapper();
init_gibberlink();
import EventEmitter from "node:events";

// src/server/binary.ts
var BinaryCodec = class {
  static MAGIC = 88;
  static VERSION = 1;
  static encode(frame) {
    let flagsByte = 0;
    if (frame.flags.ackRequested) flagsByte |= 1 << 0;
    if (frame.flags.isResponse) flagsByte |= 1 << 1;
    if (frame.flags.conflictAlert) flagsByte |= 1 << 2;
    const payloadStr = typeof frame.payload === "string" ? frame.payload : JSON.stringify(frame.payload);
    const payloadBuf = Buffer.from(payloadStr, "utf8");
    const totalLength = 10 + payloadBuf.length;
    const buf = Buffer.alloc(totalLength);
    buf.writeUInt8(this.MAGIC, 0);
    buf.writeUInt8(this.VERSION, 1);
    buf.writeUInt8(frame.opcode, 2);
    buf.writeUInt8(flagsByte, 3);
    const sec = Math.floor((frame.timestamp || Date.now()) / 1e3);
    buf.writeUInt32BE(sec, 4);
    buf.writeUInt16BE(payloadBuf.length, 8);
    payloadBuf.copy(buf, 10);
    return buf;
  }
  static decode(buf) {
    if (buf.length < 10) return null;
    if (buf.readUInt8(0) !== this.MAGIC || buf.readUInt8(1) !== this.VERSION) {
      return null;
    }
    const opcode = buf.readUInt8(2);
    const flagsByte = buf.readUInt8(3);
    const sec = buf.readUInt32BE(4);
    const payloadLen = buf.readUInt16BE(8);
    if (buf.length < 10 + payloadLen) return null;
    const payloadStr = buf.subarray(10, 10 + payloadLen).toString("utf8");
    let payload = payloadStr;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
    }
    return {
      opcode,
      flags: {
        ackRequested: (flagsByte & 1 << 0) !== 0,
        isResponse: (flagsByte & 1 << 1) !== 0,
        conflictAlert: (flagsByte & 1 << 2) !== 0
      },
      timestamp: sec * 1e3,
      payload
    };
  }
};

// src/client/sdk.ts
init_dictionary();
init_engine();
import { execSync } from "node:child_process";
function detectGitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "main";
  } catch {
    return "main";
  }
}
var CrossTalkClient = class extends EventEmitter {
  ws = null;
  options;
  heartbeatInterval = null;
  isConnected = false;
  myAgentId = "";
  currentDialect = DIALECT_V1;
  pendingLockResolvers = /* @__PURE__ */ new Map();
  pendingStateResolver = null;
  pendingInboxResolver = null;
  recentMessages = [];
  constructor(options) {
    super();
    this.options = {
      url: options.url || process.env.CROSSTALK_URL || "ws://localhost:4488",
      channel: options.channel || process.env.CROSSTALK_CHANNEL || "default",
      name: options.name,
      role: options.role || "developer",
      environment: options.environment || "bot",
      workspace: options.workspace || process.cwd(),
      currentTask: options.currentTask || "Idle",
      autoHeartbeat: options.autoHeartbeat !== false,
      gibberlinkCapable: options.gibberlinkCapable !== false,
      dialectVersion: options.dialectVersion || DIALECT_V1.version,
      branch: options.branch || detectGitBranch(),
      sessionKey: options.sessionKey || ""
    };
  }
  get agentId() {
    return this.myAgentId;
  }
  get dialect() {
    return this.currentDialect;
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new import_websocket.default(this.options.url);
      this.ws.on("open", () => {
        this.sendPacket({
          type: "register",
          channel: this.options.channel,
          sessionKey: this.options.sessionKey,
          agent: {
            name: this.options.name,
            role: this.options.role,
            environment: this.options.environment,
            workspace: this.options.workspace,
            currentTask: this.options.currentTask,
            gibberlinkCapable: this.options.gibberlinkCapable,
            dialectVersion: this.options.dialectVersion,
            branch: this.options.branch
          }
        });
      });
      this.ws.on("message", (raw) => {
        try {
          if (Buffer.isBuffer(raw) && raw.length >= 10 && raw[0] === 88) {
            const frame = BinaryCodec.decode(raw);
            if (frame) {
              this.emit("binary_frame", frame);
              return;
            }
          }
          const packet = JSON.parse(raw.toString("utf8"));
          this.handlePacket(packet, resolve);
        } catch (err) {
          this.emit("error", err);
        }
      });
      this.ws.on("close", () => {
        this.isConnected = false;
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.emit("disconnected");
      });
      this.ws.on("error", (err) => {
        if (!this.isConnected) reject(err);
        this.emit("error", err);
      });
    });
  }
  handlePacket(packet, initialResolver) {
    switch (packet.type) {
      case "registered": {
        this.isConnected = true;
        this.myAgentId = packet.agentId;
        if (packet.dialect) {
          this.currentDialect = packet.dialect;
        }
        if (this.options.autoHeartbeat) {
          this.heartbeatInterval = setInterval(() => {
            this.heartbeat();
          }, 1e4);
        }
        if (initialResolver) {
          initialResolver({
            agentId: packet.agentId,
            channel: packet.channel,
            agents: packet.mesh.agents,
            locks: packet.mesh.locks,
            dialect: packet.dialect
          });
        }
        this.emit("ready", packet);
        break;
      }
      case "agent_joined":
        this.emit("agent_joined", packet.agent);
        break;
      case "agent_left":
        this.emit("agent_left", { id: packet.agentId, name: packet.name, reason: packet.reason });
        break;
      case "agent_updated":
        this.emit("agent_updated", packet.agent);
        break;
      case "broadcast":
        if (packet.message.type === "dialect_shorthand") {
          this.emit("dialect_shorthand", packet.message);
        }
        this.emit("broadcast", packet.message);
        break;
      case "direct_message":
        if (packet.message?.from?.id && packet.message.from.id === this.myAgentId) {
          return;
        }
        this.emit("direct_message", packet.message);
        break;
      case "direct_message_sent":
        this.emit("direct_message_sent", packet);
        break;
      case "gibberlink_signal":
        const decoded = GibberlinkEngine.decode(packet.signal);
        this.emit("gibberlink_signal", {
          message: packet.message,
          signal: packet.signal,
          decoded
        });
        break;
      case "dialect_dictionary":
        this.currentDialect = packet.dictionary;
        this.emit("dialect_updated", packet.dictionary);
        break;
      case "lock_acquired": {
        const resolver = this.pendingLockResolvers.get(packet.lock.file);
        if (resolver && packet.byMe) {
          this.pendingLockResolvers.delete(packet.lock.file);
          resolver({ success: true, lock: packet.lock });
        }
        this.emit("lock_acquired", packet.lock);
        break;
      }
      case "lock_denied": {
        const resolver = this.pendingLockResolvers.get(packet.file);
        if (resolver) {
          this.pendingLockResolvers.delete(packet.file);
          resolver({
            success: false,
            holder: packet.holder,
            reason: packet.reason,
            expiresAt: packet.expiresAt
          });
        }
        this.emit("lock_denied", packet);
        break;
      }
      case "lock_released":
        this.emit("lock_released", { file: packet.file, releasedBy: packet.releasedBy });
        break;
      case "lock_conflict_warning":
        this.emit("lock_conflict_warning", packet);
        break;
      case "state_snapshot":
        if (this.pendingStateResolver) {
          this.pendingStateResolver(packet);
          this.pendingStateResolver = null;
        }
        this.emit("state_snapshot", packet);
        break;
      case "inbox_batch":
        if (this.pendingInboxResolver) {
          this.pendingInboxResolver(packet.messages);
          this.pendingInboxResolver = null;
        }
        break;
      case "error":
        this.emit("server_error", packet.message);
        break;
    }
  }
  broadcast(content, metadata) {
    this.sendPacket({
      type: "broadcast",
      content,
      metadata
    });
  }
  /**
   * Broadcasts a message using the XDialect concise shorthand format.
   * Auto-translates to human language and packs into bitstream for wire efficiency.
   * Example: `!LCK @src/auth.ts #REF "jwt validation" &WAIT`
   */
  sendShorthand(shorthand, metadata) {
    this.sendPacket({
      type: "shorthand_broadcast",
      shorthand,
      metadata
    });
  }
  parseShorthand(shorthand) {
    return DialectEngine.parse(shorthand);
  }
  shorthandToHuman(shorthand) {
    return DialectEngine.toHuman(shorthand);
  }
  humanToShorthand(english) {
    return DialectEngine.fromHuman(english);
  }
  sendGibberlinkSignal(payload, mode = "audible_fast", to) {
    const signal = GibberlinkEngine.encode(payload, mode);
    this.sendPacket({
      type: "gibberlink_signal",
      signal,
      to
    });
    return signal;
  }
  sendBinary(frame) {
    if (this.ws && this.ws.readyState === import_websocket.default.OPEN) {
      const buf = BinaryCodec.encode(frame);
      this.ws.send(buf);
    }
  }
  async lockFile(file, reason, ttlSeconds = 300) {
    return new Promise((resolve) => {
      this.pendingLockResolvers.set(file, resolve);
      this.sendPacket({
        type: "lock_acquire",
        file,
        reason,
        ttlSeconds
      });
      setTimeout(() => {
        if (this.pendingLockResolvers.has(file)) {
          this.pendingLockResolvers.delete(file);
          resolve({ success: false, reason: "Lock request timed out" });
        }
      }, 5e3);
    });
  }
  unlockFile(file) {
    this.sendPacket({
      type: "lock_release",
      file
    });
  }
  heartbeat(status, currentTask) {
    if (status) this.options.currentTask = currentTask || this.options.currentTask;
    this.sendPacket({
      type: "heartbeat",
      status,
      currentTask: currentTask || this.options.currentTask
    });
  }
  updateTask(taskDescription, status = "working") {
    this.options.currentTask = taskDescription;
    this.heartbeat(status, taskDescription);
  }
  async getMeshState() {
    return new Promise((resolve) => {
      this.pendingStateResolver = resolve;
      this.sendPacket({ type: "query_state" });
      setTimeout(() => {
        if (this.pendingStateResolver) {
          this.pendingStateResolver = null;
          resolve({ agents: [], locks: [], recentMessages: [] });
        }
      }, 3e3);
    });
  }
  async fetchInbox(since = 0) {
    return new Promise((resolve) => {
      this.pendingInboxResolver = resolve;
      this.sendPacket({ type: "fetch_inbox", since });
      setTimeout(() => {
        if (this.pendingInboxResolver) {
          this.pendingInboxResolver = null;
          resolve([]);
        }
      }, 3e3);
    });
  }
  shouldSuppressAutoReply(msg) {
    if (msg.isAck || msg.replyExpected === false) return true;
    const content = (msg.content || "").trim().toLowerCase();
    if (content.startsWith("ack:") || content.startsWith("acknowledged:") || content.startsWith("\u5DF2\u6536\u5230")) {
      return true;
    }
    const now = Date.now();
    this.recentMessages = this.recentMessages.filter((m) => now - m.time < 3500);
    const count = this.recentMessages.filter((m) => m.content === content).length;
    this.recentMessages.push({ content, time: now });
    if (count >= 2) {
      console.warn(`[CrossTalk Client] \u{1F501} Circuit breaker: suppressed duplicate ping-pong reply for: "${content.slice(0, 30)}..."`);
      return true;
    }
    return false;
  }
  sendDirectMessage(toAgentId, content, options) {
    const isOptionsObj = options && ("isAck" in options || "replyExpected" in options || "metadata" in options);
    const isAck = isOptionsObj ? options.isAck : false;
    const replyExpected = isOptionsObj ? options.replyExpected ?? !isAck : true;
    const metadata = isOptionsObj ? options.metadata : options;
    this.sendPacket({
      type: "direct_message",
      to: toAgentId,
      content,
      isAck,
      replyExpected,
      metadata
    });
  }
  async disconnect(reason = "client_exit") {
    if (this.ws && this.isConnected) {
      try {
        this.sendPacket({ type: "disconnect", reason });
      } catch {
      }
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1e3, reason);
      } catch {
      }
      this.ws = null;
    }
    this.isConnected = false;
  }
  sendPacket(packet) {
    if (this.ws && this.ws.readyState === import_websocket.default.OPEN) {
      this.ws.send(JSON.stringify(packet));
    }
  }
};

// src/client/cli.ts
init_server();
init_dictionary();
init_engine();
init_colorette();
import readline from "node:readline";
var program2 = new Command();
program2.name("crosstalk").description("Real-time WebSocket mesh network for AI agent inter-communication, Gibberlink signals & XDialect").version("1.0.0");
program2.command("serve").description("Start the CrossTalk mesh hub server and web dashboard").option("-p, --port <number>", "Port to listen on", "4488").option("-h, --host <host>", "Host address to bind (0.0.0.0 for LAN/Wi-Fi)", "0.0.0.0").option("-s, --subnet <cidr>", "Lock sockets to specific subnet (e.g. 192.168.1.0/24, lan, local)").action((options) => {
  const port = parseInt(options.port, 10);
  const subnets = options.subnet ? [options.subnet] : void 0;
  startServer(port, options.host, void 0, subnets);
});
program2.command("up [channel]").description("Join a socket mesh channel in a single line (auto-spawns local socket if not yet running)").option("-n, --name <name>", "Agent display name", `Agent-${Math.floor(Math.random() * 9e3 + 1e3)}`).option("-r, --role <role>", "Agent role", "developer").option("-b, --branch <branch>", "Git branch name (auto-detected from git if omitted)").option("-u, --url <url>", "Server WebSocket URL", "ws://localhost:4488").option("-s, --subnet <cidr>", "Subnet lock CIDR (e.g. 192.168.1.0/24, lan, local)").option("-p, --port <number>", "Port to bind if auto-spawning", "4488").action(async (channel = "default", options) => {
  const port = parseInt(options.port, 10);
  console.log(bold(cyan(`
\u26A1 Connecting to CrossTalk socket on #${channel}...`)));
  let client;
  try {
    client = new CrossTalkClient({
      url: options.url,
      channel,
      name: options.name,
      role: options.role,
      environment: "terminal",
      branch: options.branch,
      currentTask: "Interactive session"
    });
    await client.connect();
  } catch {
    console.log(yellow(`[CrossTalk] No socket hub detected at ${options.url}. Auto-spawning local socket mesh...`));
    const subnets = options.subnet ? [options.subnet] : void 0;
    startServer(port, "0.0.0.0", void 0, subnets);
    await new Promise((r) => setTimeout(r, 400));
    client = new CrossTalkClient({
      url: options.url,
      channel,
      name: options.name,
      role: options.role,
      environment: "terminal",
      branch: options.branch,
      currentTask: "Interactive session"
    });
    await client.connect();
  }
  console.log(bold(green(`\u2714 Online in channel #${channel} as [${options.name}] (${client.agentId})`)));
  console.log(gray("Type your message or XDialect shorthand (!LCK @file, !REL @file, &WAIT):"));
  console.log(gray("Commands: /who, /lock <file>, /unlock <file>, /exit\n"));
  client.on("broadcast", (msg) => {
    if (msg.from?.id !== client.agentId) {
      if (msg.type === "dialect_shorthand" && msg.shorthand) {
        console.log(`
\u26A1 ${bold(magenta(`XDialect`))} from ${bold(cyan(msg.from?.name))}: ${yellow(msg.shorthand.raw)}`);
        console.log(`   \u2514\u2500> "${gray(msg.shorthand.human)}"`);
      } else {
        console.log(`
\u{1F4E2} ${bold(cyan(msg.from?.name || "System"))}: ${msg.content}`);
      }
      process.stdout.write("> ");
    }
  });
  client.on("direct_message", (msg) => {
    if (msg.from?.id !== client.agentId) {
      console.log(`
\u{1F512} ${bold(magenta(`DM from ${msg.from?.name}`))}: ${msg.content}`);
      process.stdout.write("> ");
    }
  });
  client.on("lock_acquired", (lock) => {
    console.log(`
\u{1F512} [MESH] ${bold(lock.holderName)} claimed [${yellow(lock.file)}] ("${lock.reason}")`);
    process.stdout.write("> ");
  });
  client.on("lock_released", (data) => {
    console.log(`
\u{1F513} [MESH] [${yellow(data.file)}] unlocked by ${bold(data.releasedBy)}`);
    process.stdout.write("> ");
  });
  client.on("lock_conflict_warning", (warn) => {
    console.log(`
\u{1F6A8} ${red(`[ALERT] ${warn.requester.name} requested [${warn.file}] which you hold!`)}`);
    process.stdout.write("> ");
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> "
  });
  rl.prompt();
  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    if (text === "/exit" || text === "/quit") {
      client.disconnect();
      process.exit(0);
    } else if (text.startsWith("/lock ")) {
      const parts = text.slice(6).split(" ");
      const file = parts[0];
      const reason = parts.slice(1).join(" ") || "Editing file";
      const res = await client.lockFile(file, reason);
      if (res.success) {
        console.log(green(`\u2714 Locked [${file}]`));
      } else {
        console.log(red(`\u2716 Denied: Held by ${res.holder?.name} ("${res.reason}")`));
      }
    } else if (text.startsWith("/unlock ")) {
      const file = text.slice(8).trim();
      client.unlockFile(file);
      console.log(green(`\u2714 Released [${file}]`));
    } else if (text === "/who") {
      const s = await client.getMeshState();
      console.log(`Online: ${s.agents.map((a) => `${a.name} (${a.currentTask})`).join(", ")}`);
      if (s.locks.length > 0) {
        console.log(`Locks: ${s.locks.map((l) => `${l.file} by ${l.holderName}`).join(", ")}`);
      }
    } else if (text.startsWith("!") || text.startsWith("#")) {
      client.sendShorthand(text);
    } else {
      client.broadcast(text);
    }
    rl.prompt();
  });
  const keepalive = setInterval(() => {
  }, 15e3);
  const shutdown = async () => {
    clearInterval(keepalive);
    console.log(yellow("\n[CrossTalk] Disconnecting gracefully..."));
    await client.disconnect("user_exit");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
program2.command("invite").alias("pair").alias("share").description("Generate cross-branch agent pairing invite with 3 communication options").option("-c, --channel <channel>", "Channel name", "default").option("-b, --branch <branch>", "My git branch name (auto-detected if omitted)").option("-s, --subnet <cidr>", "Subnet boundary lock (e.g. 192.168.1.0/24, lan, local)").option("-u, --url <url>", "Hub URL or host address", "localhost:4488").action(async (options) => {
  const { execSync: execSync2 } = await import("node:child_process");
  let branch = options.branch;
  if (!branch) {
    try {
      branch = execSync2("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "main";
    } catch {
      branch = "main";
    }
  }
  const host = options.url.replace(/^(http|https|ws|wss):\/\//, "");
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  const subnetLock = options.subnet || (isLocal ? "192.168.0.0/16" : "any");
  const crypto2 = await import("node:crypto");
  const randomSuffix = crypto2.randomBytes(2).toString("hex").toUpperCase();
  const branchTag = branch.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8).toUpperCase() || "SYNC";
  const code = `XT-${randomSuffix}-${branchTag}`;
  console.log(bold(cyan(`
\u26A1 CrossTalk Agent Pairing & Cross-Branch Bridge`)));
  console.log(`${gray("My Active Branch:")} ${bold(green(branch))}
`);
  console.log(`Give your friend (or their agent) ${bold("ONE")} of these 3 options to connect:
`);
  console.log(bold(cyan(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`)));
  console.log(bold(`Option 1: Central Hosted Relay (Zero-Config \xB7 Recommended)`));
  console.log(bold(cyan(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`)));
  console.log(`  \u{1F511} Session Code:  ${bold(yellow(code))}`);
  console.log(`  \u{1F517} Web Join Link: ${cyan(`http://${host}/?room=${code}&branch=${branch}`)}
`);
  console.log(`  \u{1F4AC} ${bold("What to tell your friend's agent in chat:")}`);
  console.log(`     ${green(`"Join CrossTalk session ${code} on branch feature-ui"`)}
`);
  console.log(`  \u{1F4BB} ${bold("What your friend runs in terminal:")}`);
  console.log(`     ${cyan(`crosstalk join ${code} --branch feature-ui`)}
`);
  console.log(bold(cyan(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`)));
  console.log(bold(`Option 2: Open Mesh (Distributed Discovery Rendezvous)`));
  console.log(bold(cyan(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`)));
  console.log(`  \u{1F310} Topic:         ${yellow(`mesh://open/repo-${branchTag.toLowerCase()}`)}
`);
  console.log(`  \u{1F4AC} ${bold("What to tell your friend's agent in chat:")}`);
  console.log(`     ${green(`"Connect to open mesh channel 'team-${branchTag.toLowerCase()}' on branch feature-ui"`)}
`);
  console.log(`  \u{1F4BB} ${bold("What your friend runs in terminal:")}`);
  console.log(`     ${cyan(`crosstalk up team-${branchTag.toLowerCase()} --mode mesh --branch feature-ui`)}
`);
  console.log(bold(cyan(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`)));
  console.log(bold(`Option 3: Direct Computer-to-Computer (Subnet Locked P2P)`));
  console.log(bold(cyan(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`)));
  console.log(`  \u{1F4E1} Direct Socket: ${cyan(`ws://${host}`)}`);
  console.log(`  \u{1F512} Subnet Lock:   ${yellow(subnetLock)} ${gray("(Strict boundary: external packets rejected)")}
`);
  console.log(`  \u{1F4AC} ${bold("What to tell your friend's agent in chat:")}`);
  console.log(`     ${green(`"Connect directly to peer ws://${host} on branch feature-ui with subnet lock ${subnetLock}"`)}
`);
  console.log(`  \u{1F4BB} ${bold("What your friend runs in terminal:")}`);
  console.log(`     ${cyan(`crosstalk join ws://${host} --branch feature-ui --subnet ${subnetLock}`)}
`);
});
program2.command("join <target>").description("Join a CrossTalk session using an invite code (XT-XXXX), URL, or direct address").option("-n, --name <name>", "Agent display name", `Agent-${Math.floor(Math.random() * 9e3 + 1e3)}`).option("-r, --role <role>", "Agent role", "developer").option("-b, --branch <branch>", "My git branch name (auto-detected if omitted)").option("-s, --subnet <cidr>", "Subnet lock CIDR", "any").action(async (target, options) => {
  let url = "ws://localhost:4488";
  let channel = "default";
  if (target.startsWith("XT-")) {
    channel = target;
    console.log(bold(cyan(`
\u26A1 Joining session via Invite Code ${bold(yellow(target))}...`)));
  } else if (target.startsWith("ws://") || target.startsWith("wss://")) {
    url = target;
    console.log(bold(cyan(`
\u26A1 Connecting directly to peer socket at ${cyan(url)}...`)));
  } else if (target.startsWith("http://") || target.startsWith("https://")) {
    try {
      const parsed = new URL(target);
      url = (parsed.protocol === "https:" ? "wss://" : "ws://") + parsed.host;
      channel = parsed.searchParams.get("room") || "default";
      console.log(bold(cyan(`
\u26A1 Joining session via URL ${cyan(target)}...`)));
    } catch {
      channel = target;
    }
  } else {
    channel = target;
  }
  const client = new CrossTalkClient({
    url,
    channel,
    name: options.name,
    role: options.role,
    branch: options.branch,
    environment: "terminal",
    currentTask: `Active in session #${channel}`
  });
  try {
    await client.connect();
    console.log(bold(green(`\u2714 Successfully linked to CrossTalk session [${channel}] on branch [${client["options"]?.branch || "main"}]!`)));
    console.log(gray("Cooperative file locks and peer notifications active.\n"));
    client.on("broadcast", (msg) => {
      if (!client.shouldSuppressAutoReply(msg) && msg.from?.id !== client.agentId) {
        const senderBranch = msg.branch ? ` (${msg.branch})` : "";
        console.log(`\u{1F4E2} ${bold(cyan((msg.from?.name || "Peer") + senderBranch))}: ${msg.content}`);
      }
    });
    client.on("direct_message", (msg) => {
      if (!client.shouldSuppressAutoReply(msg) && msg.from?.id !== client.agentId) {
        const senderBranch = msg.branch ? ` (${msg.branch})` : "";
        console.log(`\u{1F512} ${bold(magenta(`DM from ${(msg.from?.name || "Peer") + senderBranch}`))}: ${msg.content}`);
      }
    });
    client.on("lock_acquired", (lock) => {
      const branchTag = lock.branch ? ` [branch: ${lock.branch}]` : "";
      console.log(`\u{1F512} ${yellow(`LOCK ACQUIRED:`)} [${lock.file}] by ${bold(lock.holderName)}${branchTag} ("${lock.reason}")`);
    });
    client.on("lock_released", (data) => {
      console.log(`\u{1F513} ${green(`LOCK RELEASED:`)} [${data.file}] by ${bold(data.releasedBy)}`);
    });
    const keepalive = setInterval(() => {
    }, 15e3);
    const shutdown = async () => {
      clearInterval(keepalive);
      console.log(yellow("\n[CrossTalk] Disconnecting gracefully..."));
      await client.disconnect("user_exit");
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error(red(`
\u2716 Connection failed: ${err.message}`));
    process.exit(1);
  }
});
program2.command("who").description("List all active agents and file locks on the mesh").option("-u, --url <url>", "Server WebSocket URL", "ws://localhost:4488").action(async (options) => {
  const client = new CrossTalkClient({
    url: options.url,
    name: "CLI-Observer",
    role: "observer",
    environment: "terminal",
    autoHeartbeat: false
  });
  try {
    const state = await client.connect();
    console.log(`
${bold(cyan("=== CrossTalk Active Mesh State ==="))}`);
    console.log(`Channel: ${bold("#" + state.channel)}`);
    console.log(`Dialect: ${bold("XDialect v" + state.dialect.version)}
`);
    console.log(bold("Connected Agents:"));
    if (state.agents.length === 0) {
      console.log(gray("  (No active agents currently connected)"));
    } else {
      state.agents.forEach((a) => {
        const statusColor = a.status === "working" ? green : a.status === "waiting" ? yellow : blue;
        console.log(`  \u{1F916} ${bold(a.name)} (${cyan(a.role)} \xB7 ${gray(a.environment)})`);
        console.log(`     ID:       ${gray(a.id)}`);
        console.log(`     Status:   ${statusColor(a.status.toUpperCase())}`);
        console.log(`     Task:     ${a.currentTask}`);
        if (a.lockedFiles && a.lockedFiles.length > 0) {
          console.log(`     Locks:    ${yellow(a.lockedFiles.join(", "))}`);
        }
        console.log("");
      });
    }
    console.log(bold("Active File Claims:"));
    if (state.locks.length === 0) {
      console.log(gray("  (No files currently locked)"));
    } else {
      const now = Date.now();
      state.locks.forEach((l) => {
        const rem = Math.max(0, Math.round((l.expiresAt - now) / 1e3));
        console.log(`  \u{1F512} ${yellow(l.file)}`);
        console.log(`     Holder:   ${bold(l.holderName)} (${gray(l.holderId)})`);
        console.log(`     Reason:   "${l.reason}"`);
        console.log(`     Expires:  ${rem}s remaining
`);
      });
    }
    client.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(red(`Failed to connect to CrossTalk mesh: ${err.message}`));
    process.exit(1);
  }
});
program2.command("dict").description("Print the active versioned XDialect token dictionary for agent shorthand").action(() => {
  console.log(`
${bold(cyan(`\u{1F4D6} XDialect Dictionary (v${DIALECT_V1.version}))`))}`);
  console.log(gray(`Checksum: ${DIALECT_V1.checksum} | Updated: ${DIALECT_V1.updatedAt}
`));
  console.log(bold("Token Catalog:"));
  console.log(`${gray("Code".padEnd(10))} ${gray("ID".padEnd(8))} ${gray("Category".padEnd(12))} ${gray("Meaning")}`);
  console.log(gray("\u2500".repeat(70)));
  Object.values(DIALECT_V1.tokens).forEach((tok) => {
    const codeStr = tok.code.startsWith("!") ? green(tok.code.padEnd(10)) : tok.code.startsWith("#") ? cyan(tok.code.padEnd(10)) : tok.code.startsWith("&") ? yellow(tok.code.padEnd(10)) : magenta(tok.code.padEnd(10));
    const idStr = ("0x" + tok.numericId.toString(16)).padEnd(8);
    console.log(`${codeStr} ${gray(idStr)} ${tok.category.padEnd(12)} ${tok.meaning}`);
  });
  console.log(`
${bold("Grammar Format:")} ${yellow(DIALECT_V1.grammar.format)}
`);
  console.log(bold("Examples:"));
  DIALECT_V1.grammar.examples.forEach((ex) => {
    console.log(`  ${green(ex.shorthand)}`);
    console.log(`  \u2514\u2500> ${gray(ex.human)}
`);
  });
});
program2.command("short <expression>").description("Send an ultra-concise XDialect shorthand message to the mesh").option("-n, --name <name>", "Agent display name", "Terminal-Agent").option("-u, --url <url>", "Server WebSocket URL", "ws://localhost:4488").action(async (expression, options) => {
  const parsed = DialectEngine.parse(expression);
  const human = DialectEngine.toHuman(parsed);
  const bits = DialectEngine.packToBits(parsed);
  const client = new CrossTalkClient({
    url: options.url,
    name: options.name,
    role: "developer",
    environment: "terminal"
  });
  try {
    await client.connect();
    client.sendShorthand(expression);
    console.log(`
${green("\u2714 XDialect Message Dispatched!")}`);
    console.log(`  Shorthand: ${bold(cyan(expression))}`);
    console.log(`  Wire Size: ${yellow(bits.length + " bytes")} (vs ~${Buffer.byteLength(human)} bytes in English)`);
    console.log(`  English:   "${gray(human)}"
`);
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 500);
  } catch (err) {
    console.error(red(`Dispatch failed: ${err.message}`));
    process.exit(1);
  }
});
program2.command("to-human <shorthand>").description("Translate shorthand expression to natural human English").action((shorthand) => {
  const parsed = DialectEngine.parse(shorthand);
  const human = DialectEngine.toHuman(parsed);
  const bits = DialectEngine.packToBits(parsed);
  console.log(`
Shorthand: ${bold(cyan(shorthand))}`);
  console.log(`Bits:      ${yellow(bits.length + " bytes")}`);
  console.log(`English:   ${green(human)}
`);
});
program2.command("to-zh <shorthand>").description("Expand concise XDialect shorthand to natural Chinese (\u4E2D\u6587\u5C55\u5F00)").action((shorthand) => {
  const zh = DialectEngine.toChinese(shorthand);
  const bits = DialectEngine.packToBits(shorthand);
  console.log(`
Shorthand: ${bold(cyan(shorthand))}`);
  console.log(`Bits:      ${yellow(bits.length + " bytes")}`);
  console.log(`\u4E2D\u6587\u7FFB\u8BD1:  ${green(zh)}
`);
});
program2.command("to-short <english>").description("Compile natural human English sentence to concise XDialect shorthand").action((english) => {
  const shorthand = DialectEngine.fromHuman(english);
  const bits = DialectEngine.packToBits(shorthand);
  console.log(`
English:   ${gray(english)}`);
  console.log(`Shorthand: ${bold(cyan(shorthand))}`);
  console.log(`Bits:      ${yellow(bits.length + " bytes")}
`);
});
program2.command("broadcast <message>").alias("msg").description("Broadcast an announcement or status to all agents on the mesh").option("-n, --name <name>", "Agent display name", "Terminal-Agent").option("-u, --url <url>", "Server WebSocket URL", "ws://localhost:4488").action(async (message, options) => {
  const client = new CrossTalkClient({
    url: options.url,
    name: options.name,
    role: "developer",
    environment: "terminal"
  });
  try {
    await client.connect();
    client.broadcast(message);
    console.log(`${green("\u2714")} Broadcast sent: "${cyan(message)}"`);
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 500);
  } catch (err) {
    console.error(red(`Broadcast failed: ${err.message}`));
    process.exit(1);
  }
});
program2.command("lock <file>").description("Acquire an exclusive lock on a file with reason").option("-r, --reason <reason>", "Reason for editing", "Refactoring file").option("-t, --ttl <seconds>", "Time to hold lock in seconds", "300").option("-n, --name <name>", "Agent display name", "Terminal-Agent").option("-u, --url <url>", "Server WebSocket URL", "ws://localhost:4488").action(async (file, options) => {
  const client = new CrossTalkClient({
    url: options.url,
    name: options.name,
    role: "developer",
    environment: "terminal"
  });
  try {
    await client.connect();
    const ttl = parseInt(options.ttl, 10);
    const res = await client.lockFile(file, options.reason, ttl);
    if (res.success) {
      console.log(`${green("\u2714 Lock Acquired!")}`);
      console.log(`  File:    ${yellow(file)}`);
      console.log(`  Holder:  ${bold(options.name)}`);
      console.log(`  Reason:  "${options.reason}"`);
      console.log(`  TTL:     ${ttl}s`);
    } else {
      console.log(`${red("\u2716 Lock DENIED \u2014 File is currently held by another agent!")}`);
      console.log(`  File:    ${yellow(file)}`);
      console.log(`  Holder:  ${bold(res.holder?.name || "Unknown")} (${gray(res.holder?.id || "")})`);
      console.log(`  Reason:  "${res.reason}"`);
      console.log(`  Expires: ${res.expiresAt ? Math.round((res.expiresAt - Date.now()) / 1e3) + "s" : "active"}`);
    }
    setTimeout(() => {
      client.disconnect();
      process.exit(res.success ? 0 : 2);
    }, 500);
  } catch (err) {
    console.error(red(`Lock request failed: ${err.message}`));
    process.exit(1);
  }
});
program2.command("unlock <file>").description("Release a previously claimed file lock").option("-n, --name <name>", "Agent display name", "Terminal-Agent").option("-u, --url <url>", "Server WebSocket URL", "ws://localhost:4488").action(async (file, options) => {
  const client = new CrossTalkClient({
    url: options.url,
    name: options.name,
    role: "developer",
    environment: "terminal"
  });
  try {
    await client.connect();
    client.unlockFile(file);
    console.log(`${green("\u2714")} Sent release request for file: ${yellow(file)}`);
    setTimeout(() => {
      client.disconnect();
      process.exit(0);
    }, 500);
  } catch (err) {
    console.error(red(`Unlock failed: ${err.message}`));
    process.exit(1);
  }
});
program2.command("tail").description("Stream live messages, locks, and events from the mesh in real time").option("-u, --url <url>", "Server WebSocket URL", "ws://localhost:4488").action(async (options) => {
  const client = new CrossTalkClient({
    url: options.url,
    name: "Stream-Watcher",
    role: "watcher",
    environment: "terminal"
  });
  try {
    await client.connect();
    console.log(bold(cyan("\n\u{1F4E1} Streaming CrossTalk Mesh Events (Press Ctrl+C to exit)...\n")));
    client.on("broadcast", (msg) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      if (msg.type === "dialect_shorthand" && msg.shorthand) {
        console.log(`${gray(`[${time}]`)} \u26A1 ${bold(magenta(`XDialect`))} from ${bold(cyan(msg.from?.name || "Agent"))}:`);
        console.log(`     Shorthand: ${yellow(msg.shorthand.raw)} (${msg.shorthand.bitSize} bytes)`);
        console.log(`     English:   "${gray(msg.shorthand.human)}"`);
      } else {
        console.log(`${gray(`[${time}]`)} \u{1F4E2} ${bold(cyan(msg.from?.name || "System"))}: ${msg.content}`);
      }
    });
    client.on("direct_message", (msg) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      console.log(`${gray(`[${time}]`)} \u{1F512} ${bold(magenta(`DM from ${msg.from?.name}`))}: ${msg.content}`);
    });
    client.on("lock_acquired", (lock) => {
      console.log(`\u{1F512} ${yellow(`LOCK ACQUIRED:`)} [${lock.file}] by ${bold(lock.holderName)} ("${lock.reason}")`);
    });
    client.on("lock_released", (data) => {
      console.log(`\u{1F513} ${green(`LOCK RELEASED:`)} [${data.file}] by ${bold(data.releasedBy)}`);
    });
    client.on("lock_conflict_warning", (warn) => {
      console.log(`\u{1F6A8} ${red(`CONFLICT ALERT:`)} Agent ${bold(warn.requester.name)} tried to touch [${warn.file}] held by ${bold(warn.holder.name)}!`);
    });
    client.on("agent_joined", (agent) => {
      console.log(`\u2795 ${green(`AGENT JOINED:`)} ${bold(agent.name)} (${agent.role} \xB7 ${agent.environment})`);
    });
    client.on("agent_left", (agent) => {
      console.log(`\u2796 ${gray(`AGENT LEFT:`)} ${bold(agent.name)}`);
    });
  } catch (err) {
    console.error(red(`Streaming failed: ${err.message}`));
    process.exit(1);
  }
});
program2.command("install").description("Install this standalone CrossTalk CLI to system PATH (works 100% offline from a single file)").option("-d, --dir <directory>", "Destination directory (defaults to /usr/local/bin or ~/.local/bin)").option("-n, --name <name>", "Command binary name", "crosstalk").action(async (options) => {
  const fs2 = await import("node:fs");
  const path3 = await import("node:path");
  const os = await import("node:os");
  const binName = options.name || "crosstalk";
  let targetDir = options.dir;
  if (!targetDir) {
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (isRoot) {
      targetDir = "/usr/local/bin";
    } else {
      try {
        fs2.accessSync("/usr/local/bin", fs2.constants.W_OK);
        targetDir = "/usr/local/bin";
      } catch {
        targetDir = path3.join(os.homedir(), ".local", "bin");
      }
    }
  }
  try {
    if (!fs2.existsSync(targetDir)) {
      fs2.mkdirSync(targetDir, { recursive: true });
    }
    const sourceFile = process.argv[1];
    const targetFile = path3.join(targetDir, binName);
    fs2.copyFileSync(sourceFile, targetFile);
    fs2.chmodSync(targetFile, 493);
    console.log(bold(green(`
\u2714 CrossTalk v1.0.0 successfully installed to ${targetFile}!`)));
    console.log(cyan(`\u2714 Air-gapped offline installation complete without internet connection.`));
    const pathEnv = process.env.PATH || "";
    if (!pathEnv.includes(targetDir)) {
      console.log(yellow(`
\u26A0\uFE0F  Notice: ${targetDir} is not currently in your system PATH.`));
      console.log(`Add it to your shell profile by running:`);
      console.log(bold(`  echo 'export PATH="${targetDir}:$PATH"' >> ~/.bashrc (or ~/.zshrc)`));
      console.log(`  source ~/.bashrc
`);
    } else {
      console.log(green(`\u2714 Directory is in your PATH. You can immediately run:`));
      console.log(bold(`  ${binName} who`));
      console.log(bold(`  ${binName} up`));
      console.log(bold(`  ${binName} serve`));
      console.log(bold(`  ${binName} dict
`));
    }
  } catch (err) {
    console.error(bold(red(`
\u2716 Installation failed: ${err.message}`)));
    console.log(`Try running with sudo if installing to /usr/local/bin: sudo node ${process.argv[1]} install
`);
  }
});
program2.parse(process.argv);
