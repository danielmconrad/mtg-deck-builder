import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import schema from '../schemas/deck.schema.json' with { type: 'json' };
import { COMMANDS } from '../scripts/commands.mjs';
import { ROLE_VOCABULARY } from '../scripts/deck.mjs';
import { BRACKETS, CURRENCIES, FORMAT_NAMES, isCommanderFormat } from '../scripts/formats.mjs';

// The schema is static JSON, so these keep its enums in step with the code that defines them.
test('the deck schema lists the same formats, roles, brackets and currencies as the code', () => {
  const { properties, allOf, definitions } = schema;
  assert.deepEqual(properties.format.enum, FORMAT_NAMES);
  assert.deepEqual(allOf[0].if.properties.format.enum, FORMAT_NAMES.filter(isCommanderFormat));
  assert.deepEqual(properties.role_targets.propertyNames.enum, ROLE_VOCABULARY);
  for (const field of ['target_bracket', 'plays_like_bracket', 'lowest_legal_bracket']) {
    assert.deepEqual(properties[field].enum, BRACKETS, field);
  }
  assert.deepEqual(definitions.money.properties.currency.enum, CURRENCIES);
});

// Each CLI command needs a mise task that runs it, and each task named like a command must run that one.
test('every CLI command has a mise task that runs it, and no task runs a missing command', async () => {
  const toml = await readFile(new URL('../mise.toml', import.meta.url), 'utf8');
  const blocks = toml.split(/^(?=\[)/m).map((block) => [block.match(/^\[tasks\."([^"]+)"\]/)?.[1], block]);
  const tasks = new Map(
    blocks
      .map(([task, block]) => [task, block.match(/^run = "node scripts\/cli\.mjs ([^ "]+)/m)?.[1]])
      .filter(([task, command]) => task && command),
  );
  for (const [task, command] of tasks) assert.equal(task, command, `task ${task} runs ${command}`);
  assert.deepEqual([...tasks.keys()].sort(), Object.keys(COMMANDS).sort());
});
