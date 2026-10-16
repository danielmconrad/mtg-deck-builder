import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAY_MS, fetchCards, loadCache, quote, saveCache, slimCard, validateCache } from '../scripts/cards.mjs';
import { NOW, cacheOf, card, entry, indexOf } from './fixtures.mjs';

const scryfallCard = (id) => ({ id, oracle_id: `oracle-${id}`, name: id, type_line: 'Sorcery', color_identity: [] });
const respond = (body) => async () => ({ ok: true, json: async () => body });

test('Scryfall requests deduplicate, batch at 75, identify the app and pause between requests', async () => {
  const identifiers = Array.from({ length: 76 }, (_, index) => ({ id: `id-${index}` }));
  const calls = [];
  const pauses = [];
  const { cards, notFound } = await fetchCards([...identifiers, identifiers[0]], {
    pause: async (milliseconds) => pauses.push(milliseconds),
    fetchFn: async (url, options) => {
      calls.push(options);
      return { ok: true, json: async () => ({ data: JSON.parse(options.body).identifiers.map(({ id }) => scryfallCard(id)) }) };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].body).identifiers.length, 75);
  assert.equal(calls[0].headers['User-Agent'], 'CollectionFirstDeckBuilder/1.0');
  assert.deepEqual(pauses, [550]);
  assert.equal(Object.keys(cards).length, 76);
  assert.deepEqual(notFound, []);
});

test('unresolved, malformed and failed Scryfall responses are never silently accepted', async () => {
  const missing = { name: 'Unresolved' };
  assert.deepEqual((await fetchCards([missing], { fetchFn: respond({ data: [], not_found: [missing] }) })).notFound, [missing]);
  const { notFound } = await fetchCards([missing], { fetchFn: respond({ data: [{ id: 'no-oracle', name: 'Odd' }] }) });
  assert.deepEqual(notFound, [{ name: 'Odd', id: 'no-oracle' }]);
  await assert.rejects(fetchCards([missing], { fetchFn: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
  await assert.rejects(fetchCards([missing], { fetchFn: respond({ data: [], has_more: true }) }), /Unexpected/);
});

test('slimCard keeps rules fields and reads face data for double-faced and reversible cards', () => {
  const transform = slimCard({
    id: 'dfc', oracle_id: 'dfc-oracle', name: 'Front // Back', cmc: 3, color_identity: ['G'], legalities: { commander: 'legal' },
    card_faces: [
      { name: 'Front', mana_cost: '{2}{G}', type_line: 'Legendary Creature — Elf', oracle_text: 'Front text.' },
      { name: 'Back', mana_cost: '', type_line: 'Legendary Planeswalker', oracle_text: 'Back text.' },
    ],
  }, 'now');
  assert.equal(transform.front_name, 'Front');
  assert.equal(transform.front_type, 'Legendary Creature — Elf');
  assert.equal(transform.mana_cost, '{2}{G}');
  assert.equal(transform.oracle_text, 'Front text.\nBack text.');
  assert.equal(transform.type_line, 'Legendary Creature — Elf // Legendary Planeswalker');
  const reversible = slimCard({ id: 'rev', name: 'Card // Card', layout: 'reversible_card', card_faces: [{ name: 'Card', oracle_id: 'rev-oracle' }] }, 'now');
  assert.equal(reversible.oracle_id, 'rev-oracle');
});

test('cache round-trips and rejects records from the old format', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-cache-'));
  try {
    assert.deepEqual(await loadCache(root), cacheOf());
    const cache = cacheOf(card('Example'));
    await saveCache(root, cache);
    assert.deepEqual(await loadCache(root), cache);
    assert.throws(() => validateCache({ version: 1, cards: {} }), /older version/);
    assert.throws(() => validateCache(cacheOf({ ...card('Broken'), oracle_id: undefined })), /Invalid card cache record/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lookup accepts front-face names and reports ambiguity and ID/name mismatches', () => {
  const dfc = card('Front // Back', { front_name: 'Front' });
  const twin = card('Twin', { id: 'twin-a', oracle_id: 'twin-a' });
  const index = indexOf(dfc, twin, card('Twin', { id: 'twin-b', oracle_id: 'twin-b' }));
  assert.equal(index.lookup(entry('front')).card, dfc);
  assert.match(index.lookup(entry('Twin')).problem, /ambiguous/);
  assert.equal(index.lookup(entry('Twin', 1, { scryfall_id: 'twin-a' })).card, twin);
  assert.match(index.lookup(entry('Front', 1, { scryfall_id: 'twin-a' })).problem, /does not match/);
  assert.match(index.lookup(entry('Nothing')).problem, /not in card cache/);
});

test('quotes use the cheapest fresh printing unless the entry names one', () => {
  const cheap = card('Bolt', { id: 'cheap', prices: { usd: '0.25', eur: null } });
  const promo = card('Bolt', { id: 'promo', prices: { usd: '40.00', eur: null } });
  const unpriced = card('Bolt', { id: 'unpriced', prices: { usd: null, eur: null } });
  const index = indexOf(promo, unpriced, cheap);
  assert.equal(quote(index, promo, { currency: 'USD', now: NOW }).cents, 25);
  assert.equal(quote(index, promo, { currency: 'USD', printingId: 'promo', now: NOW }).cents, 4000);
  assert.match(quote(index, promo, { currency: 'EUR', now: NOW }).problem, /no EUR quote/);
  assert.match(quote(index, promo, { currency: 'USD', now: NOW + 8 * DAY_MS }).problem, /older than 7 days/);
});
