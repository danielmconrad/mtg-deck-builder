import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { parseDocument } from 'yaml';
import { DAY_MS, RULES_WARN_AGE_MS, quote } from './cards.mjs';
import { ownedCounts } from './collection.mjs';

const schema = JSON.parse(await readFile(new URL('../schemas/deck.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export const deckEntries = (deck) => [...deck.commanders, ...deck.mainboard];
export const isBasic = (card) => /\bBasic\b/.test(card.front_type);

export function parseDeck(text, source = 'deck') {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${source}: ${document.errors.map((error) => error.message).join('; ')}`);
  const deck = document.toJS({ maxAliasCount: 50 });
  if (!validateSchema(deck)) {
    throw new Error(`${source}: ${validateSchema.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
  }
  return deck;
}

// Resolves entries and merges copies of the same card, whatever the printing, by oracle ID.
export function resolveEntries(entries, index) {
  const tallies = new Map();
  const problems = [];
  for (const entry of entries) {
    const { card, problem } = index.lookup(entry);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const tally = tallies.get(card.oracle_id) ?? { card, quantity: 0 };
    tally.quantity += entry.quantity;
    tallies.set(card.oracle_id, tally);
  }
  return { tallies, problems };
}

function copyLimit(card, format) {
  if (isBasic(card) || /A deck can have any number of cards named /i.test(card.oracle_text)) return Infinity;
  const match = card.oracle_text.match(/A deck can have up to (\w+) cards named /i);
  if (match) return NUMBER_WORDS[match[1].toLowerCase()] ?? Number(match[1]);
  if (/A deck can have /i.test(card.oracle_text)) return NaN;
  return format === 'commander' ? 1 : 4;
}

function checkSize(deck, total, report) {
  if (deck.format === 'commander' && total !== 100) report.errors.push(`Commander requires 100 cards including commanders; found ${total}`);
  if (deck.format === 'casual-60' && total < 60) report.errors.push(`Casual requires at least 60 cards; found ${total}`);
}

function isPairing(first, second) {
  const hasKeyword = (card, keyword) => card.keywords.includes(keyword);
  const isBackground = (card) => card.front_type.includes('Background');
  const isDoctor = (card) => /Time Lord Doctor$/.test(card.front_type);
  const genericPartner = (card) => /^Partner(?:\s*\(|\s*$)/m.test(card.oracle_text);
  const partnersWith = (card, other) => card.oracle_text.includes(`Partner with ${other.name}`);
  const oneWay = (card, other) => (hasKeyword(card, 'Choose a Background') && isBackground(other))
    || (hasKeyword(card, "Doctor's companion") && isDoctor(other));
  return (genericPartner(first) && genericPartner(second))
    || (hasKeyword(first, 'Friends forever') && hasKeyword(second, 'Friends forever'))
    || (partnersWith(first, second) && partnersWith(second, first))
    || oneWay(first, second) || oneWay(second, first);
}

function checkCommanders(commanders, report) {
  for (const card of commanders) {
    const legendaryCreature = card.front_type.includes('Legendary') && card.front_type.includes('Creature');
    const pairedBackground = commanders.length === 2 && card.front_type.includes('Background');
    if (!legendaryCreature && !pairedBackground && !card.oracle_text.includes('can be your commander')) {
      report.errors.push(`${card.name}: not an eligible commander`);
    }
  }
  if (commanders.length !== 2) return;
  const [first, second] = commanders;
  if (first.oracle_id === second.oracle_id) report.errors.push('Two commanders must be different cards');
  else if (!isPairing(first, second)) report.incomplete.push(`${first.name} + ${second.name}: pairing not recognized; verify it manually`);
}

function checkCardRules({ card, quantity }, deck, identity, report) {
  const limit = copyLimit(card, deck.format);
  if (Number.isNaN(limit)) report.incomplete.push(`${card.name}: unusual copy-limit text; verify manually`);
  else if (quantity > limit) report.errors.push(`${card.name}: ${quantity} copies exceeds limit ${limit}`);
  if (deck.format !== 'commander') return;
  const legality = card.legalities.commander;
  if (!legality) report.incomplete.push(`${card.name}: Commander legality unknown`);
  else if (legality !== 'legal') report.errors.push(`${card.name}: ${legality} in Commander`);
  if (identity && card.color_identity.some((color) => !identity.has(color))) {
    report.errors.push(`${card.name}: outside commander color identity`);
  }
}

function checkOwnership(tallies, collections, index, deck, report) {
  const organized = ownedCounts(collections.organized, index, deck.allow_proxies);
  const precons = ownedCounts(collections.precons, index, deck.allow_proxies);
  if (organized.unresolved) {
    report.incomplete.push(`${organized.unresolved} Organized rows have no cached card data; ownership may be understated (run cards:refresh)`);
  }
  for (const { card, quantity } of tallies.values()) {
    if (deck.unlimited_basics && isBasic(card)) continue;
    const available = organized.counts.get(card.oracle_id) ?? 0;
    if (quantity <= available) continue;
    const protectedCopies = precons.counts.get(card.oracle_id) ?? 0;
    const precon = protectedCopies ? `; ${protectedCopies} in Precons (protected)` : '';
    report.errors.push(`${card.name}: need ${quantity}, Organized has ${available} (short ${quantity - available})${precon}`);
  }
}

function checkFreshness(tallies, now, report) {
  const oldest = Math.min(...[...tallies.values()].map(({ card }) => Date.parse(card.fetched_at)));
  if (now - oldest > RULES_WARN_AGE_MS) {
    report.warnings.push(`Card data is ${Math.floor((now - oldest) / DAY_MS)} days old; run cards:refresh to pick up recent bans and errata`);
  }
}

export function checkDeck(deck, collections, index, { now = Date.now() } = {}) {
  const report = { errors: [], incomplete: [], warnings: [], total: 0 };
  const entries = deckEntries(deck);
  report.total = entries.reduce((total, entry) => total + entry.quantity, 0);
  const { tallies, problems } = resolveEntries(entries, index);
  report.incomplete.push(...problems);
  checkSize(deck, report.total, report);
  const commanders = deck.commanders.map((entry) => index.lookup(entry).card).filter(Boolean);
  const allCommandersKnown = commanders.length === deck.commanders.length;
  checkCommanders(commanders, report);
  const identity = deck.format === 'commander' && allCommandersKnown ? new Set(commanders.flatMap((card) => card.color_identity)) : null;
  for (const tally of tallies.values()) checkCardRules(tally, deck, identity, report);
  checkOwnership(tallies, collections, index, deck, report);
  checkFreshness(tallies, now, report);
  report.incomplete = [...new Set(report.incomplete)];
  return report;
}

export function exportDeck(deck) {
  const render = (cards) => cards.map((entry) => `${entry.quantity} ${entry.name}`).join('\n');
  return `${deck.commanders.length ? `Commander\n${render(deck.commanders)}\n\n` : ''}${render(deck.mainboard)}\n`;
}

// Applies the upgrade package to a copy of the list, then prices whatever Organized cannot supply.
export function upgradeReport(deck, collections, index, { now = Date.now() } = {}) {
  if (!deck.budget) throw new Error('Set budget.amount and budget.currency before estimating upgrades');
  const final = new Map();
  const lines = [];
  let complete = true;
  const add = (entry, sign) => {
    const { card, problem } = index.lookup(entry);
    if (problem) {
      lines.push(problem);
      complete = false;
      return;
    }
    const tally = final.get(card.oracle_id) ?? { card, quantity: 0 };
    tally.quantity += sign * entry.quantity;
    if (sign > 0 && entry.scryfall_id) tally.printingId = entry.scryfall_id;
    final.set(card.oracle_id, tally);
  };
  for (const entry of deckEntries(deck)) add(entry, 1);
  const cuttable = resolveEntries(deck.mainboard, index).tallies;
  for (const swap of deck.upgrades ?? []) {
    if (swap.add.quantity !== swap.cut.quantity) throw new Error(`${swap.add.name} for ${swap.cut.name}: add and cut quantities must match`);
    const cut = index.lookup(swap.cut).card;
    if (cut) {
      const remaining = cuttable.get(cut.oracle_id);
      if ((remaining?.quantity ?? 0) < swap.cut.quantity) throw new Error(`${cut.name}: upgrade cuts exceed baseline mainboard copies`);
      remaining.quantity -= swap.cut.quantity;
    }
    add(swap.cut, -1);
    add(swap.add, 1);
  }
  const { currency } = deck.budget;
  const organized = ownedCounts(collections.organized, index, deck.allow_proxies);
  if (organized.unresolved) {
    complete = false;
    lines.push(`${organized.unresolved} Organized rows have no cached card data; purchase quantities may be overstated`);
  }
  let cents = 0;
  const money = (value) => `${(value / 100).toFixed(2)} ${currency}`;
  for (const { card, quantity, printingId } of final.values()) {
    if (deck.unlimited_basics && isBasic(card)) continue;
    const needed = quantity - (organized.counts.get(card.oracle_id) ?? 0);
    if (needed <= 0) continue;
    const price = quote(index, card, { currency, printingId, now });
    if (price.problem) {
      complete = false;
      lines.push(`${card.name}: buy ${needed}, price unknown (${price.problem})`);
      continue;
    }
    cents += needed * price.cents;
    const printing = `${price.printing.set.toUpperCase()} #${price.printing.collector_number}`;
    lines.push(`${card.name}: buy ${needed} × ${money(price.cents)} (${printing}) = ${money(needed * price.cents)}`);
  }
  const budgetCents = Math.round(deck.budget.amount * 100);
  return { lines, totalCents: cents, budgetCents, complete, withinBudget: complete && cents <= budgetCents };
}
