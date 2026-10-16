// Turns reports into the text the CLI prints. Nothing here decides an outcome.
import { identityLabel, orderedIdentity } from './card.mjs';
import { CARD_TYPES, CURVE_TOP_BUCKET, MANA_SYMBOLS } from './stats.mjs';
import { CENTS_PER_UNIT, PRICE_MAX_AGE_DAYS } from './upgrades.mjs';

const OUTCOME_LABELS = { pass: 'PASS', incomplete: 'INCOMPLETE', fail: 'FAIL' };
const LEVEL_LABELS = { error: 'ERROR', incomplete: 'INCOMPLETE', note: 'NOTE' };
const BUDGET_LABELS = { pass: 'WITHIN BUDGET', fail: 'OVER BUDGET', incomplete: 'INCOMPLETE: known prices total' };

const money = (cents, currency) => `${(cents / CENTS_PER_UNIT).toFixed(2)} ${currency}`;
const indent = (line) => `  ${line}`;

export const collectionSummaryLine = (name, { rowCount, copies, distinctNames, proxyCopies }) =>
  `${name}: ${rowCount} rows, ${copies} copies, ${distinctNames} distinct names, ${proxyCopies} proxy copies`;

export function checkLines(slug, { total, findings, outcome }) {
  const ordered = Object.keys(LEVEL_LABELS).flatMap((level) => findings.filter((item) => item.level === level));
  return [
    `${OUTCOME_LABELS[outcome]}: ${slug} (${total} cards)`,
    ...ordered.map(({ level, message }) => indent(`${LEVEL_LABELS[level]}: ${message}`)),
  ];
}

export function searchLines(results, { withOracleText = false } = {}) {
  const lines = results.flatMap(({ card, organized, precons }) => {
    const preconNote = precons ? ` (+${precons} in Precons)` : '';
    const summary = `${organized}x ${card.name} ${card.manaCost} — ${card.typeLine} [${identityLabel(card)}]${preconNote}`;
    const rulesText = withOracleText ? card.oracleText.split('\n').map((line) => `    ${line}`) : [];
    return [summary, ...rulesText];
  });
  return [...lines, `${results.length} cards`];
}

// JSON keeps snake_case to match the deck YAML that assistants read and write.
export const searchJson = (results) =>
  JSON.stringify(
    results.map(({ card, organized, precons }) => ({
      name: card.name,
      organized,
      precons,
      mana_cost: card.manaCost,
      mana_value: card.manaValue,
      type_line: card.typeLine,
      color_identity: orderedIdentity(card),
      oracle_text: card.oracleText,
    })),
    null,
    2,
  );

function countList(counts, order) {
  const keys = order
    ? order.filter((key) => counts.has(key))
    : [...counts.keys()].sort((first, second) => counts.get(second) - counts.get(first));
  return keys.map((key) => `${key} ${counts.get(key)}`).join(', ') || 'none';
}

export function statsLines(deck, stats) {
  const nonlandCards = stats.cards - stats.lands;
  const averageManaValue = nonlandCards ? (stats.nonlandManaValue / nonlandCards).toFixed(2) : 'n/a';
  const curve = Array.from({ length: CURVE_TOP_BUCKET + 1 }, (_, manaValue) => {
    const label = manaValue === CURVE_TOP_BUCKET ? `${manaValue}+` : manaValue;
    return `${label}:${stats.curve.get(manaValue) ?? 0}`;
  });
  const commanders = deck.commanders.map((entry) => entry.name).join(' + ');
  return [
    `${deck.name}: ${stats.cards} mainboard cards${commanders ? ` + commander ${commanders}` : ''}`,
    `Lands: ${stats.lands}; nonland average mana value: ${averageManaValue}`,
    `Curve (nonland): ${curve.join(' ')}`,
    `Types: ${countList(stats.types, CARD_TYPES)}`,
    `Color pips (nonland): ${countList(stats.pips, MANA_SYMBOLS)}`,
    `Land color sources: ${countList(stats.landSources, MANA_SYMBOLS)}`,
    `Roles: ${countList(stats.roles)}`,
    ...stats.problems.map((problem) => indent(`INCOMPLETE: ${problem}`)),
  ];
}

function purchaseLine({ card, quantity, unitCents, printing, problem }, currency) {
  if (problem) return `${card.name}: buy ${quantity}, price unknown (${problem})`;
  const printingLabel = `${printing.set.toUpperCase()} #${printing.collectorNumber}`;
  return `${card.name}: buy ${quantity} × ${money(unitCents, currency)} (${printingLabel}) = ${money(quantity * unitCents, currency)}`;
}

export function upgradeLines({ currency, purchases, problems, unresolvedRows, totalCents, budgetCents, outcome }) {
  const unresolvedNote = unresolvedRows
    ? [`${unresolvedRows} Organized rows have no cached card data; purchase quantities may be overstated`]
    : [];
  return [
    `Cards Organized cannot supply, priced at the cheapest cached Scryfall nonfoil ${currency} quote under ${PRICE_MAX_AGE_DAYS} days old. Excludes shipping and tax.`,
    ...[...problems, ...unresolvedNote, ...purchases.map((purchase) => purchaseLine(purchase, currency))].map(indent),
    `${BUDGET_LABELS[outcome]}: ${money(totalCents, currency)} of ${money(budgetCents, currency)} budget`,
  ];
}

export const countLine = ({ cards, copies }) => `${cards} cards, ${copies} copies in Organized`;

export function groupLines(groups) {
  const width = Math.max(0, ...groups.map(({ cards }) => String(cards).length));
  const lines = groups.map(({ key, cards, copies }) => `${String(cards).padStart(width)}  ${key} (${copies} copies)`);
  return [...lines, `${groups.length} groups; counts are distinct cards`];
}
