import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCache, validateCache, writeCache } from '../scripts/card-cache.mjs';
import { fetchCards, toCard } from '../scripts/scryfall.mjs';
import { cacheOf, card, entry, indexOf } from './fixtures.mjs';

const scryfallCard = (id) => ({ id, oracle_id: `oracle-${id}`, name: id, type_line: 'Sorcery', color_identity: [] });
const respondWith = (body) => async () => ({ ok: true, json: async () => body });
const noPause = async () => {};

test('fetchCards deduplicates identifiers, batches 75 per request and pauses between requests', async () => {
  const identifiers = Array.from({ length: 76 }, (_, index) => ({ id: `id-${index}` }));
  const requests = [];
  const pauses = [];
  const { cards, notFound } = await fetchCards([...identifiers, identifiers[0]], {
    pause: async (milliseconds) => pauses.push(milliseconds),
    fetchFn: async (url, options) => {
      requests.push(options);
      return {
        ok: true,
        json: async () => ({ data: JSON.parse(options.body).identifiers.map(({ id }) => scryfallCard(id)) }),
      };
    },
  });
  assert.deepEqual(
    requests.map((options) => JSON.parse(options.body).identifiers.length),
    [75, 1],
  );
  assert.equal(requests[0].headers['User-Agent'], 'CollectionFirstDeckBuilder/1.0');
  assert.deepEqual(pauses, [550]);
  assert.equal(Object.keys(cards).length, 76);
  assert.deepEqual(notFound, []);
});

test('fetchCards reports Scryfall not_found entries and card objects without an oracle ID', async () => {
  const missing = { name: 'Unresolved' };
  const { notFound } = await fetchCards([missing], {
    pause: noPause,
    fetchFn: respondWith({ data: [{ id: 'odd', name: 'Odd' }], not_found: [missing] }),
  });
  assert.deepEqual(notFound, [missing, { name: 'Odd', id: 'odd' }]);
});

test('fetchCards rejects HTTP failures and paginated responses', async () => {
  await assert.rejects(fetchCards([{ id: 'x' }], { fetchFn: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
  await assert.rejects(fetchCards([{ id: 'x' }], { fetchFn: respondWith({ data: [], has_more: true }) }), /Unexpected/);
});

test('toCard reads face data for double-faced cards', () => {
  const result = toCard(
    {
      id: 'dfc',
      oracle_id: 'dfc-oracle',
      name: 'Front // Back',
      cmc: 3,
      card_faces: [
        { name: 'Front', mana_cost: '{2}{G}', type_line: 'Legendary Creature — Elf', oracle_text: 'Front text.' },
        { name: 'Back', mana_cost: '', type_line: 'Legendary Planeswalker', oracle_text: 'Back text.' },
      ],
    },
    'fetched',
  );
  assert.equal(result.frontName, 'Front');
  assert.equal(result.frontType, 'Legendary Creature — Elf');
  assert.equal(result.manaCost, '{2}{G}');
  assert.equal(result.manaValue, 3);
  assert.equal(result.oracleText, 'Front text.\nBack text.');
  assert.equal(result.typeLine, 'Legendary Creature — Elf // Legendary Planeswalker');
});

test('toCard takes the oracle ID from the face of reversible cards', () => {
  const result = toCard(
    { id: 'rev', name: 'Card // Card', card_faces: [{ name: 'Card', oracle_id: 'rev-oracle' }] },
    'fetched',
  );
  assert.equal(result.oracleId, 'rev-oracle');
});

test('the card cache round-trips through disk and starts empty', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-cache-'));
  const path = join(directory, 'nested', 'cards.json');
  try {
    assert.deepEqual(await readCache(path), cacheOf());
    const cache = cacheOf(card('Example'));
    await writeCache(path, cache);
    assert.deepEqual(await readCache(path), cache);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the card cache rejects older versions and malformed records', () => {
  assert.throws(() => validateCache({ version: 2, cards: {} }), /older version/);
  assert.throws(() => validateCache(cacheOf({ ...card('Broken'), oracleId: undefined })), /Invalid card cache record/);
});

test('lookup accepts front-face names case-insensitively', () => {
  const dfc = card('Front // Back', { frontName: 'Front' });
  assert.equal(indexOf(dfc).lookup(entry('front')).card, dfc);
});

test('lookup reports unknown names, ambiguous names and mismatched Scryfall IDs', () => {
  const twinA = card('Twin', { id: 'twin-a', oracleId: 'twin-a' });
  const index = indexOf(twinA, card('Twin', { id: 'twin-b', oracleId: 'twin-b' }));
  assert.match(index.lookup(entry('Nothing')).problem, /not in card cache/);
  assert.match(index.lookup(entry('Twin')).problem, /ambiguous/);
  assert.equal(index.lookup(entry('Twin', 1, { scryfall_id: 'twin-a' })).card, twinA);
  assert.match(index.lookup(entry('Other', 1, { scryfall_id: 'twin-a' })).problem, /does not match/);
});

test('isCached checks IDs by printing and names by any printing', () => {
  const index = indexOf(card('Bolt'));
  assert.equal(index.isCached({ id: 'bolt-print' }), true);
  assert.equal(index.isCached({ name: 'bolt' }), true);
  assert.equal(index.isCached({ id: 'other' }), false);
});
