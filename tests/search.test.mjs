import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdentity, searchCollection } from '../scripts/search.mjs';
import { deckStats } from '../scripts/stats.mjs';
import { card, entry, forest, indexOf, leader, row, spell } from './fixtures.mjs';

const elf = card('Llanowar Elves', { type_line: 'Creature — Elf Druid', mana_cost: '{G}', cmc: 1, color_identity: ['G'], oracle_text: '{T}: Add {G}.' });
const ghoul = card('Grave Ghoul', { type_line: 'Creature — Zombie', mana_cost: '{3}{B}', cmc: 4, color_identity: ['B'], oracle_text: 'Return a creature card from your graveyard.' });
const banned = card('Banned Thing', { type_line: 'Artifact', cmc: 1, legalities: { commander: 'banned' } });
const index = indexOf(forest, leader, spell, elf, ghoul, banned);
const collections = { organized: [row(elf, 2), row(ghoul, 1), row(banned, 1), row(spell, 1)], precons: [row(elf, 3), row(leader, 1)] };
const names = (filters) => searchCollection(collections, index, filters).results.map(({ card: value }) => value.name);

test('search filters by identity, type, text, mana value and legality', () => {
  assert.deepEqual(names({}), ['Banned Thing', 'Llanowar Elves', 'Example Spell', 'Grave Ghoul']);
  assert.deepEqual(names({ identity: parseIdentity('G') }), ['Banned Thing', 'Llanowar Elves', 'Example Spell']);
  assert.deepEqual(names({ identity: parseIdentity('C') }), ['Banned Thing']);
  assert.deepEqual(names({ type: [/creature/i] }), ['Llanowar Elves', 'Grave Ghoul']);
  assert.deepEqual(names({ type: [/creature/i], text: [/graveyard/i] }), ['Grave Ghoul']);
  assert.deepEqual(names({ minMv: 2, maxMv: 3 }), ['Example Spell']);
  assert.deepEqual(names({ legal: 'commander', maxMv: 1 }), ['Llanowar Elves']);
  assert.throws(() => parseIdentity('GX'), /must use/);
});

test('search reports protected precon copies and only lists precon-only cards on request', () => {
  const { results } = searchCollection(collections, index, { name: /elves/i });
  assert.deepEqual(results.map(({ organized, precons }) => [organized, precons]), [[2, 3]]);
  assert.ok(!names({}).includes(leader.name));
  assert.ok(names({ precons: true }).includes(leader.name));
});

test('deck stats summarize curve, types, pips, land sources and roles for the mainboard', () => {
  const value = {
    commanders: [entry(leader.name)],
    mainboard: [entry(forest.name, 30, { role: 'land' }), entry(elf.name, 1, { role: 'ramp, creature' }), entry(ghoul.name, 2), entry('Unknown Card')],
  };
  const stats = deckStats(value, index);
  assert.equal(stats.cards, 33);
  assert.equal(stats.lands, 30);
  assert.equal(stats.nonlandManaValue, 9);
  assert.deepEqual([...stats.curve], [[1, 1], [4, 2]]);
  assert.deepEqual(Object.fromEntries(stats.pips), { G: 1, B: 2 });
  assert.deepEqual(Object.fromEntries(stats.landSources), { G: 30 });
  assert.deepEqual(Object.fromEntries(stats.roles), { land: 30, ramp: 1, creature: 1 });
  assert.match(stats.problems.join(), /Unknown Card/);
});
