import { canBeCommander, creatureTypes, identityLabel, isLand } from './card.mjs';
import { ownedCounts } from './collection.mjs';

const COLORS = 'WUBRG';
const IDENTITY_PATTERN = /^[WUBRGC]+$/i;
const NUMBER_PATTERN = /^\d+(\.\d+)?$/;

// Letters from WUBRG; C alone means colorless only.
export function parseIdentity(text) {
  if (!IDENTITY_PATTERN.test(text)) {
    throw new Error(`Color identity "${text}" must use W, U, B, R, G, or C for colorless`);
  }
  return new Set([...text.toUpperCase()].filter((letter) => COLORS.includes(letter)));
}

function parseNumber(value, flag) {
  if (value === undefined) return undefined;
  if (!NUMBER_PATTERN.test(value)) throw new Error(`${flag} must be a number`);
  return Number(value);
}

const caseInsensitive = (source) => new RegExp(source, 'i');

function commanderFilters(name, index, legalIn) {
  const { card, problem } = index.lookup({ name });
  if (problem) throw new Error(problem);
  return { identity: new Set(card.colorIdentity), legalIn: legalIn ?? 'commander' };
}

// Translates collection:search command-line options into filters for searchCollection.
export function searchFilters(options, index) {
  if (options.commander && options.identity) throw new Error('Use --commander or --identity, not both');
  const filters = {
    name: options.name && caseInsensitive(options.name),
    types: (options.type ?? []).map(caseInsensitive),
    texts: (options.text ?? []).map(caseInsensitive),
    identity: options.identity && parseIdentity(options.identity),
    legalIn: options.legal,
    minManaValue: parseNumber(options['min-mv'], '--min-mv'),
    maxManaValue: parseNumber(options['max-mv'], '--max-mv'),
    commandersOnly: Boolean(options.commanders),
    nonlandOnly: Boolean(options.nonland),
    includePreconOnly: Boolean(options.precons),
    allowProxies: Boolean(options.proxies),
  };
  if (!options.commander) return filters;
  return { ...filters, ...commanderFilters(options.commander, index, filters.legalIn) };
}

// One predicate per filter; an unset filter matches everything.
const FILTER_PREDICATES = [
  (card, { identity }) => !identity || card.colorIdentity.every((color) => identity.has(color)),
  (card, { commandersOnly }) => !commandersOnly || canBeCommander(card),
  (card, { nonlandOnly }) => !nonlandOnly || !isLand(card),
  (card, { legalIn }) => !legalIn || card.legalities[legalIn] === 'legal',
  (card, { minManaValue }) => minManaValue === undefined || card.manaValue >= minManaValue,
  (card, { maxManaValue }) => maxManaValue === undefined || card.manaValue <= maxManaValue,
  (card, { name }) => !name || name.test(card.name),
  (card, { types = [] }) => types.every((pattern) => pattern.test(card.typeLine)),
  (card, { texts = [] }) => texts.every((pattern) => pattern.test(card.oracleText)),
];

const matches = (card, filters) => FILTER_PREDICATES.every((predicate) => predicate(card, filters));

const byManaValueThenName = (first, second) =>
  first.card.manaValue - second.card.manaValue || first.card.name.localeCompare(second.card.name);

// One result per card (oracle ID), with Organized copies and protected Precons copies.
export function searchCollection(collections, index, filters = {}) {
  const policy = { allowProxies: filters.allowProxies };
  const organized = ownedCounts(collections.organized, index, policy);
  const precons = ownedCounts(collections.precons, index, policy);
  const oracleIds = new Set(organized.counts.keys());
  if (filters.includePreconOnly) for (const oracleId of precons.counts.keys()) oracleIds.add(oracleId);
  const results = [...oracleIds]
    .map((oracleId) => ({
      card: index.printingsOf(oracleId)[0],
      organized: organized.counts.get(oracleId) ?? 0,
      precons: precons.counts.get(oracleId) ?? 0,
    }))
    .filter(({ card }) => matches(card, filters))
    .sort(byManaValueThenName);
  const unresolvedRows = organized.unresolvedRows + (filters.includePreconOnly ? precons.unresolvedRows : 0);
  return { results, unresolvedRows };
}

export const countResults = (results) => ({
  cards: results.length,
  copies: results.reduce((sum, result) => sum + result.organized, 0),
});

const GROUP_KEYS = { identity: (card) => [identityLabel(card)], 'creature-type': creatureTypes };
export const GROUP_BY_CHOICES = Object.keys(GROUP_KEYS);

// Distinct cards and Organized copies per group, largest first. A card counts once in each of its groups.
export function groupResults(results, by) {
  if (!Object.hasOwn(GROUP_KEYS, by)) throw new Error(`--group-by must be one of: ${GROUP_BY_CHOICES.join(', ')}`);
  const groups = new Map();
  for (const { card, organized } of results) {
    for (const key of GROUP_KEYS[by](card)) {
      const group = groups.get(key) ?? { key, cards: 0, copies: 0 };
      group.cards += 1;
      group.copies += organized;
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort(
    (first, second) => second.cards - first.cards || first.key.localeCompare(second.key),
  );
}
