import test from 'node:test';
import assert from 'node:assert/strict';
import { stringify } from 'yaml';
import { exportDeck, newDeck, parseDeck, removeCopies, resolveEntries } from '../scripts/deck.mjs';
import { entry, forest, indexOf, leader } from './fixtures.mjs';

const deck = (fields = {}) => ({
  schema_version: 1,
  name: 'Fixture',
  format: 'commander',
  status: 'draft',
  allow_proxies: false,
  strategy: 'Test',
  commanders: [entry(leader.name)],
  mainboard: [entry(forest.name, 99)],
  ...fields,
});

test('parseDeck accepts a valid deck, including an empty draft mainboard', () => {
  assert.equal(parseDeck(stringify(deck())).name, 'Fixture');
  assert.deepEqual(parseDeck(stringify(deck({ mainboard: [] }))).mainboard, []);
});

test('parseDeck rejects schema violations', () => {
  const invalidDecks = {
    'unknown key': deck({ typo: true }),
    'no commander': deck({ commanders: [] }),
    'two copies of a commander': deck({ commanders: [entry(leader.name, 2)] }),
    'zero quantity': deck({ mainboard: [entry(forest.name, 0)] }),
    'string boolean': deck({ allow_proxies: 'false' }),
    'casual deck with commanders': deck({ format: 'casual-60' }),
  };
  for (const [label, invalid] of Object.entries(invalidDecks)) {
    assert.throws(() => parseDeck(stringify(invalid)), /deck:/, label);
  }
});

test('parseDeck rejects duplicate YAML keys', () => {
  assert.throws(() => parseDeck('name: First\nname: Second'), /unique/i);
});

test('newDeck builds a schema-valid draft named after the slug', () => {
  const draft = newDeck('green-value', { commanderNames: [leader.name] });
  assert.equal(draft.name, 'Green Value');
  assert.deepEqual(draft.commanders, [entry(leader.name)]);
  assert.deepEqual(draft.mainboard, []);
});

test('newDeck requires a commander for Commander decks only', () => {
  assert.throws(() => newDeck('green-value'), /--commander/);
  assert.equal(newDeck('mono-g', { format: 'casual-60' }).commanders.length, 0);
});

test('exportDeck prints a Commander section followed by the mainboard', () => {
  assert.equal(exportDeck(deck()), 'Commander\n1 Example Leader\n\n99 Forest\n');
});

test('resolveEntries merges printings of one card and records a pinned printing', () => {
  const variant = { ...forest, id: 'second-print' };
  const { tallies, problems } = resolveEntries(
    [entry('Forest', 2), entry('Forest', 3, { scryfall_id: 'second-print' })],
    indexOf(forest, variant),
  );
  assert.deepEqual(problems, []);
  assert.equal(tallies.get('forest').quantity, 5);
  assert.equal(tallies.get('forest').printingId, 'second-print');
});

test('removeCopies refuses to remove more copies than the list holds', () => {
  const { tallies } = resolveEntries([entry('Forest', 2)], indexOf(forest));
  assert.throws(() => removeCopies(tallies, forest, 3), /cannot remove 3; the list has 2/);
});
