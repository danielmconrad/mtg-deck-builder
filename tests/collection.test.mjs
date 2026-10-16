import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCopies, holdDeckCards, ownedCounts, parseCollection, summarize } from '../scripts/collection.mjs';
import { forest, indexOf, row, spell } from './fixtures.mjs';

const HEADER = 'Name,Quantity,Scryfall ID,Set code,Collector number,Foil,Proxy';
const SCRYFALL_ID = 'b3988120-ebbe-4d24-9bb4-8c5331a14034';
const csvRow = (quantity = '1') => `"Example, Card // Back",${quantity},${SCRYFALL_ID},TST,001a,normal,false`;

test('parseCollection keeps quoted names, collector strings and repeated rows', () => {
  const rows = parseCollection(`\uFEFF${HEADER}\r\n${csvRow('2')}\r\n${csvRow('3')}\r\n`);
  assert.equal(rows[0].name, 'Example, Card // Back');
  assert.equal(rows[0].collectorNumber, '001a');
  assert.deepEqual(summarize(rows), { rowCount: 2, copies: 5, distinctNames: 1, proxyCopies: 0 });
});

test('parseCollection rejects quantities that are not positive integers', () => {
  for (const quantity of ['0', '-1', '1.5', '', 'Infinity', '9007199254740992']) {
    assert.throws(() => parseCollection(`${HEADER}\n${csvRow(quantity)}`), /Quantity/, quantity);
  }
});

test('parseCollection rejects bad headers, empty exports, IDs and proxy flags', () => {
  assert.throws(() => parseCollection('Name,Quantity\nForest,1'), /missing headers/);
  assert.throws(() => parseCollection(`${HEADER},Name\n${csvRow()},Forest`), /duplicate headers/);
  assert.throws(() => parseCollection(HEADER), /no card rows/);
  assert.throws(() => parseCollection(`${HEADER}\n${csvRow().replace(SCRYFALL_ID, 'bad')}`), /Scryfall ID/);
  assert.throws(() => parseCollection(`${HEADER}\n${csvRow().replace('false', 'maybe')}`), /Proxy/);
});

test('parseCollection reads binder exports without a Proxy column as real cards', () => {
  const rows = parseCollection(
    `Binder Name,Binder Type,Name,Quantity,Scryfall ID,Set code,Collector number,Foil\n` +
      `beholder,deck,Forest,2,${SCRYFALL_ID},TST,001,normal\nall cards,binder,Forest,3,${SCRYFALL_ID},TST,001,normal`,
  );
  assert.deepEqual(
    rows.map(({ isProxy, inDeckBinder }) => ({ isProxy, inDeckBinder })),
    [
      { isProxy: false, inDeckBinder: true },
      { isProxy: false, inDeckBinder: false },
    ],
  );
});

test('holdDeckCards holds every copy of a card named in a deck binder', () => {
  const inDeck = { ...row(forest, 1), inDeckBinder: true };
  const spare = row(forest, 4);
  const free = row(spell, 2);
  assert.deepEqual(holdDeckCards([inDeck, spare, free]), { free: [free], held: [inDeck, spare] });
});

test('ownedCounts merges printings by oracle ID and counts rows missing from the cache', () => {
  const variant = { ...forest, id: 'second-print' };
  const rows = [row(forest, 2), row(variant, 3), { ...row(forest, 1), scryfallId: 'uncached' }];
  assert.deepEqual(ownedCounts(rows, indexOf(forest, variant)), {
    counts: new Map([['forest', 5]]),
    unresolvedRows: 1,
  });
});

test('ownedCounts includes proxy rows only when allowed', () => {
  const rows = [row(forest, 2), row(forest, 4, { isProxy: true })];
  assert.equal(ownedCounts(rows, indexOf(forest)).counts.get('forest'), 2);
  assert.equal(ownedCounts(rows, indexOf(forest), { allowProxies: true }).counts.get('forest'), 6);
});

test('availableCopies treats basics as unlimited only when the deck says so', () => {
  const owned = ownedCounts([row(forest, 5), row(spell, 1)], indexOf(forest, spell));
  assert.equal(availableCopies(owned, forest), 5);
  assert.equal(availableCopies(owned, forest, { unlimitedBasics: true }), Infinity);
  assert.equal(availableCopies(owned, spell, { unlimitedBasics: true }), 1);
});
