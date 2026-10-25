import test from 'node:test';
import assert from 'node:assert/strict';
import { countResults, groupResults, parseIdentity, searchCollection, searchFilters } from '../scripts/search.mjs';
import { deckStats, suggestedLands } from '../scripts/stats.mjs';
import { identityLabel, orderedIdentity } from '../scripts/card.mjs';
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
  available: [row(elf, 2), row(ghoul, 1), row(banned, 1), row(spell, 1)],
  protected: [
    row(elf, 2, { collection: 'precons' }),
    row(elf, 1, { collection: 'Cube' }),
    row(leader, 1, { collection: 'precons' }),
  ],
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

test('results show protected copies by collection; protected-only cards need --include-protected', () => {
  const [elves] = searchCollection(collections, index, searchFilters({ name: 'elves' }, index)).results;
  assert.deepEqual([elves.available, elves.protected], [2, 3]);
  assert.deepEqual(elves.protectedIn, [
    { name: 'precons', copies: 2 },
    { name: 'Cube', copies: 1 },
  ]);
  assert.ok(!namesFor({}).includes(leader.name));
  assert.ok(namesFor({ 'include-protected': true }).includes(leader.name));
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

const background = card('Some Background', { typeLine: 'Legendary Enchantment — Background', colorIdentity: ['W'] });
const planeswalker = card('Lead Walker', {
  typeLine: 'Legendary Planeswalker — Teyo',
  colorIdentity: ['W', 'U'],
  oracleText: 'Lead Walker can be your commander.',
});
const kindred = card('Elf Rite', { typeLine: 'Kindred Instant — Elf', colorIdentity: ['G'] });
const groupIndex = indexOf(leader, elf, ghoul, banned, background, planeswalker, kindred);
const groupCollections = {
  available: [
    row(leader, 1),
    row(elf, 2),
    row(ghoul, 1),
    row(banned, 1),
    row(background, 1),
    row(planeswalker, 1),
    row(kindred, 3),
  ],
  protected: [],
};
const search = (options) => searchCollection(groupCollections, groupIndex, searchFilters(options, groupIndex)).results;

test('--commanders keeps legendary creatures, Backgrounds and "can be your commander" cards', () => {
  assert.deepEqual(
    search({ commanders: true }).map((result) => result.card.name),
    ['Lead Walker', 'Some Background', 'Example Leader'],
  );
});

test('countResults counts distinct cards and available copies', () => {
  assert.deepEqual(countResults(search({ type: ['creature'] })), { cards: 3, copies: 4 });
});

test('grouping by identity uses WUBRG order and C for colorless', () => {
  assert.deepEqual(groupResults(search({}), 'identity'), [
    { key: 'G', cards: 3, copies: 6 },
    { key: 'B', cards: 1, copies: 1 },
    { key: 'C', cards: 1, copies: 1 },
    { key: 'W', cards: 1, copies: 1 },
    { key: 'WU', cards: 1, copies: 1 },
  ]);
});

test('grouping by creature type counts each card once per type, including Kindred', () => {
  assert.deepEqual(
    groupResults(search({}), 'creature-type').map(({ key, cards }) => [key, cards]),
    [
      ['Elf', 3],
      ['Druid', 1],
      ['Zombie', 1],
    ],
  );
});

test('unknown --group-by keys are rejected with the valid choices', () => {
  assert.throws(() => groupResults([], 'rarity'), /identity, creature-type/);
});

test('--nonland drops lands', () => {
  const land = card('Some Land', { typeLine: 'Land', oracleText: '{T}: Add {C}.' });
  const index = indexOf(land, elf);
  const owned = { available: [row(land, 1), row(elf, 1)], protected: [] };
  const names = (options) =>
    searchCollection(owned, index, searchFilters(options, index)).results.map((result) => result.card.name);
  assert.deepEqual(names({ text: ['add \\{'] }), ['Some Land', 'Llanowar Elves']);
  assert.deepEqual(names({ text: ['add \\{'], nonland: true }), ['Llanowar Elves']);
});

test('identity helpers order colors WUBRG regardless of Scryfall order', () => {
  const golgari = card('Golgari Card', { colorIdentity: ['G', 'B'] });
  assert.deepEqual(orderedIdentity(golgari), ['B', 'G']);
  assert.equal(identityLabel(golgari), 'BG');
  assert.equal(identityLabel(card('Colorless Card')), 'C');
});

test('--game-changers keeps only Game Changers', () => {
  const study = card('Study Card', { gameChanger: true });
  const index = indexOf(study, elf);
  const owned = { available: [row(study, 1), row(elf, 1)], protected: [] };
  const { results } = searchCollection(owned, index, searchFilters({ 'game-changers': true }, index));
  assert.deepEqual(
    results.map((result) => result.card.name),
    ['Study Card'],
  );
});

test("suggestedLands matches Karsten's worked examples", () => {
  const commander = (averageManaValue, cheapRampAndDraw) =>
    suggestedLands({ format: 'commander', commanderCount: 1, averageManaValue, cheapRampAndDraw });
  assert.equal(commander(3.51, 13).toFixed(1), '38.8');
  assert.equal(commander(3.0, 10).toFixed(1), '38.0');
  const casual = suggestedLands({ format: 'casual-60', commanderCount: 0, averageManaValue: 2.5, cheapRampAndDraw: 4 });
  assert.equal(casual.toFixed(2), '23.22');
  const sixty = suggestedLands({
    format: 'commander-60',
    commanderCount: 1,
    averageManaValue: 3,
    cheapRampAndDraw: 10,
  });
  assert.equal(sixty.toFixed(2), ((59 / 60) * (19.59 + 5.7 + 0.27) - 2.8 - 1.35).toFixed(2));
});

test('deckStats counts cheap ramp and draw by role and mana value, then suggests lands', () => {
  const signet = card('Cheap Rock', { typeLine: 'Artifact', manaValue: 2, manaCost: '{2}' });
  const bigDraw = card('Big Draw', { manaValue: 5, manaCost: '{4}{U}' });
  const index = indexOf(forest, signet, bigDraw, elf);
  const deck = {
    format: 'commander',
    commanders: [entry(leader.name)],
    mainboard: [
      entry(forest.name, 37, { role: 'land' }),
      entry(signet.name, 1, { role: 'ramp' }),
      entry(elf.name, 1, { role: 'ramp, synergy' }),
      entry(bigDraw.name, 1, { role: 'draw' }),
    ],
  };
  const stats = deckStats(deck, index);
  assert.equal(stats.cheapRampAndDraw, 2);
  assert.equal(stats.averageManaValue.toFixed(2), '2.67');
  assert.equal(
    stats.suggestedLands.toFixed(2),
    suggestedLands({ format: 'commander', commanderCount: 1, averageManaValue: 8 / 3, cheapRampAndDraw: 2 }).toFixed(2),
  );
});
