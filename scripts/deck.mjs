import Ajv from 'ajv';
import { parseDocument, stringify } from 'yaml';
import schema from '../schemas/deck.schema.json' with { type: 'json' };
import { normalizeName } from './card.mjs';

// Deck objects mirror the YAML document, so they keep its snake_case field names.

const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);
const MAX_YAML_ALIASES = 50;
const EDITOR_SCHEMA_DIRECTIVE = '# yaml-language-server: $schema=../../schemas/deck.schema.json';
const STRATEGY_PLACEHOLDER = 'Describe the game plan.';

export const deckEntries = (deck) => [...deck.commanders, ...deck.mainboard];

export function parseDeck(text, source = 'deck') {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${source}: ${document.errors.map((error) => error.message).join('; ')}`);
  const deck = document.toJS({ maxAliasCount: MAX_YAML_ALIASES });
  if (!validateSchema(deck)) {
    throw new Error(
      `${source}: ${validateSchema.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`,
    );
  }
  return deck;
}

export const serializeDeck = (deck) => `${EDITOR_SCHEMA_DIRECTIVE}\n${stringify(deck)}`;

const titleFromSlug = (slug) =>
  slug
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

export function newDeck(slug, { format = 'commander', commanderNames = [], name = titleFromSlug(slug) } = {}) {
  if (format === 'commander' && !commanderNames.length) {
    throw new Error('Commander decks need --commander "<name>" (repeat it for a partner pair)');
  }
  const deck = {
    schema_version: 1,
    name,
    format,
    status: 'draft',
    allow_proxies: false,
    unlimited_basics: false,
    strategy: STRATEGY_PLACEHOLDER,
    commanders: commanderNames.map((commanderName) => ({ name: commanderName, quantity: 1 })),
    mainboard: [],
    upgrades: [],
    playtests: [],
  };
  parseDeck(serializeDeck(deck), `new deck ${slug}`);
  return deck;
}

// The deck as it would be with every upgrade swap made. Each add takes its cut's place in the list.
export function applyUpgrades(deck) {
  let mainboard = deck.mainboard.map((entry) => ({ ...entry }));
  const findEntry = (name) => mainboard.find((entry) => normalizeName(entry.name) === normalizeName(name));
  for (const { add, cut } of deck.upgrades ?? []) {
    const target = findEntry(cut.name);
    if (!target || target.quantity < cut.quantity) {
      throw new Error(`Upgrade cuts ${cut.quantity} ${cut.name}, but the mainboard has ${target?.quantity ?? 0}`);
    }
    target.quantity -= cut.quantity;
    const existing = findEntry(add.name);
    if (existing) existing.quantity += add.quantity;
    else mainboard.splice(mainboard.indexOf(target) + 1, 0, { ...add });
    mainboard = mainboard.filter((entry) => entry.quantity > 0);
  }
  return { ...deck, mainboard };
}

// A card entry's role field holds comma-separated labels, e.g. "ramp, draw".
export const roleLabels = (entry) =>
  (entry.role ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

// A tally is every copy of one card in a list, keyed by oracle ID so printings merge.
// printingId records a scryfall_id the deck pinned, which pricing honors.
export function addCopies(tallies, card, quantity, printingId) {
  const tally = tallies.get(card.oracleId) ?? { card, quantity: 0, printingId: undefined };
  tally.quantity += quantity;
  tally.printingId ??= printingId;
  tallies.set(card.oracleId, tally);
}

export function removeCopies(tallies, card, quantity) {
  const tally = tallies.get(card.oracleId);
  if ((tally?.quantity ?? 0) < quantity) {
    throw new Error(`${card.name}: cannot remove ${quantity}; the list has ${tally?.quantity ?? 0}`);
  }
  tally.quantity -= quantity;
}

export function resolveEntries(entries, index) {
  const tallies = new Map();
  const problems = [];
  for (const entry of entries) {
    const { card, problem } = index.lookup(entry);
    if (problem) problems.push(problem);
    else addCopies(tallies, card, entry.quantity, entry.scryfall_id);
  }
  return { tallies, problems };
}
