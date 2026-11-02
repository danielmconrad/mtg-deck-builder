import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { copyToClipboard } from './clipboard.mjs';
import { commandHelp, overviewHelp, parseArgsOptions, withHelpOption } from './help.mjs';
import { openWorkspace } from './workspace.mjs';
import { COMMANDS } from './commands.mjs';
import { collectionScope, scopedWorkspace, typedOptions } from './options.mjs';

const EXIT_CODES = { pass: 0, fail: 1, incomplete: 2 };

const HELP_FLAGS = ['--help', '-h', 'help'];

function parseCommandLine([name, ...rest]) {
  if (name === undefined || HELP_FLAGS.includes(name)) return { helpText: overviewHelp(COMMANDS) };
  if (!Object.hasOwn(COMMANDS, name)) throw new Error(`Unknown command "${name}".\n\n${overviewHelp(COMMANDS)}`);
  const command = COMMANDS[name];
  const usageError = (message, cause) => new Error(`${message}\n\n${commandHelp(name, command)}`, { cause });
  let parsed;
  try {
    const options = parseArgsOptions(withHelpOption(command.options));
    parsed = parseArgs({ args: rest, options, allowPositionals: true, allowNegative: true, strict: true });
  } catch (error) {
    throw usageError(error.message, error);
  }
  const { help, ...values } = parsed.values;
  if (help) return { helpText: commandHelp(name, command) };
  const options = typedOptions(command.options ?? {}, values);
  const { positionals } = parsed;
  if (command.takesNames) {
    if (!positionals.length) throw usageError(`${name} needs at least one <card-name>`);
    return { name, command, options, names: positionals };
  }
  const expectedPositionals = command.takesSlug ? 1 : 0;
  if (positionals.length !== expectedPositionals) {
    throw usageError(
      command.takesSlug ? `${name} needs exactly one <deck-slug>` : `${name} takes no positional arguments`,
    );
  }
  return { name, command, options, slug: positionals[0] };
}

const OUTPUT_MODES = ['text', 'json'];

// --json or --no-json wins, then the MTG_OUTPUT project default (see .env.example), for commands that
// can print JSON.
function printsJson(command, options, env) {
  if (!Object.hasOwn(command.options ?? {}, 'json')) return false;
  if (options.json !== undefined) return options.json;
  const mode = env.MTG_OUTPUT || 'text';
  if (!OUTPUT_MODES.includes(mode)) throw new Error(`MTG_OUTPUT must be one of: ${OUTPUT_MODES.join(', ')}`);
  return mode === 'json';
}

// Text output writes as it goes. JSON output keeps what commands emit and warn, then prints one line:
// { command, deck, outcome, data, warnings }, or { command, deck, outcome: "fail", error, warnings } if the
// command threw.
function outputFor(json, { write, warn }) {
  if (!json) return { write, warn, emit() {}, finish() {}, fail: null };
  const warnings = [];
  let data = {};
  return {
    write() {},
    warn: (line) => warnings.push(line.trim()),
    emit: (value) => {
      data = { ...data, ...value };
    },
    finish: (header, outcome) => write(JSON.stringify({ ...header, outcome, data, warnings })),
    fail: (header, error) => write(JSON.stringify({ ...header, outcome: 'fail', error: error.message, warnings })),
  };
}

// A date as deck.yaml records it, in local time: "2026-11-02".
const localDate = (time) => new Date(time).toLocaleDateString('en-CA');

// Returns the process exit code: 0 pass, 1 fail, 2 incomplete. Invalid input throws. pause waits between
// Scryfall requests and before retries; tests pass one that returns at once.
export async function runCli(
  args,
  {
    root,
    env = process.env,
    now = Date.now(),
    write = console.log,
    warn = console.error,
    copyText = copyToClipboard,
    pause = setTimeout,
  } = {},
) {
  const { helpText, name, command, options, slug, names } = parseCommandLine(args);
  if (helpText) {
    write(helpText);
    return EXIT_CODES.pass;
  }
  const output = outputFor(printsJson(command, options, env), { write, warn });
  const header = { command: name, ...(slug && { deck: slug }) };
  const workspace = scopedWorkspace(openWorkspace(root), collectionScope(options, env), output.warn);
  const today = localDate(now);
  const context = { workspace, options, slug, names, env, now, today, pause, copyText };
  let outcome;
  try {
    outcome = await command.run({ ...context, write: output.write, warn: output.warn, emit: output.emit });
  } catch (error) {
    if (!output.fail) throw error;
    output.fail(header, error);
    return EXIT_CODES.fail;
  }
  output.finish(header, outcome);
  return EXIT_CODES[outcome];
}

// Project defaults live in an untracked .env; .env.example documents them.
function loadProjectEnv() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    loadProjectEnv();
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = EXIT_CODES.fail;
  }
}
