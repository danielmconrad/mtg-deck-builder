import { resolveEntries } from './deck.mjs';

const CARD_TYPES = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Land'];
const MANA_SYMBOLS = ['W', 'U', 'B', 'R', 'G', 'C'];
const CURVE_CAP = 7;

const increment = (counts, key, amount) => counts.set(key, (counts.get(key) ?? 0) + amount);

// Pips per color in a mana cost; hybrid and Phyrexian symbols count toward each color they name.
function pips(manaCost) {
  const counts = new Map();
  for (const [, symbol] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    for (const color of MANA_SYMBOLS) if (symbol.split('/').includes(color)) increment(counts, color, 1);
  }
  return counts;
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
    for (const type of CARD_TYPES) if (card.front_type.includes(type)) increment(stats.types, type, quantity);
    if (card.front_type.includes('Land')) {
      stats.lands += quantity;
      for (const color of card.produced_mana) increment(stats.landSources, color, quantity);
      continue;
    }
    stats.nonlandManaValue += card.cmc * quantity;
    increment(stats.curve, Math.min(Math.floor(card.cmc), CURVE_CAP), quantity);
    for (const [color, count] of pips(card.mana_cost)) increment(stats.pips, color, count * quantity);
  }
  for (const entry of deck.mainboard) {
    for (const role of (entry.role ?? '').split(',').map((label) => label.trim()).filter(Boolean)) {
      increment(stats.roles, role, entry.quantity);
    }
  }
  return stats;
}

export function formatStats(deck, stats) {
  const nonland = stats.cards - stats.lands;
  const list = (counts, order) => {
    const keys = order ? order.filter((key) => counts.has(key)) : [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    return keys.map((key) => `${key} ${counts.get(key)}`).join(', ') || 'none';
  };
  const curve = Array.from({ length: CURVE_CAP + 1 }, (_, mv) => `${mv === CURVE_CAP ? `${CURVE_CAP}+` : mv}:${stats.curve.get(mv) ?? 0}`);
  const commanders = deck.commanders.map((entry) => entry.name).join(' + ');
  return [
    `${deck.name}: ${stats.cards} mainboard cards${commanders ? ` + commander ${commanders}` : ''}`,
    `Lands: ${stats.lands}; nonland average mana value: ${nonland ? (stats.nonlandManaValue / nonland).toFixed(2) : 'n/a'}`,
    `Curve (nonland): ${curve.join(' ')}`,
    `Types: ${list(stats.types, CARD_TYPES)}`,
    `Color pips (nonland): ${list(stats.pips, MANA_SYMBOLS)}`,
    `Land color sources: ${list(stats.landSources, MANA_SYMBOLS)}`,
    `Roles: ${list(stats.roles)}`,
  ];
}
