import { isLand } from './card.mjs';
import { resolveEntries } from './deck.mjs';

export const CARD_TYPES = [
  'Creature',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Land',
];
export const MANA_SYMBOLS = ['W', 'U', 'B', 'R', 'G', 'C'];
export const CURVE_TOP_BUCKET = 7;

const increment = (counts, key, amount) => counts.set(key, (counts.get(key) ?? 0) + amount);

// Pips per color in a mana cost; hybrid and Phyrexian symbols count toward each color they name.
function pips(manaCost) {
  const counts = new Map();
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    for (const color of MANA_SYMBOLS) if (symbol.split('/').includes(color)) increment(counts, color, 1);
  }
  return counts;
}

const roleLabels = (entry) =>
  (entry.role ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

// Mainboard shape only; commanders sit in the command zone and are reported separately.
export function deckStats(deck, index) {
  const { tallies, problems } = resolveEntries(deck.mainboard, index);
  const stats = {
    cards: 0,
    lands: 0,
    nonlandManaValue: 0,
    curve: new Map(),
    types: new Map(),
    pips: new Map(),
    landSources: new Map(),
    roles: new Map(),
    problems,
  };
  for (const { card, quantity } of tallies.values()) {
    stats.cards += quantity;
    for (const type of CARD_TYPES) if (card.frontType.includes(type)) increment(stats.types, type, quantity);
    if (isLand(card)) {
      stats.lands += quantity;
      for (const color of card.producedMana) increment(stats.landSources, color, quantity);
      continue;
    }
    stats.nonlandManaValue += card.manaValue * quantity;
    increment(stats.curve, Math.min(Math.floor(card.manaValue), CURVE_TOP_BUCKET), quantity);
    for (const [color, count] of pips(card.manaCost)) increment(stats.pips, color, count * quantity);
  }
  for (const entry of deck.mainboard) {
    for (const role of roleLabels(entry)) increment(stats.roles, role, entry.quantity);
  }
  return stats;
}
