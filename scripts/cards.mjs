import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

export const CACHE_VERSION = 2;
export const DAY_MS = 86_400_000;
export const RULES_WARN_AGE_MS = 30 * DAY_MS;
export const PRICE_MAX_AGE_MS = 7 * DAY_MS;
const SCRYFALL_URL = 'https://api.scryfall.com/cards/collection';
const SCRYFALL_BATCH_SIZE = 75;
const SCRYFALL_REQUEST_GAP_MS = 550;
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

export const normalizeName = (name) => name.trim().toLocaleLowerCase('en-US');
export const emptyCache = () => ({ version: CACHE_VERSION, cards: {} });

// Keeps only the fields the checks, search and stats read; full Scryfall objects are ~5KB each.
export function slimCard(card, fetchedAt) {
  const faces = card.card_faces ?? [];
  const front = faces[0] ?? card;
  return {
    id: card.id,
    oracle_id: card.oracle_id ?? front.oracle_id,
    name: card.name,
    front_name: front.name ?? card.name,
    set: card.set,
    collector_number: card.collector_number,
    mana_cost: card.mana_cost ?? front.mana_cost ?? '',
    cmc: card.cmc ?? front.cmc ?? 0,
    type_line: card.type_line ?? faces.map((face) => face.type_line).join(' // '),
    front_type: front.type_line ?? '',
    oracle_text: card.oracle_text ?? faces.map((face) => face.oracle_text ?? '').join('\n'),
    keywords: card.keywords ?? [],
    color_identity: card.color_identity ?? [],
    produced_mana: card.produced_mana ?? [],
    legalities: card.legalities ?? {},
    prices: { usd: card.prices?.usd ?? null, eur: card.prices?.eur ?? null },
    fetched_at: fetchedAt,
  };
}

export function validateCache(cache) {
  if (cache?.version !== CACHE_VERSION || typeof cache.cards !== 'object' || Array.isArray(cache.cards)) {
    throw new Error('Card cache is from an older version or invalid; run cards:refresh');
  }
  for (const [id, card] of Object.entries(cache.cards)) {
    const valid = card?.id === id && card.oracle_id && card.name && Array.isArray(card.color_identity)
      && !Number.isNaN(Date.parse(card.fetched_at));
    if (!valid) throw new Error(`Invalid card cache record ${id}; run cards:refresh`);
  }
  return cache;
}

export async function loadCache(root) {
  try {
    return validateCache(JSON.parse(await readFile(`${root}/.cache/cards.json`, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyCache();
    throw error;
  }
}

export async function saveCache(root, cache) {
  validateCache(cache);
  await mkdir(`${root}/.cache`, { recursive: true });
  const temporary = `${root}/.cache/cards.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache)}\n`);
  await rename(temporary, `${root}/.cache/cards.json`);
}

export async function fetchCards(identifiers, { fetchFn = fetch, pause = setTimeout, onBatch = () => {} } = {}) {
  const cards = {};
  const notFound = [];
  const unique = [...new Map(identifiers.map((identifier) => [JSON.stringify(identifier), identifier])).values()];
  for (let offset = 0; offset < unique.length; offset += SCRYFALL_BATCH_SIZE) {
    if (offset) await pause(SCRYFALL_REQUEST_GAP_MS);
    const batch = unique.slice(offset, offset + SCRYFALL_BATCH_SIZE);
    const response = await fetchFn(SCRYFALL_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'CollectionFirstDeckBuilder/1.0',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifiers: batch }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Scryfall returned HTTP ${response.status}; cache was not changed. Retry later.`);
    const body = await response.json();
    if (!Array.isArray(body.data) || body.has_more) throw new Error('Unexpected Scryfall response; cache was not changed');
    notFound.push(...(body.not_found ?? []));
    const fetchedAt = new Date().toISOString();
    for (const raw of body.data) {
      const card = raw?.id ? slimCard(raw, fetchedAt) : null;
      if (!card?.oracle_id || !card.name) {
        notFound.push({ name: raw?.name ?? 'Unrecognized card object', id: raw?.id });
        continue;
      }
      cards[card.id] = card;
    }
    onBatch(offset + batch.length, unique.length);
  }
  return { cards, notFound };
}

const addTo = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

export function cardIndex(cache) {
  const byId = new Map(Object.entries(cache.cards));
  const byOracle = new Map();
  const oraclesByName = new Map();
  for (const card of byId.values()) {
    addTo(byOracle, card.oracle_id, card);
    for (const name of new Set([card.name, card.front_name])) {
      const key = normalizeName(name);
      if (!oraclesByName.has(key)) oraclesByName.set(key, new Set());
      oraclesByName.get(key).add(card.oracle_id);
    }
  }
  return {
    byId,
    byOracle,
    // Returns { card } or { problem }. Any printing stands in for the card's rules identity.
    lookup(entry) {
      if (entry.scryfall_id) {
        const card = byId.get(entry.scryfall_id);
        if (!card) return { problem: `${entry.name}: Scryfall ID not cached; run cards:refresh` };
        if (normalizeName(card.name) !== normalizeName(entry.name) && normalizeName(card.front_name) !== normalizeName(entry.name)) {
          return { problem: `${entry.name}: name does not match Scryfall ID (${card.name})` };
        }
        return { card };
      }
      const oracles = oraclesByName.get(normalizeName(entry.name));
      if (!oracles) return { problem: `${entry.name}: not in card cache; check the spelling or run cards:refresh` };
      if (oracles.size > 1) return { problem: `${entry.name}: ambiguous name; add scryfall_id` };
      const [oracleId] = oracles;
      return { card: byOracle.get(oracleId)[0] };
    },
  };
}

// Cheapest fresh quote: the entry's own printing when it names one, else any cached printing of the card.
export function quote(index, card, { currency, printingId, now = Date.now() }) {
  const field = currency.toLowerCase();
  const candidates = printingId ? [index.byId.get(printingId)] : index.byOracle.get(card.oracle_id);
  const fresh = candidates.filter((printing) => now - Date.parse(printing.fetched_at) <= PRICE_MAX_AGE_MS);
  if (!fresh.length) return { problem: `price data older than ${PRICE_MAX_AGE_MS / DAY_MS} days; run cards:refresh` };
  let best = null;
  for (const printing of fresh) {
    const price = printing.prices[field];
    if (!PRICE_PATTERN.test(price ?? '')) continue;
    const cents = Math.round(Number(price) * 100);
    if (!best || cents < best.cents) best = { printing, cents };
  }
  return best ?? { problem: `no ${currency} quote on Scryfall` };
}
