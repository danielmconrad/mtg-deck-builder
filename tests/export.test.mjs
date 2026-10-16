import test from 'node:test';
import assert from 'node:assert/strict';
import { copyToClipboard } from '../scripts/clipboard.mjs';
import { exportDeck, printingChooser } from '../scripts/export.mjs';
import { card, entry, forest, indexOf, row } from './fixtures.mjs';

const RING_ID = 'ring-print';
const ring = card('Sol Ring', { id: RING_ID, set: 'cmr', collectorNumber: '472' });
const deck = {
  commanders: [entry('Example Leader')],
  mainboard: [entry('Sol Ring', 1, { role: 'ramp, artifact', scryfall_id: RING_ID }), entry('Forest', 98)],
};
const printingOf = (value) => (value.scryfall_id === RING_ID ? ring : null);

test('text export lists commanders, then the mainboard, by name only', () => {
  assert.equal(exportDeck(deck, { printingOf }), 'Commander\n1 Example Leader\n\n1 Sol Ring\n98 Forest\n');
});

test('Moxfield export uses Arena sections and pinned printings', () => {
  assert.equal(
    exportDeck(deck, { format: 'moxfield', printingOf }),
    'Commander\n1 Example Leader\n\nDeck\n1 Sol Ring (CMR) 472\n98 Forest\n',
  );
});

test('Moxfield export omits the Commander section for casual decks', () => {
  assert.equal(exportDeck({ ...deck, commanders: [] }, { format: 'moxfield' }), 'Deck\n1 Sol Ring\n98 Forest\n');
});

test('Archidekt export tags commanders and turns roles into categories', () => {
  assert.equal(
    exportDeck(deck, { format: 'archidekt', printingOf }),
    '1x Example Leader [Commander{top}]\n1x Sol Ring (CMR) 472 [ramp,artifact]\n98x Forest\n',
  );
});

test('unknown export formats are rejected with the valid choices', () => {
  assert.throws(() => exportDeck(deck, { format: 'tappedout' }), /text, moxfield, archidekt/);
});

test('copying fails clearly on a platform with no known clipboard command', async () => {
  await assert.rejects(copyToClipboard('text', 'plan9'), /No clipboard command found for plan9/);
});

test('printingChooser prefers the pin, then an owned non-proxy printing, then any cached printing', () => {
  const ownedForest = { ...forest, id: 'owned-forest', set: 'ltr', collectorNumber: '280' };
  const proxyForest = { ...forest, id: 'proxy-forest', set: 'pxy' };
  const index = indexOf(forest, ownedForest, proxyForest, ring);
  const missing = new Set();
  const printingOf = printingChooser(
    index,
    [row(proxyForest, 1, { isProxy: true }), row(ownedForest, 4), row(forest, 2)],
    missing,
  );
  assert.equal(printingOf(entry('Forest')), ownedForest);
  assert.equal(printingOf(entry('Forest', 1, { scryfall_id: forest.id })), forest);
  assert.equal(printingOf(entry('Sol Ring')), ring);
  assert.equal(printingOf(entry('Unknown Card')), null);
  assert.equal(printingOf(entry('Forest', 1, { scryfall_id: 'not-cached' })), null);
  assert.deepEqual([...missing], ['Unknown Card', 'Forest']);
});
