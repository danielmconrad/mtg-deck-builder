import { hasName, normalizeName } from './card.mjs';

function getOrCreate(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}

// Scryfall's default printing first, so a card nobody owns exports as Scryfall would show it. The
// sort is stable, so other printings keep the cache's order.
const defaultFirst = (first, second) => Number(second.defaultPrinting) - Number(first.defaultPrinting);

const isLegalSomewhere = (card) =>
  Object.values(card.legalities).some((status) => status === 'legal' || status === 'restricted');

export function cardIndex(cache) {
  const byId = new Map(Object.entries(cache.cards));
  const byOracleId = new Map();
  const oracleIdsByName = new Map();
  const byPrinting = new Map();
  const printingKey = (set, collectorNumber) => `${set}|${collectorNumber}`.toLowerCase();
  for (const card of byId.values()) {
    getOrCreate(byOracleId, card.oracleId, () => []).push(card);
    getOrCreate(byPrinting, printingKey(card.set, card.collectorNumber), () => card);
    for (const name of new Set([card.name, card.frontName])) {
      getOrCreate(oracleIdsByName, normalizeName(name), () => new Set()).add(card.oracleId);
    }
  }
  for (const printings of byOracleId.values()) printings.sort(defaultFirst);

  // A name shared by several cards means the one legal in some format, if only one is: bulk data
  // gives real cards' names to tokens, art cards and playtest cards too.
  function oracleIdFor(name) {
    const oracleIds = [...(oracleIdsByName.get(normalizeName(name)) ?? [])];
    if (oracleIds.length < 2) return { oracleId: oracleIds[0] };
    const legal = oracleIds.filter((oracleId) => isLegalSomewhere(byOracleId.get(oracleId)[0]));
    return legal.length === 1 ? { oracleId: legal[0] } : { ambiguous: true };
  }

  // Returns { card } or { problem }. A name gives the card's first printing, which stands in for its
  // rules identity.
  function lookup({ name, scryfall_id: scryfallId }) {
    if (scryfallId) {
      const card = byId.get(scryfallId);
      if (!card) return { problem: `${name}: Scryfall ID not cached; run scryfall:refresh` };
      if (!hasName(card, name)) return { problem: `${name}: name does not match Scryfall ID (${card.name})` };
      return { card };
    }
    const { oracleId, ambiguous } = oracleIdFor(name);
    if (ambiguous) return { problem: `${name}: ambiguous name; add scryfall_id` };
    if (!oracleId) return { problem: `${name}: not in card cache; check the spelling or run scryfall:refresh` };
    return { card: byOracleId.get(oracleId)[0] };
  }

  // A printing by set code and collector number, e.g. ('tmc', '54').
  const printing = (set, collectorNumber) => byPrinting.get(printingKey(set, collectorNumber));

  // Takes a Scryfall identifier ({ id }, { set, collector_number } or { name }) rather than a deck entry.
  function isCached(identifier) {
    if (identifier.id) return byId.has(identifier.id);
    if (identifier.set) return Boolean(printing(identifier.set, identifier.collector_number));
    return oracleIdsByName.has(normalizeName(identifier.name));
  }

  const printingsOf = (oracleId) => byOracleId.get(oracleId) ?? [];

  return { byId, lookup, isCached, printing, printingsOf };
}
