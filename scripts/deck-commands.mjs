// The deck commands that read a deck or write its own files: deck:new, check, stats, show, export,
// files, verify, candidates and upgrades, and decks:check.
import { PRIMER_PLACEHOLDER, applyUpgrades, newDeck, splitUpgrades, withDeckValue } from './deck.mjs';
import { EXPORT_FORMAT_NAMES, PASTE_HINTS, exportDeck, moxfieldCardList, printingChooser } from './export.mjs';
import { candidateLines, checkLines, showLines, statsLines, upgradeLines, printAll } from './format.mjs';
import { candidatesJson, checkJson, showJson, upgradesJson, statsJson } from './json.mjs';
import { checkDeck, lowestLegalBracket, worstOutcome } from './rules.mjs';
import { deckCandidates } from './search.mjs';
import { deckListing, deckStats } from './stats.mjs';
import { upgradeReport } from './upgrades.mjs';
import { verifyDeck } from './verify.mjs';
import { patternList } from './options.mjs';
import { posix } from 'node:path';

// MTG_UNLIMITED_BASICS and MTG_ALLOW_PROXIES hold true or false; empty or unset means false.
function envFlag(env, name) {
  const value = env[name] || 'false';
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
}

// deck:new's header fields from the brief, each left out when its option isn't given.
function newDeckHeader(options) {
  const currency = options.currency ?? 'USD';
  const money = (flag) => (options[flag] === undefined ? undefined : { amount: options[flag], currency });
  return {
    primer: options.primer,
    target_bracket: options['target-bracket'],
    budget: money('budget'),
    max_card_price: money('max-card-price'),
    collection_source: options['collection-source'] ? patternList(options['collection-source']) : undefined,
  };
}

export async function deckNew({ workspace, slug, options, env, write, emit }) {
  const deck = newDeck(slug, {
    format: options.format,
    commanderNames: options.commander,
    name: options.name,
    allowProxies: options['allow-proxies'] ?? envFlag(env, 'MTG_ALLOW_PROXIES'),
    unlimitedBasics: options['unlimited-basics'] ?? envFlag(env, 'MTG_UNLIMITED_BASICS'),
    header: newDeckHeader(options),
  });
  const label = await workspace.createDeck(slug, deck);
  emit({ path: label, deck });
  const todo = [deck.primer === PRIMER_PLACEHOLDER && 'the primer', 'the mainboard'].filter(Boolean).join(' and ');
  write(
    `Created ${label} (allow_proxies: ${deck.allow_proxies}, unlimited_basics: ${deck.unlimited_basics}). Fill in ${todo} next.`,
  );
  return 'pass';
}

export async function deckCheck({ workspace, slug, now, write, emit }) {
  const deck = await workspace.loadDeck(slug);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const report = checkDeck(deck, collections, index, { now });
  emit(checkJson(report));
  printAll(write, checkLines(slug, report));
  return report.outcome;
}

// With --upgrades apply, the deck as it would be with every swap made.
export async function deckStatsCommand({ workspace, slug, options, write, emit }) {
  const [deck, index] = await Promise.all([workspace.loadDeck(slug), workspace.loadCardIndex()]);
  const upgraded = options.upgrades && applyUpgrades(deck);
  const measured = upgraded ? { ...upgraded, mainboard: [...upgraded.mainboard, ...upgraded.upgradesIn] } : deck;
  const stats = deckStats(measured, index);
  emit({ upgrades_applied: Boolean(upgraded), ...statsJson(stats) });
  printAll(write, statsLines(deck, stats, { upgradesApplied: Boolean(upgraded) }));
  return stats.problems.length ? 'incomplete' : 'pass';
}

// The deck's own cards with their rules text, so a review reads the list rather than recalling it.
export async function deckShow({ workspace, slug, options, write, emit }) {
  const [deck, index] = await Promise.all([workspace.loadDeck(slug), workspace.loadCardIndex()]);
  const listing = deckListing(withUpgrades(deck, options.upgrades), index, { role: options.role });
  emit(showJson(listing));
  printAll(write, showLines(listing, { withOracleText: options.oracle }));
  return listing.problems.length ? 'incomplete' : 'pass';
}

// --upgrades apply makes every swap; split keeps the deck, with cuts and adds in their own sections.
function withUpgrades(deck, mode) {
  if (mode === undefined) return deck;
  if (mode === 'apply') return applyUpgrades(deck);
  if (mode === 'split') return splitUpgrades(deck);
  throw new Error('--upgrades must be one of: apply, split');
}

// --format wins, then the MTG_EXPORT_FORMAT project default (see .env.example), then text. An empty
// MTG_EXPORT_FORMAT= line in .env means no default.
function exportFormat(options, env) {
  const format = options.format ?? (env.MTG_EXPORT_FORMAT || undefined) ?? 'text';
  if (!EXPORT_FORMAT_NAMES.includes(format)) {
    const source = options.format === undefined ? 'MTG_EXPORT_FORMAT' : '--format';
    throw new Error(`${source} must be one of: ${EXPORT_FORMAT_NAMES.join(', ')}`);
  }
  return format;
}

// Loads what every export needs once, then renders the deck under each requested upgrades mode. caveat
// warns that exporting doesn't validate, which deck:verify, a validation itself, leaves out.
async function exporter(workspace, slug, warn, { caveat = true } = {}) {
  const deck = await workspace.loadDeck(slug);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const uncached = new Set();
  const printingOf = printingChooser(index, collections.available, uncached);
  if (caveat) warn('Export does not validate the deck; run deck:check first.');
  const render = (format, upgradesMode) => exportDeck(withUpgrades(deck, upgradesMode), { format, printingOf });
  const warnUncached = () => {
    if (uncached.size) {
      warn(`Printings not cached, exported by name only: ${[...uncached].join(', ')} (run scryfall:refresh)`);
    }
  };
  const warnApplied = () =>
    warn(`Applied ${deck.upgrades.length} upgrade swaps; some added cards may not be owned yet.`);
  return { deck, collections, index, render, warnUncached, warnApplied };
}

export async function deckExport({ workspace, slug, options, env, write, warn, copyText }) {
  const format = exportFormat(options, env);
  const { deck, render, warnUncached, warnApplied } = await exporter(workspace, slug, warn);
  const text = render(format, options.upgrades);
  if (options.upgrades === 'apply' && deck.upgrades?.length) warnApplied();
  warnUncached();
  if (!options.copy) {
    write(text.trimEnd());
    return 'pass';
  }
  await copyText(text);
  write(`Copied ${slug} in ${format} format to the clipboard. ${PASTE_HINTS[format]}`);
  return 'pass';
}

// deck:files writes every format here, so the committed lists paste straight into either site.
export const DECKLIST_FORMATS = ['archidekt', 'moxfield'];
export const decklistFile = (format) => `decklist.${format}.txt`;
export const upgradedDecklistFile = (format) => `decklist-upgraded.${format}.txt`;
// Names deck:files used to write (a single format, then -format suffixes); removed so they can't go stale.
const LEGACY_DECKLIST_FILES = [
  'decklist.txt',
  'decklist-upgraded.txt',
  ...DECKLIST_FORMATS.flatMap((format) => [`decklist-${format}.txt`, `decklist-upgraded-${format}.txt`]),
];

// The decklists kept in Git beside deck.yaml, once per format: the deck with upgrade swaps split out,
// and, when the deck has upgrades, the deck with every swap made. Each file name maps to its text, or
// to null when the file must not exist.
function decklistFiles(deck, render) {
  const files = new Map();
  for (const format of DECKLIST_FORMATS) {
    files.set(decklistFile(format), render(format, 'split'));
    files.set(upgradedDecklistFile(format), deck.upgrades?.length ? render(format, 'apply') : null);
  }
  return files;
}

// deck.yaml's text with lowest_legal_bracket set from the cards (casual decks have none) and, when the
// card list changed, plays_like_bracket removed, since that judged the old list.
export function withBrackets(text, deck, index, { listChanged, source }) {
  const bracket = lowestLegalBracket(deck, index);
  const after = ['plays_like_bracket', 'target_bracket'].find((key) => deck[key] !== undefined) ?? 'status';
  const set = withDeckValue(text, 'lowest_legal_bracket', bracket, { after, source });
  const cleared = listChanged && deck.plays_like_bracket !== undefined;
  return { text: cleared ? withDeckValue(set, 'plays_like_bracket', undefined, { source }) : set, bracket, cleared };
}

// Writes withBrackets' result to the deck's deck.yaml when it changes anything.
async function recordBrackets(workspace, slug, deck, index, { listChanged }) {
  const { path, text } = await workspace.readDeckText(slug);
  const result = withBrackets(text, deck, index, { listChanged, source: path });
  if (result.text !== text) await workspace.commitFiles([{ path, text: result.text }]);
  return result;
}

export const bracketNote = ({ bracket, cleared }) =>
  [
    bracket === undefined ? '' : `; set lowest_legal_bracket: ${bracket}`,
    cleared ? ' and removed plays_like_bracket because the card list changed; judge it again' : '',
  ].join('');

// The committed Moxfield list is compared before it's overwritten, to tell whether the cards changed.
export async function deckFiles({ workspace, slug, warn, write, emit }) {
  const { deck, index, render, warnUncached } = await exporter(workspace, slug, warn);
  const files = decklistFiles(deck, render);
  const before = await workspace.readDeckFile(slug, decklistFile('moxfield'));
  const cardList = (text) => moxfieldCardList(text).join('\n');
  const listChanged = before === null || cardList(before) !== cardList(files.get(decklistFile('moxfield')));
  const written = [];
  const removed = [];
  for (const [file, text] of files) {
    if (text !== null) written.push(await workspace.writeDeckFile(slug, file, text));
    else if (await workspace.removeDeckFile(slug, file)) removed.push(file);
  }
  await Promise.all(LEGACY_DECKLIST_FILES.map((file) => workspace.removeDeckFile(slug, file)));
  warnUncached();
  const brackets = await recordBrackets(workspace, slug, deck, index, { listChanged });
  emit({
    written,
    removed,
    card_list_changed: listChanged,
    lowest_legal_bracket: brackets.bracket ?? null,
    plays_like_bracket_removed: brackets.cleared,
  });
  write(`Wrote ${written.join(', ')}${bracketNote(brackets)}.`);
  return 'pass';
}

export const CANDIDATE_LIMIT = 20;

// The hand-off gate: deck:check plus everything else a finished deck needs (see verify.mjs).
export async function deckVerifyCommand({ workspace, slug, options, now, write, warn, emit }) {
  const { deck, collections, index, render } = await exporter(workspace, slug, warn, { caveat: false });
  const expected = decklistFiles(deck, render);
  const actual = new Map(
    await Promise.all([...expected.keys()].map(async (file) => [file, await workspace.readDeckFile(slug, file)])),
  );
  const limit = options.limit ?? CANDIDATE_LIMIT;
  const report = verifyDeck({ deck, collections, index, limit, decklists: { expected, actual }, now });
  emit(checkJson(report));
  printAll(write, checkLines(slug, report));
  return report.outcome;
}

// The deck's most valued left-out cards, so a review explains each exclusion rather than missing one.
export async function deckCandidatesCommand({ workspace, slug, options, write, warn, emit }) {
  const deck = await workspace.loadDeck(slug);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const limit = options.limit ?? CANDIDATE_LIMIT;
  const { results, unresolvedRows, overCap } = deckCandidates(deck, collections, index, {
    texts: (options.text ?? []).map((source) => new RegExp(source, 'i')),
    types: (options.type ?? []).map((source) => new RegExp(source, 'i')),
    roles: options.role,
    lands: options.lands,
    sort: options.sort ?? 'edhrec',
  });
  if (results.length && results.every((result) => result.edhrecRank === null)) {
    warn('No EDHREC ranks cached yet; sorting falls back to price. Run scryfall:refresh to fetch them.');
  }
  emit(candidatesJson(results, { limit, overCap, unresolvedRows }));
  printAll(write, candidateLines(results, { limit, withOracleText: options.oracle, unresolvedRows, overCap }));
  return unresolvedRows ? 'incomplete' : 'pass';
}

export async function deckUpgrades({ workspace, slug, now, write, emit }) {
  const deck = await workspace.loadDeck(slug);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const report = upgradeReport(deck, collections, index, { now });
  emit(upgradesJson(report));
  printAll(write, upgradeLines(report));
  return report.outcome;
}

// --status and --decks narrow the decks checked. A deck file that doesn't parse has no status, so it's
// checked whenever its path matches.
function selectDecks(loadedDecks, options) {
  const patterns = options.decks ? patternList(options.decks) : [];
  return loadedDecks.filter(({ slug, deck }) => {
    if (patterns.length && !patterns.some((pattern) => posix.matchesGlob(slug, pattern))) return false;
    return !options.status || !deck || deck.status === options.status;
  });
}

export async function decksCheck({ workspace, options, now, write, emit }) {
  const loadedDecks = selectDecks(await workspace.loadAllDecks(), options);
  const candidates = loadedDecks.filter(({ deck }) => deck && deck.status !== 'example');
  const index = candidates.length ? await workspace.loadCardIndex() : null;
  // Each deck reads its own collections; scopedWorkspace loads each distinct scope only once.
  const collectionsFor = new Map(
    await Promise.all(candidates.map(async ({ deck }) => [deck, await workspace.loadCollections(deck)])),
  );
  const results = loadedDecks.map(({ slug, deck, error }) => {
    if (error) {
      write(`FAIL: ${slug}: ${error.message}`);
      return { deck: slug, outcome: 'fail', error: error.message };
    }
    if (deck.status === 'example') {
      write(`SCHEMA ONLY: ${slug} (example template)`);
      return { deck: slug, outcome: 'pass', schema_only: true };
    }
    const report = checkDeck(deck, collectionsFor.get(deck), index, { now });
    printAll(write, checkLines(slug, report));
    return { deck: slug, ...checkJson(report) };
  });
  emit({ decks: results });
  const outcomes = results.map(({ outcome }) => outcome);
  if (!loadedDecks.length) write('No decks match.');
  else if (loadedDecks.every(({ deck }) => deck?.status === 'example')) write('No decks yet besides the example.');
  return worstOutcome(outcomes);
}
