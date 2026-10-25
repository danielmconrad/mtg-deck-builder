import { setTimeout } from 'node:timers/promises';

const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
// Scryfall's daily bulk data files: see scryfall.com/docs/api/bulk-data.
const BULK_DATA_URL = 'https://api.scryfall.com/bulk-data';
const BATCH_SIZE = 75;
const REQUEST_GAP_MS = 550;
const REQUEST_TIMEOUT_MS = 30_000;
const BULK_TIMEOUT_MS = 600_000;
const BULK_PROGRESS_EVERY = 25_000;
const USER_AGENT = 'CollectionFirstDeckBuilder/1.0';
const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

// Translates a Scryfall card object into the project's card model, reading face data where
// double-faced and reversible cards leave top-level fields empty. defaultPrinting marks the printing
// Scryfall shows for the card's name, which only bulk data identifies. Every branch the complexity
// rule counts here is a `??` fallback in a flat field mapping, so splitting it would only hurt.
// eslint-disable-next-line complexity
export function toCard(scryfallCard, fetchedAt, { defaultPrinting = false } = {}) {
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
    flavorName: scryfallCard.flavor_name ?? front.flavor_name ?? null,
    oracleText: scryfallCard.oracle_text ?? faces.map((face) => face.oracle_text ?? '').join('\n'),
    keywords: scryfallCard.keywords ?? [],
    colorIdentity: scryfallCard.color_identity ?? [],
    producedMana: scryfallCard.produced_mana ?? [],
    legalities: scryfallCard.legalities ?? {},
    gameChanger: scryfallCard.game_changer === true,
    prices: { usd: scryfallCard.prices?.usd ?? null, eur: scryfallCard.prices?.eur ?? null },
    defaultPrinting,
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

// Splits a stream of text chunks into non-empty lines.
async function* textLines(chunks) {
  let buffer = '';
  for await (const chunk of chunks) {
    const lines = (buffer + chunk).split('\n');
    buffer = lines.pop();
    yield* lines.filter((line) => line.trim());
  }
  if (buffer.trim()) yield buffer;
}

async function openBulkFile(type, fetchFn) {
  const listing = await fetchFn(`${BULK_DATA_URL}/${type}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!listing.ok) throw new Error(`Scryfall returned HTTP ${listing.status}; cache was not changed. Retry later.`);
  const { jsonl_download_uri: uri, updated_at: updatedAt } = await listing.json();
  if (!uri || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('Unexpected Scryfall bulk data response; cache was not changed');
  }
  const download = await fetchFn(uri, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(BULK_TIMEOUT_MS),
  });
  if (!download.ok) throw new Error(`Scryfall returned HTTP ${download.status}; cache was not changed. Retry later.`);
  return { body: download.body, fetchedAt: new Date(updatedAt).toISOString() };
}

// Streams one bulk file, gzipped JSON Lines with a card per line, so it is never held whole. Each
// card's fetchedAt is the time Scryfall built the file.
async function readBulkFile(type, { fetchFn, onProgress }, onCard) {
  const { body, fetchedAt } = await openBulkFile(type, fetchFn);
  const text = body.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream());
  let read = 0;
  try {
    for await (const line of textLines(text)) {
      onCard(JSON.parse(line), fetchedAt);
      read += 1;
      if (read % BULK_PROGRESS_EVERY === 0) onProgress(type, read);
    }
  } catch (error) {
    throw new Error(`Scryfall bulk data download failed (${error.message}); cache was not changed`, { cause: error });
  }
  if (!read) throw new Error(`Scryfall bulk data file ${type} was empty; cache was not changed`);
  return fetchedAt;
}

// Every printing on Scryfall in English, or in its only language (Default Cards), with the printing
// Scryfall shows for each card's name marked as its default (Oracle Cards). Throws before returning
// anything if either download fails or is truncated.
export async function fetchBulkCards({ fetchFn = fetch, onProgress = () => {} } = {}) {
  const cards = {};
  const keep = (card) => {
    if (card.id && card.oracleId && card.name) cards[card.id] = card;
  };
  const context = { fetchFn, onProgress };
  await readBulkFile('oracle_cards', context, (object, at) => keep(toCard(object, at, { defaultPrinting: true })));
  const fetchedAt = await readBulkFile('default_cards', context, (object, at) => {
    if (!cards[object.id]) keep(toCard(object, at));
  });
  return { cards, fetchedAt };
}
