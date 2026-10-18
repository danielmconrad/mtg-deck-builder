import Ajv from 'ajv';
import { parseDocument, stringify } from 'yaml';
import schema from '../schemas/deck.schema.json' with { type: 'json' };
import { normalizeName } from './card.mjs';

// Deck objects mirror the YAML document, so they keep its snake_case field names.

const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);
const MAX_YAML_ALIASES = 50;
// The editor schema path is relative to the deck file; the default fits decks/<slug>/deck.yaml.
const DEFAULT_SCHEMA_PATH = '../../schemas/deck.schema.json';
const PRIMER_PLACEHOLDER = 'Describe the game plan.';

// Formats played with commanders, and their exact deck size including the commanders.
export const COMMANDER_DECK_SIZES = { commander: 100, 'commander-60': 60 };
export const isCommanderFormat = (format) => Object.hasOwn(COMMANDER_DECK_SIZES, format);

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

export const serializeDeck = (deck, { schemaPath = DEFAULT_SCHEMA_PATH } = {}) =>
  `# yaml-language-server: $schema=${schemaPath}\n${stringify(deck, { lineWidth: 0 })}`;

// A nested slug (brad/green-value) is titled from its last part.
const titleFromSlug = (slug) =>
  slug
    .split('/')
    .at(-1)
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

export function newDeck(slug, { format = 'commander', commanderNames = [], name = titleFromSlug(slug) } = {}) {
  if (isCommanderFormat(format) && !commanderNames.length) {
    throw new Error('Commander decks need --commander "<name>" (repeat it for a partner pair)');
  }
  const deck = {
    schema_version: 1,
    name,
    format,
    status: 'draft',
    allow_proxies: false,
    unlimited_basics: false,
    primer: PRIMER_PLACEHOLDER,
    commanders: commanderNames.map((commanderName) => ({ name: commanderName, quantity: 1 })),
    mainboard: [],
    upgrades: [],
    playtests: [],
  };
  parseDeck(serializeDeck(deck), `new deck ${slug}`);
  return deck;
}

const findEntry = (entries, name) => entries.find((entry) => normalizeName(entry.name) === normalizeName(name));

// Takes a swap's cut out of a copied mainboard and returns the entry it came from.
function takeCut(mainboard, cut) {
  const target = findEntry(mainboard, cut.name);
  if (!target || target.quantity < cut.quantity) {
    throw new Error(`Upgrade cuts ${cut.quantity} ${cut.name}, but the mainboard has ${target?.quantity ?? 0}`);
  }
  target.quantity -= cut.quantity;
  return target;
}

// The deck as it would be with every upgrade swap made. The added cards are kept apart in
// upgradesIn, still part of the deck, so exports can show them in their own section for buying.
// A later swap may cut an earlier add.
export function applyUpgrades(deck) {
  let mainboard = deck.mainboard.map((entry) => ({ ...entry }));
  let upgradesIn = [];
  for (const { add, cut } of deck.upgrades ?? []) {
    takeCut(findEntry(mainboard, cut.name) ? mainboard : upgradesIn, cut);
    const existing = findEntry(upgradesIn, add.name);
    if (existing) existing.quantity += add.quantity;
    else upgradesIn.push({ ...add });
    mainboard = mainboard.filter((entry) => entry.quantity > 0);
    upgradesIn = upgradesIn.filter((entry) => entry.quantity > 0);
  }
  return { ...deck, mainboard, upgradesIn };
}

// The baseline deck split for review: swapOut holds the copies the upgrades would cut, keeping
// their roles, and sideboard holds the cards the upgrades would add.
export function splitUpgrades(deck) {
  const mainboard = deck.mainboard.map((entry) => ({ ...entry }));
  const swapOut = [];
  for (const { cut } of deck.upgrades ?? []) {
    const target = takeCut(mainboard, cut);
    const existing = findEntry(swapOut, cut.name);
    if (existing) existing.quantity += cut.quantity;
    else swapOut.push({ ...target, quantity: cut.quantity });
  }
  return {
    ...deck,
    mainboard: mainboard.filter((entry) => entry.quantity > 0),
    swapOut,
    sideboard: (deck.upgrades ?? []).map(({ add }) => ({ ...add })),
  };
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
