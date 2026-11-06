import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// In memory the cache is { version, cards, bulkBuiltAt?, refreshedAt? }, where cards maps each printing's
// Scryfall ID to a card in the model toCard (scryfall.mjs) builds. On disk the rules fields every
// printing of a card shares are stored once per card (oracle ID), and legalities keep only the formats
// a card isn't not_legal in, which takes a bulk cache from about 144 MB to 57 MB and makes it several
// times faster to read. Bump CACHE_VERSION whenever the card model changes shape, so stale caches are
// rejected. edhrecRank, borderColor, setType and rarity were added without a bump: caches written before
// them lack the fields, which read as an unknown rank, a playable printing and an unknown rarity until
// the next refresh.
export const CACHE_VERSION = 7;
// The previous on-disk layout, one full record per printing. It's still read, and the next save
// writes the current layout.
const FLAT_CACHE_VERSION = 6;

// The fields that differ between printings of one card. Every other field is the card's.
const PRINTING_FIELDS = [
  'id',
  'oracleId',
  'set',
  'collectorNumber',
  'flavorName',
  'borderColor',
  'setType',
  'rarity',
  'prices',
  'defaultPrinting',
  'fetchedAt',
];
const NOT_LEGAL = 'not_legal';

export const emptyCache = () => ({ version: CACHE_VERSION, cards: {} });

const cacheError = (message) => new Error(`${message}; run scryfall:refresh`);

// Checks the in-memory cache record by record, as every save does.
export function validateCache(cache) {
  if (cache?.version !== CACHE_VERSION || typeof cache.cards !== 'object' || Array.isArray(cache.cards)) {
    throw cacheError('Card cache is from an older version or invalid');
  }
  for (const [id, card] of Object.entries(cache.cards)) {
    const isValid =
      card?.id === id &&
      card.oracleId &&
      card.name &&
      Array.isArray(card.colorIdentity) &&
      !Number.isNaN(Date.parse(card.fetchedAt));
    if (!isValid) throw cacheError(`Invalid card cache record ${id}`);
  }
  return cache;
}

// Fields that change over time, such as bans and the Game Changers list, are the card's as last fetched.
const CURRENT_FIELDS = ['legalities', 'gameChanger', 'edhrecRank'];
// Formats Scryfall judges per printing rather than per card: Old School takes only printings from its sets.
const PRINTING_FORMATS = ['oldschool'];

// A legalities object without its not_legal entries, split into the card's formats and the printing's.
function compactLegalities(legalities, keep) {
  return Object.fromEntries(
    Object.entries(legalities).filter(([format, status]) => status !== NOT_LEGAL && keep(format)),
  );
}

const sameValue = (first, second) => JSON.stringify(first) === JSON.stringify(second);
const isNewer = (card, than) => !than || Date.parse(card.fetchedAt) > Date.parse(than.fetchedAt);

// The on-disk layout. A card's fields come from Scryfall's default printing (else its newest), and its
// CURRENT_FIELDS from its newest printing. A printing whose other fields differ, such as a reversible
// Secret Lair printing named "Anointed Procession // Anointed Procession", keeps its own values.
function pack({ cards: printings, ...meta }) {
  const base = new Map();
  const newest = new Map();
  for (const card of Object.values(printings)) {
    const chosen = base.get(card.oracleId);
    if (!chosen || (card.defaultPrinting && !chosen.defaultPrinting)) base.set(card.oracleId, card);
    if (isNewer(card, newest.get(card.oracleId))) newest.set(card.oracleId, card);
  }
  const formats = new Set();
  const cards = {};
  for (const [oracleId, card] of base) {
    const record = Object.fromEntries(Object.entries(card).filter(([field]) => !PRINTING_FIELDS.includes(field)));
    for (const field of CURRENT_FIELDS) record[field] = newest.get(oracleId)[field];
    for (const format of Object.keys(record.legalities)) formats.add(format);
    cards[oracleId] = record;
  }
  const packed = {};
  for (const card of Object.values(printings)) {
    const record = cards[card.oracleId];
    const own = Object.entries(card).filter(
      ([field, value]) =>
        field !== 'id' &&
        (PRINTING_FIELDS.includes(field) || (!CURRENT_FIELDS.includes(field) && !sameValue(value, record[field]))),
    );
    const printingLegalities = compactLegalities(card.legalities, (format) => PRINTING_FORMATS.includes(format));
    packed[card.id] = {
      ...Object.fromEntries(own),
      ...(Object.keys(printingLegalities).length && { printingLegalities }),
    };
  }
  for (const record of Object.values(cards)) {
    record.legalities = compactLegalities(record.legalities, (format) => !PRINTING_FORMATS.includes(format));
  }
  return { ...meta, version: CACHE_VERSION, formats: [...formats].sort(), cards, printings: packed };
}

// The in-memory cache from the on-disk layout, with each card's legalities filled back in.
function unpack({ formats, cards, printings, ...meta }) {
  if (!Array.isArray(formats) || typeof cards !== 'object' || typeof printings !== 'object') {
    throw cacheError('Card cache is invalid');
  }
  const notLegal = Object.fromEntries(formats.map((format) => [format, NOT_LEGAL]));
  for (const card of Object.values(cards)) card.legalities = { ...notLegal, ...card.legalities };
  const unpacked = {};
  for (const [id, { printingLegalities, ...printing }] of Object.entries(printings)) {
    const card = cards[printing.oracleId];
    if (!card) throw cacheError(`Invalid card cache record ${id}`);
    const legalities = printingLegalities ? { ...card.legalities, ...printingLegalities } : card.legalities;
    unpacked[id] = { ...card, ...printing, legalities, id };
  }
  return { ...meta, cards: unpacked };
}

// Reading checks the layout rather than every record, which saving already did.
export async function readCache(path) {
  let stored;
  try {
    stored = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyCache();
    throw error;
  }
  if (stored?.version === FLAT_CACHE_VERSION) return validateCache({ ...stored, version: CACHE_VERSION });
  if (stored?.version !== CACHE_VERSION) throw cacheError('Card cache is from an older version or invalid');
  return unpack(stored);
}

// Writes through a temporary file so an interrupted write never leaves a truncated cache.
export async function writeCache(path, cache) {
  validateCache(cache);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(pack(cache))}\n`);
  await rename(temporaryPath, path);
}
