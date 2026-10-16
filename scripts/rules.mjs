import { ageInDays, hasCommanderText, isBackground, isBasic, isLegendaryCreature } from './card.mjs';
import { availableCopies, holdingsNote, ownedCounts, protectedHoldings } from './collection.mjs';
import { deckEntries, resolveEntries } from './deck.mjs';

const RULES_WARN_AGE_DAYS = 30;
const COMMANDER_DECK_SIZE = 100;
const CASUAL_MIN_DECK_SIZE = 60;
const DEFAULT_COPY_LIMIT = { commander: 1, 'casual-60': 4 };
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ANY_NUMBER_TEXT = /A deck can have any number of cards named /i;
const UP_TO_TEXT = /A deck can have up to (\w+) cards named /i;
const CUSTOM_LIMIT_TEXT = /A deck can have /i;

// A finding is one line of check output; its level decides the outcome.
const finding = (level) => (message) => ({ level, message });
const error = finding('error');
const incomplete = finding('incomplete');
const note = finding('note');

// Failures outrank unknowns: a deck with both still fails.
const OUTCOME_SEVERITY = ['pass', 'incomplete', 'fail'];

function outcomeOf(findings) {
  if (findings.some(({ level }) => level === 'error')) return 'fail';
  if (findings.some(({ level }) => level === 'incomplete')) return 'incomplete';
  return 'pass';
}

export const worstOutcome = (outcomes) =>
  outcomes.reduce(
    (worst, outcome) => (OUTCOME_SEVERITY.indexOf(outcome) > OUTCOME_SEVERITY.indexOf(worst) ? outcome : worst),
    'pass',
  );

// Returns the most copies allowed, or null when the card prints a rule this checker doesn't parse.
function copyLimit(card, format) {
  if (isBasic(card) || ANY_NUMBER_TEXT.test(card.oracleText)) return Infinity;
  const upTo = card.oracleText.match(UP_TO_TEXT);
  if (upTo) return NUMBER_WORDS[upTo[1].toLowerCase()] ?? Number(upTo[1]);
  if (CUSTOM_LIMIT_TEXT.test(card.oracleText)) return null;
  return DEFAULT_COPY_LIMIT[format];
}

function sizeFindings(format, total) {
  if (format === 'commander' && total !== COMMANDER_DECK_SIZE) {
    return [error(`Commander requires ${COMMANDER_DECK_SIZE} cards including commanders; found ${total}`)];
  }
  if (format === 'casual-60' && total < CASUAL_MIN_DECK_SIZE) {
    return [error(`Casual requires at least ${CASUAL_MIN_DECK_SIZE} cards; found ${total}`)];
  }
  return [];
}

const hasKeyword = (card, keyword) => card.keywords.includes(keyword);
const isTimeLordDoctor = (card) => /Time Lord Doctor$/.test(card.frontType);
const hasPlainPartner = (card) => /^Partner(?:\s*\(|\s*$)/m.test(card.oracleText);
const partnersWith = (card, other) => card.oracleText.includes(`Partner with ${other.name}`);
const leadsPairWith = (leader, other) =>
  (hasKeyword(leader, 'Choose a Background') && isBackground(other)) ||
  (hasKeyword(leader, "Doctor's companion") && isTimeLordDoctor(other));

function isRecognizedPairing(first, second) {
  return (
    (hasPlainPartner(first) && hasPlainPartner(second)) ||
    (hasKeyword(first, 'Friends forever') && hasKeyword(second, 'Friends forever')) ||
    (partnersWith(first, second) && partnersWith(second, first)) ||
    leadsPairWith(first, second) ||
    leadsPairWith(second, first)
  );
}

// A Background is only eligible as the second half of a pair.
function isEligibleCommander(card, commanderCount) {
  const isPairedBackground = commanderCount === 2 && isBackground(card);
  return isLegendaryCreature(card) || isPairedBackground || hasCommanderText(card);
}

function commanderFindings(commanders) {
  const findings = commanders
    .filter((card) => !isEligibleCommander(card, commanders.length))
    .map((card) => error(`${card.name}: not an eligible commander`));
  if (commanders.length !== 2) return findings;
  const [first, second] = commanders;
  if (first.oracleId === second.oracleId) return [...findings, error('Two commanders must be different cards')];
  if (!isRecognizedPairing(first, second)) {
    return [...findings, incomplete(`${first.name} + ${second.name}: pairing not recognized; verify it manually`)];
  }
  return findings;
}

function copyLimitFindings({ card, quantity }, format) {
  const limit = copyLimit(card, format);
  if (limit === null) return [incomplete(`${card.name}: unusual copy-limit text; verify manually`)];
  if (quantity > limit) return [error(`${card.name}: ${quantity} copies exceeds limit ${limit}`)];
  return [];
}

function commanderLegalityFindings(card, identity) {
  const legality = card.legalities.commander;
  const findings = [];
  if (!legality) findings.push(incomplete(`${card.name}: Commander legality unknown`));
  else if (legality !== 'legal') findings.push(error(`${card.name}: ${legality} in Commander`));
  if (identity && card.colorIdentity.some((color) => !identity.has(color))) {
    findings.push(error(`${card.name}: outside commander color identity`));
  }
  return findings;
}

function ownershipFindings(tallies, collections, index, deck) {
  const policy = { allowProxies: deck.allow_proxies };
  const owned = ownedCounts(collections.available, index, policy);
  const holdings = protectedHoldings(collections.protected, index, policy);
  const findings = owned.unresolvedRows
    ? [
        incomplete(
          `${owned.unresolvedRows} available collection rows have no cached card data; ownership may be understated (run cards:refresh)`,
        ),
      ]
    : [];
  for (const { card, quantity } of tallies.values()) {
    const available = availableCopies(owned, card, { unlimitedBasics: deck.unlimited_basics });
    if (quantity <= available) continue;
    const protectedNote = holdings.has(card.oracleId)
      ? `; ${holdingsNote(holdings.get(card.oracleId))} (protected)`
      : '';
    findings.push(
      error(`${card.name}: need ${quantity}, ${available} available (short ${quantity - available})${protectedNote}`),
    );
  }
  return findings;
}

// Wizards' Commander Brackets (beta; definitions from October 2025): Game Changers allowed per bracket.
const GAME_CHANGER_LIMITS = { 1: 0, 2: 0, 3: 3, 4: Infinity, 5: Infinity };

function gameChangerFindings(tallies, bracket) {
  const names = [...tallies.values()].filter(({ card }) => card.gameChanger).map(({ card }) => card.name);
  const list = `${names.length} Game Changers${names.length ? `: ${names.join(', ')}` : ''}`;
  if (bracket === undefined) {
    return names.length ? [note(`${list} (Brackets 1-2 allow none, Bracket 3 up to 3; set bracket to enforce)`)] : [];
  }
  const limit = GAME_CHANGER_LIMITS[bracket];
  if (names.length <= limit) return [];
  // Bracket 1 lets a playgroup agree on thematic exceptions before the game, so it's a judgment call.
  if (bracket === 1) {
    return [incomplete(`${list}; Bracket 1 allows none unless your playgroup agrees to a thematic exception`)];
  }
  return [error(`${list}; Bracket ${bracket} allows ${limit === 0 ? 'none' : `up to ${limit}`}`)];
}

function freshnessFindings(tallies, now) {
  const oldestDays = Math.max(0, ...[...tallies.values()].map(({ card }) => ageInDays(card, now)));
  if (oldestDays <= RULES_WARN_AGE_DAYS) return [];
  return [note(`Card data is ${Math.floor(oldestDays)} days old; run cards:refresh to pick up recent bans and errata`)];
}

const uniqueFindings = (findings) => [
  ...new Map(findings.map((item) => [`${item.level}:${item.message}`, item])).values(),
];

export function checkDeck(deck, collections, index, { now = Date.now() } = {}) {
  const entries = deckEntries(deck);
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const { tallies, problems } = resolveEntries(entries, index);
  const commanders = deck.commanders.map((entry) => index.lookup(entry).card).filter(Boolean);
  const isCommanderFormat = deck.format === 'commander';
  const identity =
    isCommanderFormat && commanders.length === deck.commanders.length
      ? new Set(commanders.flatMap((card) => card.colorIdentity))
      : null;
  const cardFindings = [...tallies.values()].flatMap((tally) => [
    ...copyLimitFindings(tally, deck.format),
    ...(isCommanderFormat ? commanderLegalityFindings(tally.card, identity) : []),
  ]);
  const findings = uniqueFindings([
    ...problems.map(incomplete),
    ...sizeFindings(deck.format, total),
    ...commanderFindings(commanders),
    ...cardFindings,
    ...ownershipFindings(tallies, collections, index, deck),
    ...(isCommanderFormat ? gameChangerFindings(tallies, deck.bracket) : []),
    ...freshnessFindings(tallies, now),
  ]);
  return { total, findings, outcome: outcomeOf(findings) };
}
