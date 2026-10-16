import { isLand } from './card.mjs';
import { resolveEntries, roleLabels } from './deck.mjs';

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
export const CHEAP_MANA_VALUE = 2;
const CHEAP_ROLES = ['ramp', 'draw'];

// Frank Karsten's regression on winning decklists ("How Many Lands Do You Need in Your Deck? An Updated
// Analysis", ChannelFireball). Each cheap ramp or draw spell replaces about 0.28 lands; the Commander
// version scales the 60-card fit to 99 cards and credits the free mulligan and the commander.
export function suggestedLands({ format, commanderCount, averageManaValue, cheapRampAndDraw }) {
  const cheapCredit = 0.28 * cheapRampAndDraw;
  if (format !== 'commander') return 19.59 + 1.9 * averageManaValue - cheapCredit;
  const scale = (100 - commanderCount) / 60;
  return scale * (19.59 + 1.9 * averageManaValue + 0.27 * commanderCount) - cheapCredit - 1.35;
}

const increment = (counts, key, amount) => counts.set(key, (counts.get(key) ?? 0) + amount);

// Pips per color in a mana cost; hybrid and Phyrexian symbols count toward each color they name.
function pips(manaCost) {
  const counts = new Map();
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    for (const color of MANA_SYMBOLS) if (symbol.split('/').includes(color)) increment(counts, color, 1);
  }
  return counts;
}

// Nonland mainboard cards with role ramp or draw at mana value 2 or less: Karsten's "cheap" spells.
function countCheapRampAndDraw(entries, index) {
  let count = 0;
  for (const entry of entries) {
    const { card } = index.lookup(entry);
    const isCheapSpell = card && !isLand(card) && card.manaValue <= CHEAP_MANA_VALUE;
    if (isCheapSpell && roleLabels(entry).some((role) => CHEAP_ROLES.includes(role))) count += entry.quantity;
  }
  return count;
}

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
  stats.cheapRampAndDraw = countCheapRampAndDraw(deck.mainboard, index);
  const nonlandCards = stats.cards - stats.lands;
  stats.averageManaValue = nonlandCards ? stats.nonlandManaValue / nonlandCards : 0;
  stats.suggestedLands = nonlandCards
    ? suggestedLands({ ...stats, format: deck.format, commanderCount: deck.commanders.length })
    : null;
  return stats;
}
