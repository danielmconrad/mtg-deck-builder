import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdentity, searchCollection, searchFilters } from '../scripts/search.mjs';
import { deckStats } from '../scripts/stats.mjs';
import { card, entry, forest, indexOf, leader, row, spell } from './fixtures.mjs';

const elf = card('Llanowar Elves', {
  typeLine: 'Creature — Elf Druid',
  manaCost: '{G}',
  manaValue: 1,
  colorIdentity: ['G'],
  oracleText: '{T}: Add {G}.',
});
const ghoul = card('Grave Ghoul', {
  typeLine: 'Creature — Zombie',
  manaCost: '{3}{B}',
  manaValue: 4,
  colorIdentity: ['B'],
  oracleText: 'Return a creature card from your graveyard.',
});
const banned = card('Banned Thing', { typeLine: 'Artifact', manaValue: 1, legalities: { commander: 'banned' } });
const index = indexOf(forest, leader, spell, elf, ghoul, banned);
const collections = {
  organized: [row(elf, 2), row(ghoul, 1), row(banned, 1), row(spell, 1)],
  precons: [row(elf, 3), row(leader, 1)],
};
const namesFor = (options) =>
  searchCollection(collections, index, searchFilters(options, index)).results.map((result) => result.card.name);

test('results are sorted by mana value, then name', () => {
  assert.deepEqual(namesFor({}), ['Banned Thing', 'Llanowar Elves', 'Example Spell', 'Grave Ghoul']);
});

test('--identity limits results to a color identity, with C meaning colorless only', () => {
  assert.deepEqual(namesFor({ identity: 'g' }), ['Banned Thing', 'Llanowar Elves', 'Example Spell']);
  assert.deepEqual(namesFor({ identity: 'C' }), ['Banned Thing']);
  assert.throws(() => parseIdentity('GX'), /must use/);
});

test('--type and --text are case-insensitive patterns that must all match', () => {
  assert.deepEqual(namesFor({ type: ['CREATURE'] }), ['Llanowar Elves', 'Grave Ghoul']);
  assert.deepEqual(namesFor({ type: ['creature'], text: ['graveyard'] }), ['Grave Ghoul']);
});

test('mana value bounds are inclusive and must be numbers', () => {
  assert.deepEqual(namesFor({ 'min-mv': '2', 'max-mv': '3' }), ['Example Spell']);
  assert.throws(() => namesFor({ 'max-mv': 'three' }), /--max-mv must be a number/);
});

test('--commander applies the commander color identity and Commander legality', () => {
  assert.deepEqual(namesFor({ commander: 'Example Leader' }), ['Llanowar Elves', 'Example Spell']);
  assert.throws(() => namesFor({ commander: 'Example Leader', identity: 'G' }), /not both/);
  assert.throws(() => namesFor({ commander: 'Nobody' }), /not in card cache/);
});

test('results show protected Precons copies; Precons-only cards need --precons', () => {
  const [elves] = searchCollection(collections, index, searchFilters({ name: 'elves' }, index)).results;
  assert.deepEqual([elves.organized, elves.precons], [2, 3]);
  assert.ok(!namesFor({}).includes(leader.name));
  assert.ok(namesFor({ precons: true }).includes(leader.name));
});

test('deckStats summarizes the mainboard curve, types, pips, land sources and roles', () => {
  const deck = {
    commanders: [entry(leader.name)],
    mainboard: [
      entry(forest.name, 30, { role: 'land' }),
      entry(elf.name, 1, { role: 'ramp, creature' }),
      entry(ghoul.name, 2),
    ],
  };
  const stats = deckStats(deck, index);
  assert.equal(stats.cards, 33);
  assert.equal(stats.lands, 30);
  assert.equal(stats.nonlandManaValue, 9);
  assert.deepEqual(Object.fromEntries(stats.curve), { 1: 1, 4: 2 });
  assert.deepEqual(Object.fromEntries(stats.types), { Creature: 3, Land: 30 });
  assert.deepEqual(Object.fromEntries(stats.pips), { G: 1, B: 2 });
  assert.deepEqual(Object.fromEntries(stats.landSources), { G: 30 });
  assert.deepEqual(Object.fromEntries(stats.roles), { land: 30, ramp: 1, creature: 1 });
});

test('deckStats reports cards it cannot resolve', () => {
  assert.match(
    deckStats({ commanders: [], mainboard: [entry('Unknown Card')] }, index).problems.join(),
    /Unknown Card/,
  );
});
