import test from 'node:test';
import assert from 'node:assert/strict';
import { deckCollectionText, planBuild, removeCsvCopies, removeTextCopies } from '../scripts/build.mjs';
import { parseTextCollection, resolveTextRows } from '../scripts/collection.mjs';
import { card, entry, forest, indexOf, row } from './fixtures.mjs';
import * as fixtures from './fixtures.mjs';

// The shared fixtures are all printing TST 1, which text lists can't tell apart.
const leader = { ...fixtures.leader, collectorNumber: '2' };
const spell = { ...fixtures.spell, collectorNumber: '3' };
const spellReprint = card('Example Spell', { id: 'example-spell-reprint', set: 'rpt', collectorNumber: '7' });
const index = indexOf(forest, leader, spell, spellReprint);
const deck = (fields = {}) => ({
  format: 'standard-brawl',
  unlimited_basics: false,
  commanders: [entry(leader.name)],
  mainboard: [entry(spell.name, 4), entry(forest.name, 55)],
  ...fields,
});
const sourceRow = (value, quantity, extra = {}) => ({ ...row(value, quantity), finish: 'normal', ...extra });
const takenSummary = ({ takes }) => takes.map(({ row: taken, quantity }) => [taken.scryfallId, quantity]);

test('planBuild takes the pinned printing, then the one with most copies, and never proxies', () => {
  const collections = {
    available: [
      sourceRow(leader, 1),
      sourceRow(spell, 1, { position: 0 }),
      sourceRow(spellReprint, 1, { isProxy: true }),
      sourceRow(spellReprint, 3, { position: 1 }),
      sourceRow(spell, 1, { position: 2 }),
      sourceRow(forest, 60),
    ],
  };
  const plan = planBuild(deck(), collections, index);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(takenSummary(plan), [
    [leader.id, 1],
    [spellReprint.id, 3],
    [spell.id, 1],
    [forest.id, 55],
  ]);
  assert.equal(plan.takes[0].isCommander, true);
  const pinned = deck({ mainboard: [entry(spell.name, 4, { scryfall_id: spell.id }), entry(forest.name, 55)] });
  assert.deepEqual(takenSummary(planBuild(pinned, collections, index)).slice(1, 4), [
    [spell.id, 1],
    [spell.id, 1],
    [spellReprint.id, 2],
  ]);
});

test('planBuild takes nonfoil copies before foil ones, unless a foil printing is pinned', () => {
  const collections = {
    available: [
      sourceRow(leader, 1),
      sourceRow(spellReprint, 3, { finish: 'foil' }),
      sourceRow(spell, 2),
      sourceRow(spell, 1, { finish: 'etched' }),
      sourceRow(forest, 60),
    ],
  };
  assert.deepEqual(takenSummary(planBuild(deck(), collections, index)).slice(1, 4), [
    [spell.id, 2],
    [spellReprint.id, 2],
    [forest.id, 55],
  ]);
  const pinned = deck({ mainboard: [entry(spell.name, 4, { scryfall_id: spellReprint.id }), entry(forest.name, 55)] });
  assert.deepEqual(takenSummary(planBuild(pinned, collections, index)).slice(1, 3), [
    [spellReprint.id, 3],
    [spell.id, 1],
  ]);
});

test('planBuild reports shortfalls, and fills basics from untracked ones only with unlimited_basics', () => {
  const collections = { available: [sourceRow(leader, 1), sourceRow(spell, 4), sourceRow(forest, 50)] };
  assert.deepEqual(planBuild(deck(), collections, index).problems, ['Forest: need 55, 50 non-proxy copies available']);
  const plan = planBuild(deck({ unlimited_basics: true }), collections, index);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.untracked.map(({ card: basic, quantity }) => [basic.name, quantity]),
    [['Forest', 5]],
  );
});

test("deckCollectionText lists the deck's cards so they read back as a collection", () => {
  const plan = {
    takes: [
      { row: { finish: 'normal' }, card: leader, quantity: 1, isCommander: true },
      { row: { finish: 'foil' }, card: spell, quantity: 1 },
      { row: { finish: 'foil' }, card: spell, quantity: 1 },
      { row: { finish: 'normal' }, card: forest, quantity: 50 },
    ],
    untracked: [{ card: forest, quantity: 6 }],
  };
  const text = deckCollectionText(plan, 'Fixture: built by deck:build');
  assert.equal(
    text,
    '// Fixture: built by deck:build\nCommander\n1 Example Leader (TST) 2\n\nDeck\n2 Example Spell (TST) 3 *F*\n50 Forest (TST) 1\n6 Forest\n',
  );
  const rows = resolveTextRows(parseTextCollection(text), index);
  assert.equal(
    rows.reduce((total, { quantity }) => total + quantity, 0),
    59,
  );
  assert.ok(rows.every((parsed) => parsed.scryfallId));
});

test('removeCsvCopies rewrites only the records it takes from, keeping line breaks and quoting', () => {
  const csv = '﻿Name,Quantity\r\nA,2\r\n"B, the Second",1\r\n\r\n"C ""Quoted""",3\r\nD,1';
  assert.equal(removeCsvCopies(csv, new Map()), csv);
  assert.equal(
    removeCsvCopies(
      csv,
      new Map([
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
    ),
    '﻿Name,Quantity\r\nA,1\r\n\r\n"C ""Quoted""",2\r\n',
  );
  assert.equal(removeCsvCopies('Name,Quantity\nA,1\n', new Map([[0, 1]])), null);
  assert.throws(() => removeCsvCopies(csv, new Map([[1, 2]])), /record 3: cannot take more copies than its 1/);
});

test('removeTextCopies lowers or drops card lines and keeps headings and comments', () => {
  const list = '﻿Commander\n1 Example Leader (TST) 1\n\n// spares\nDeck\n4x Forest (TST) 1 [Land]\n2 Example Spell\n';
  assert.equal(
    removeTextCopies(
      list,
      new Map([
        [1, 1],
        [5, 3],
      ]),
    ),
    '﻿Commander\n\n// spares\nDeck\n1x Forest (TST) 1 [Land]\n2 Example Spell\n',
  );
  const everything = new Map([
    [1, 1],
    [5, 4],
    [6, 2],
  ]);
  assert.equal(removeTextCopies(list, everything), null);
  assert.throws(() => removeTextCopies(list, new Map([[6, 3]])), /line 7: cannot take more copies than its 2/);
});
