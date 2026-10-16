import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedCounts, parseCollection, summarize } from '../scripts/collection.mjs';
import { forest, indexOf, row } from './fixtures.mjs';

const header = 'Name,Quantity,Scryfall ID,Set code,Collector number,Foil,Proxy';
const identifier = 'b3988120-ebbe-4d24-9bb4-8c5331a14034';
const csvRow = (quantity = '1') => `"Example, Card // Back",${quantity},${identifier},TST,001a,normal,false`;

test('CSV quoting, double-faced names, collector strings and repeated rows are preserved', () => {
  const rows = parseCollection(`﻿${header}\r\n${csvRow('2')}\r\n${csvRow('3')}\r\n`);
  assert.equal(rows[0].name, 'Example, Card // Back');
  assert.equal(rows[0].collectorNumber, '001a');
  assert.deepEqual(summarize(rows), { rows: 2, copies: 5, names: 1, proxyCopies: 0 });
});

test('invalid quantities are rejected rather than silently coerced', () => {
  for (const quantity of ['0', '-1', '1.5', '', 'Infinity', '9007199254740992']) {
    assert.throws(() => parseCollection(`${header}\n${csvRow(quantity)}`), /Quantity/);
  }
});

test('missing and duplicate headers, empty exports, IDs and proxy flags fail clearly', () => {
  assert.throws(() => parseCollection('Name,Quantity\nForest,1'), /missing headers/);
  assert.throws(() => parseCollection(`${header},Name\n${csvRow()},Forest`), /duplicate headers/);
  assert.throws(() => parseCollection(header), /no card rows/);
  assert.throws(() => parseCollection(`${header}\n${csvRow().replace(identifier, 'bad')}`), /Scryfall ID/);
  assert.throws(() => parseCollection(`${header}\n${csvRow().replace('false', 'maybe')}`), /Proxy/);
});

test('owned counts merge printings by oracle ID, honor proxy policy and count uncached rows', () => {
  const variant = { ...forest, id: 'second-print' };
  const index = indexOf(forest, variant);
  const rows = [row(forest, 2), row(variant, 3), row(forest, 4, true), { ...row(forest, 1), scryfallId: 'uncached' }];
  assert.deepEqual(ownedCounts(rows, index), { counts: new Map([['forest', 5]]), unresolved: 1 });
  assert.equal(ownedCounts(rows, index, true).counts.get('forest'), 9);
});
