import { hasName, normalizeName } from './card.mjs';

function getOrCreate(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}

export function cardIndex(cache) {
  const byId = new Map(Object.entries(cache.cards));
  const byOracleId = new Map();
  const oracleIdsByName = new Map();
  for (const card of byId.values()) {
    getOrCreate(byOracleId, card.oracleId, () => []).push(card);
    for (const name of new Set([card.name, card.frontName])) {
      getOrCreate(oracleIdsByName, normalizeName(name), () => new Set()).add(card.oracleId);
    }
  }

  // Returns { card } or { problem }. Any printing stands in for the card's rules identity.
  function lookup({ name, scryfall_id: scryfallId }) {
    if (scryfallId) {
      const card = byId.get(scryfallId);
      if (!card) return { problem: `${name}: Scryfall ID not cached; run cards:refresh` };
      if (!hasName(card, name)) return { problem: `${name}: name does not match Scryfall ID (${card.name})` };
      return { card };
    }
    const oracleIds = oracleIdsByName.get(normalizeName(name));
    if (!oracleIds) return { problem: `${name}: not in card cache; check the spelling or run cards:refresh` };
    if (oracleIds.size > 1) return { problem: `${name}: ambiguous name; add scryfall_id` };
    const [oracleId] = oracleIds;
    return { card: byOracleId.get(oracleId)[0] };
  }

  // Takes a Scryfall identifier ({ id } or { name }) rather than a deck entry.
  const isCached = (identifier) =>
    identifier.id ? byId.has(identifier.id) : oracleIdsByName.has(normalizeName(identifier.name));

  const printingsOf = (oracleId) => byOracleId.get(oracleId) ?? [];

  return { byId, lookup, isCached, printingsOf };
}
