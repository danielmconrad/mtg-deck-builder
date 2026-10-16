import test from 'node:test';
import assert from 'node:assert/strict';
import { commandHelp, parseArgsOptions, withHelpOption } from '../scripts/help.mjs';

const command = {
  takesSlug: true,
  summary: 'Do a thing',
  options: { tag: { type: 'string', multiple: true, placeholder: 'TAG', description: 'Add a tag' } },
};

test('every command gets a documented -h/--help option', () => {
  assert.deepEqual(Object.keys(withHelpOption(command.options)), ['tag', 'help']);
  assert.deepEqual(Object.keys(withHelpOption()), ['help']);
});

test('parseArgs receives only the keys it understands', () => {
  assert.deepEqual(parseArgsOptions(withHelpOption(command.options)), {
    tag: { type: 'string', multiple: true },
    help: { type: 'boolean', multiple: false, short: 'h' },
  });
});

test('command help shows usage, summary and aligned option descriptions', () => {
  assert.equal(
    commandHelp('thing:do', command),
    [
      'Usage: mise run thing:do -- <deck-slug> [options]',
      '',
      'Do a thing',
      '',
      'Options:',
      '  --tag TAG (repeatable)  Add a tag',
      '  -h, --help              Show this help',
    ].join('\n'),
  );
});
