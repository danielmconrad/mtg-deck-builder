import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readCache, validateCache, writeCache } from '../scripts/card-cache.mjs';
import { fetchBulkCards, fetchCards, toCard } from '../scripts/scryfall.mjs';
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

// A fake Scryfall serving each bulk file's listing and its gzipped JSON Lines download.
const BULK_UPDATED_AT = '2026-10-15T09:00:00.000+00:00';
const bulkFetch = (files, listing) => async (url) => {
  const type = url.split('/').at(-1);
  if (url.startsWith('https://data.example/')) return new Response(files[type]);
  return Response.json(listing ?? { jsonl_download_uri: `https://data.example/${type}`, updated_at: BULK_UPDATED_AT });
};
const jsonLines = (...objects) => gzipSync(objects.map((object) => `${JSON.stringify(object)}\n`).join(''));

test('fetchBulkCards caches every printing, marking Scryfall defaults, dated when Scryfall built the files', async () => {
  const { cards, fetchedAt } = await fetchBulkCards({
    fetchFn: bulkFetch({
      oracle_cards: jsonLines(scryfallCard('a')),
      default_cards: jsonLines(scryfallCard('a'), scryfallCard('b')),
    }),
  });
  assert.deepEqual(Object.keys(cards), ['a', 'b']);
  assert.deepEqual([cards.a.defaultPrinting, cards.b.defaultPrinting], [true, false]);
  assert.equal(fetchedAt, '2026-10-15T09:00:00.000Z');
  assert.equal(cards.b.fetchedAt, fetchedAt);
});

test('fetchBulkCards rejects failed, unexpected, empty and truncated downloads', async () => {
  const whole = jsonLines(scryfallCard('a'), scryfallCard('b'));
  const withDefaults = (defaultCards) => bulkFetch({ oracle_cards: whole, default_cards: defaultCards });
  await assert.rejects(fetchBulkCards({ fetchFn: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  await assert.rejects(fetchBulkCards({ fetchFn: bulkFetch({}, {}) }), /Unexpected/);
  await assert.rejects(fetchBulkCards({ fetchFn: withDefaults(gzipSync('')) }), /default_cards was empty/);
  await assert.rejects(
    fetchBulkCards({ fetchFn: withDefaults(whole.subarray(0, whole.length - 10)) }),
    /download failed.*cache was not changed/,
  );
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

test('toCard records flavor names, which some printings give a card', () => {
  const named = (fields) =>
    toCard({ id: 'x', oracle_id: 'o', name: 'Voracious Hydra', ...fields }, 'fetched').flavorName;
  assert.equal(named({ flavor_name: 'Aggro Amalgam' }), 'Aggro Amalgam');
  assert.equal(named({}), null);
});

test('toCard records Game Changer status, defaulting to false', () => {
  assert.equal(toCard({ id: 'gc', oracle_id: 'o', name: 'GC', game_changer: true }, 'fetched').gameChanger, true);
  assert.equal(toCard({ id: 'plain', oracle_id: 'o', name: 'Plain' }, 'fetched').gameChanger, false);
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

test('an ambiguous name means the one card legal in some format', () => {
  const real = card('Pick Your Poison', { id: 'real', oracleId: 'real' });
  const playtest = card('Pick Your Poison', {
    id: 'playtest',
    oracleId: 'playtest',
    legalities: { commander: 'not_legal' },
  });
  assert.equal(indexOf(playtest, real).lookup(entry('Pick Your Poison')).card, real);
});

test("a name gives Scryfall's default printing, else the first cached", () => {
  const [first, second] = [card('Bolt', { id: 'first' }), card('Bolt', { id: 'second' })];
  assert.equal(indexOf(first, second).lookup(entry('Bolt')).card, first);
  const preferred = { ...second, defaultPrinting: true };
  const index = indexOf(first, preferred);
  assert.equal(index.lookup(entry('Bolt')).card, preferred);
  assert.deepEqual(
    index.printingsOf('bolt').map(({ id }) => id),
    ['second', 'first'],
  );
});

test('isCached checks IDs by printing and names by any printing', () => {
  const index = indexOf(card('Bolt'));
  assert.equal(index.isCached({ id: 'bolt-print' }), true);
  assert.equal(index.isCached({ name: 'bolt' }), true);
  assert.equal(index.isCached({ id: 'other' }), false);
  assert.equal(index.isCached({ set: 'TST', collector_number: '1' }), true);
  assert.equal(index.isCached({ set: 'tst', collector_number: '2' }), false);
  assert.equal(index.printing('TST', '1').name, 'Bolt');
});
