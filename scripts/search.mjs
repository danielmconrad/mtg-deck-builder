import { ownedCounts } from './collection.mjs';

const COLORS = 'WUBRG';

export function parseIdentity(text) {
  if (!/^[WUBRGC]+$/i.test(text)) throw new Error(`Color identity "${text}" must use W, U, B, R, G, or C for colorless`);
  return new Set([...text.toUpperCase()].filter((letter) => COLORS.includes(letter)));
}

function matches(card, filters) {
  if (filters.identity && !card.color_identity.every((color) => filters.identity.has(color))) return false;
  if (filters.legal && card.legalities[filters.legal] !== 'legal') return false;
  if (filters.minMv !== undefined && card.cmc < filters.minMv) return false;
  if (filters.maxMv !== undefined && card.cmc > filters.maxMv) return false;
  if (filters.name && !filters.name.test(card.name)) return false;
  return (filters.type ?? []).every((pattern) => pattern.test(card.type_line))
    && (filters.text ?? []).every((pattern) => pattern.test(card.oracle_text));
}

// One result per card (oracle ID), listing Organized copies and protected Precons copies.
export function searchCollection(collections, index, filters = {}) {
  const organized = ownedCounts(collections.organized, index, filters.proxies);
  const precons = ownedCounts(collections.precons, index, filters.proxies);
  const oracleIds = new Set(organized.counts.keys());
  if (filters.precons) for (const id of precons.counts.keys()) oracleIds.add(id);
  const results = [];
  for (const id of oracleIds) {
    const card = index.byOracle.get(id)[0];
    if (!matches(card, filters)) continue;
    results.push({ card, organized: organized.counts.get(id) ?? 0, precons: precons.counts.get(id) ?? 0 });
  }
  results.sort((first, second) => first.card.cmc - second.card.cmc || first.card.name.localeCompare(second.card.name));
  return { results, unresolved: organized.unresolved + (filters.precons ? precons.unresolved : 0) };
}
