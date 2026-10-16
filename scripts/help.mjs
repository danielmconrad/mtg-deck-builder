// Help text generated from the CLI's command table, so options are documented where they are defined.

const HELP_OPTION = { type: 'boolean', short: 'h', description: 'Show this help' };
const COLUMN_GAP = 2;

function table(rows) {
  const width = Math.max(...rows.map(([label]) => label.length)) + COLUMN_GAP;
  return rows.map(([label, text]) => `  ${label.padEnd(width)}${text}`);
}

function optionLabel(name, { type, short, multiple, placeholder }) {
  const flag = short ? `-${short}, --${name}` : `--${name}`;
  const value = type === 'string' ? ` ${placeholder ?? 'VALUE'}` : '';
  return `${flag}${value}${multiple ? ' (repeatable)' : ''}`;
}

export const withHelpOption = (options = {}) => ({ ...options, help: HELP_OPTION });

// Node's parseArgs accepts only its own keys, so documentation fields are stripped.
export const parseArgsOptions = (options) =>
  Object.fromEntries(
    Object.entries(options).map(([name, { type, short, multiple }]) => [
      name,
      { type, multiple: Boolean(multiple), ...(short ? { short } : {}) },
    ]),
  );

export function commandUsage(name, command) {
  const slug = command.takesSlug ? ' <deck-slug>' : '';
  return `Usage: mise run ${name} --${slug} [options]`;
}

export function commandHelp(name, command) {
  const options = withHelpOption(command.options);
  return [
    commandUsage(name, command),
    '',
    command.summary,
    ...(command.details ? ['', command.details] : []),
    '',
    'Options:',
    ...table(Object.entries(options).map(([option, spec]) => [optionLabel(option, spec), spec.description])),
  ].join('\n');
}

export function overviewHelp(commands) {
  return [
    'Usage: mise run <command> -- [arguments]',
    '       node scripts/cli.mjs <command> [arguments]',
    '',
    'Commands:',
    ...table(Object.entries(commands).map(([name, command]) => [name, command.summary])),
    '',
    'Run any command with --help for its options, e.g. mise run deck:export -- --help',
    'Exit codes: 0 pass, 1 failed check or invalid input, 2 incomplete (unknown cards, data or prices).',
  ].join('\n');
}
