import { parse } from 'csv-parse/sync';
import { isBasic } from './card.mjs';

const REQUIRED_HEADERS = ['Name', 'Quantity', 'Scryfall ID', 'Set code', 'Collector number', 'Foil', 'Proxy'];
const UUID_PATTERN = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const HEADER_ROWS = 1;

function checkHeaders(headers, source) {
  if (new Set(headers).size !== headers.length) throw new Error(`${source}: duplicate headers`);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`${source}: missing headers: ${missing.join(', ')}`);
  return headers;
}

function toRow(record, location) {
  if (!record.Name.trim()) throw new Error(`${location}: empty card name`);
  if (!POSITIVE_INTEGER.test(record.Quantity) || !Number.isSafeInteger(Number(record.Quantity))) {
    throw new Error(`${location}: Quantity must be a positive integer`);
  }
  if (!UUID_PATTERN.test(record['Scryfall ID'])) throw new Error(`${location}: invalid Scryfall ID`);
  if (!['true', 'false'].includes(record.Proxy)) throw new Error(`${location}: invalid Proxy flag`);
  if (!record['Set code'] || !record['Collector number'] || !record.Foil) {
    throw new Error(`${location}: incomplete printing information`);
  }
  return {
    name: record.Name.trim(),
    quantity: Number(record.Quantity),
    scryfallId: record['Scryfall ID'].toLowerCase(),
    set: record['Set code'],
    collectorNumber: record['Collector number'],
    finish: record.Foil,
    isProxy: record.Proxy === 'true',
  };
}

// Parses a ManaBox CSV export into rows, rejecting anything that would make ownership counts wrong.
export function parseCollection(text, source = 'collection') {
  const records = parse(text, {
    bom: true,
    skip_empty_lines: true,
    columns: (headers) => checkHeaders(headers, source),
  });
  if (!records.length) throw new Error(`${source}: no card rows`);
  return records.map((record, index) => toRow(record, `${source}: record ${index + HEADER_ROWS + 1}`));
}

const sumQuantities = (rows) => rows.reduce((total, row) => total + row.quantity, 0);

export function summarize(rows) {
  return {
    rowCount: rows.length,
    copies: sumQuantities(rows),
    distinctNames: new Set(rows.map((row) => row.name)).size,
    proxyCopies: sumQuantities(rows.filter((row) => row.isProxy)),
  };
}

// Copies per oracle ID, so every printing and finish of a card counts together.
export function ownedCounts(rows, index, { allowProxies = false } = {}) {
  const counts = new Map();
  let unresolvedRows = 0;
  for (const row of rows) {
    if (row.isProxy && !allowProxies) continue;
    const card = index.byId.get(row.scryfallId);
    if (!card) {
      unresolvedRows += 1;
      continue;
    }
    counts.set(card.oracleId, (counts.get(card.oracleId) ?? 0) + row.quantity);
  }
  return { counts, unresolvedRows };
}

export function availableCopies(owned, card, { unlimitedBasics = false } = {}) {
  if (unlimitedBasics && isBasic(card)) return Infinity;
  return owned.counts.get(card.oracleId) ?? 0;
}
