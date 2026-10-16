import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

const requiredHeaders = ['Name', 'Quantity', 'Scryfall ID', 'Set code', 'Collector number', 'Foil', 'Proxy'];
const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function parseCollection(text, source = 'collection') {
  const records = parse(text, {
    bom: true,
    skip_empty_lines: true,
    columns(headers) {
      if (new Set(headers).size !== headers.length) throw new Error(`${source}: duplicate headers`);
      const missing = requiredHeaders.filter((header) => !headers.includes(header));
      if (missing.length) throw new Error(`${source}: missing headers: ${missing.join(', ')}`);
      return headers;
    },
  });
  if (!records.length) throw new Error(`${source}: no card rows`);
  return records.map((record, index) => {
    const location = `${source}: record ${index + 2}`;
    if (!record.Name.trim()) throw new Error(`${location}: empty card name`);
    if (!/^[1-9]\d*$/.test(record.Quantity) || !Number.isSafeInteger(Number(record.Quantity))) {
      throw new Error(`${location}: Quantity must be a positive integer`);
    }
    if (!uuidPattern.test(record['Scryfall ID'])) throw new Error(`${location}: invalid Scryfall ID`);
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
      proxy: record.Proxy === 'true',
    };
  });
}

export async function loadCollections(root) {
  const load = async (name) => parseCollection(await readFile(`${root}/collections/${name}.csv`, 'utf8'), name);
  const [organized, precons] = await Promise.all([load('Organized'), load('Precons')]);
  return { organized, precons };
}

export function summarize(rows) {
  return {
    rows: rows.length,
    copies: rows.reduce((total, row) => total + row.quantity, 0),
    names: new Set(rows.map((row) => row.name)).size,
    proxyCopies: rows.filter((row) => row.proxy).reduce((total, row) => total + row.quantity, 0),
  };
}

// Copies per oracle ID, so every printing and finish of a card counts together.
export function ownedCounts(rows, index, allowProxies = false) {
  const counts = new Map();
  let unresolved = 0;
  for (const row of rows) {
    if (row.proxy && !allowProxies) continue;
    const card = index.byId.get(row.scryfallId);
    if (!card) {
      unresolved += 1;
      continue;
    }
    counts.set(card.oracle_id, (counts.get(card.oracle_id) ?? 0) + row.quantity);
  }
  return { counts, unresolved };
}
