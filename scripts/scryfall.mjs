import { setTimeout } from 'node:timers/promises';

const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH_SIZE = 75;
const REQUEST_GAP_MS = 550;
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS = {
  'User-Agent': 'CollectionFirstDeckBuilder/1.0',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

// Translates a Scryfall card object into the project's card model, reading face data where
// double-faced and reversible cards leave top-level fields empty. Every branch the complexity
// rule counts here is a `??` fallback in a flat field mapping, so splitting it would only hurt.
// eslint-disable-next-line complexity
export function toCard(scryfallCard, fetchedAt) {
  const faces = scryfallCard.card_faces ?? [];
  const front = faces[0] ?? scryfallCard;
  return {
    id: scryfallCard.id,
    oracleId: scryfallCard.oracle_id ?? front.oracle_id,
    name: scryfallCard.name,
    frontName: front.name ?? scryfallCard.name,
    set: scryfallCard.set,
    collectorNumber: scryfallCard.collector_number,
    manaCost: scryfallCard.mana_cost ?? front.mana_cost ?? '',
    manaValue: scryfallCard.cmc ?? front.cmc ?? 0,
    typeLine: scryfallCard.type_line ?? faces.map((face) => face.type_line).join(' // '),
    frontType: front.type_line ?? '',
    oracleText: scryfallCard.oracle_text ?? faces.map((face) => face.oracle_text ?? '').join('\n'),
    keywords: scryfallCard.keywords ?? [],
    colorIdentity: scryfallCard.color_identity ?? [],
    producedMana: scryfallCard.produced_mana ?? [],
    legalities: scryfallCard.legalities ?? {},
    gameChanger: scryfallCard.game_changer === true,
    prices: { usd: scryfallCard.prices?.usd ?? null, eur: scryfallCard.prices?.eur ?? null },
    fetchedAt,
  };
}

const uniqueIdentifiers = (identifiers) => [
  ...new Map(identifiers.map((identifier) => [JSON.stringify(identifier), identifier])).values(),
];

async function requestBatch(batch, fetchFn) {
  const response = await fetchFn(COLLECTION_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ identifiers: batch }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Scryfall returned HTTP ${response.status}; cache was not changed. Retry later.`);
  const body = await response.json();
  if (!Array.isArray(body.data) || body.has_more) {
    throw new Error('Unexpected Scryfall response; cache was not changed');
  }
  return body;
}

// Splits one response into valid cards and unrecognized entries.
function sortBatch(body, fetchedAt) {
  const cards = [];
  const notFound = [...(body.not_found ?? [])];
  for (const scryfallCard of body.data) {
    const card = scryfallCard?.id ? toCard(scryfallCard, fetchedAt) : null;
    if (card?.oracleId && card.name) cards.push(card);
    else notFound.push({ name: scryfallCard?.name ?? 'Unrecognized card object', id: scryfallCard?.id });
  }
  return { cards, notFound };
}

// Fetches identifiers ({ id } or { name }) in rate-limited batches. Throws before returning anything
// if any request fails, so callers never persist a partial result.
export async function fetchCards(identifiers, { fetchFn = fetch, pause = setTimeout, onProgress = () => {} } = {}) {
  const cards = {};
  const notFound = [];
  const unique = uniqueIdentifiers(identifiers);
  for (let offset = 0; offset < unique.length; offset += BATCH_SIZE) {
    if (offset) await pause(REQUEST_GAP_MS);
    const batch = unique.slice(offset, offset + BATCH_SIZE);
    const sorted = sortBatch(await requestBatch(batch, fetchFn), new Date().toISOString());
    for (const card of sorted.cards) cards[card.id] = card;
    notFound.push(...sorted.notFound);
    onProgress(offset + batch.length, unique.length);
  }
  return { cards, notFound };
}
