import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  addTextCopies,
  deckCollectionText,
  nameLine,
  planBuild,
  planSwapOut,
  printingLine,
  removeCsvCopies,
  removeTextCopies,
} from './build.mjs';
import { emptyCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { isLand } from './card.mjs';
import { parseTextCollection, resolveTextRows, summarize } from './collection.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { PRIMER_PLACEHOLDER, applyUpgrades, deckEntries, newDeck, resolveEntries, splitUpgrades } from './deck.mjs';
import { EXPORT_FORMAT_NAMES, PASTE_HINTS, exportDeck, moxfieldCardList, printingChooser } from './export.mjs';
import {
  candidateLines,
  checkLines,
  collectionSummaryLine,
  countLine,
  groupLines,
  searchLines,
  showLines,
  statsLines,
  upgradeLines,
} from './format.mjs';
import {
  candidatesJson,
  checkJson,
  collectionJson,
  returnsJson,
  searchResultJson,
  showJson,
  statsJson,
  takesJson,
  upgradesJson,
} from './json.mjs';
import { checkDeck, lowestLegalBracket, worstOutcome } from './rules.mjs';
import { fetchBulkCards, fetchCards } from './scryfall.mjs';
import {
  GROUP_BY_CHOICES,
  ROLE_CHOICES,
  SORT_CHOICES,
  countResults,
  deckCandidates,
  groupResults,
  searchCollection,
  searchFilters,
  sortResults,
} from './search.mjs';
import { deckListing, deckStats } from './stats.mjs';
import { commandHelp, overviewHelp, parseArgsOptions, withHelpOption } from './help.mjs';
import { upgradeReport } from './upgrades.mjs';
import { verifyDeck } from './verify.mjs';
import { openWorkspace, pathMatches } from './workspace.mjs';

const EXIT_CODES = { pass: 0, fail: 1, incomplete: 2 };

const printAll = (write, lines) => {
  for (const line of lines) write(line);
};

// Text list lines whose printing isn't cached yet are listed, since they count toward nothing.
async function collectionCheck({ workspace, write, warn, emit }) {
  let unmatched = 0;
  const { sources } = await workspace.loadCollections();
  emit({
    collections: sources.map(({ name, path, isProtected, rows }) =>
      collectionJson(name, path, isProtected, summarize(rows), rows),
    ),
  });
  for (const { name, isProtected, rows } of sources) {
    write(collectionSummaryLine(name, isProtected, summarize(rows)));
    for (const row of rows.filter((candidate) => !candidate.scryfallId)) {
      warn(`  NOT CACHED: ${row.location}: ${row.name}; run scryfall:refresh -- --missing`);
      unmatched += 1;
    }
  }
  return unmatched ? 'incomplete' : 'pass';
}

async function collectionSearch({ workspace, options, write, warn, emit }) {
  if (options.count && options['group-by']) throw new Error('Use --count or --group-by, not both');
  const [collections, index] = await Promise.all([workspace.loadCollections(), workspace.loadCardIndex()]);
  const { results, unresolvedRows } = searchCollection(collections, index, searchFilters(options, index));
  if (options.unowned && !index.isFromBulk()) {
    warn(
      'The card cache holds only collection and deck cards, so --unowned finds few; scryfall:refresh -- --bulk caches every card',
    );
  }
  if (unresolvedRows) {
    warn(`${unresolvedRows} collection rows have no cached card data and were skipped; run scryfall:refresh`);
  }
  const sorted = sortResults(results, options.sort);
  emit({ available_collections: collections.availableNames, ...searchData(sorted, options) });
  printAll(write, searchOutput(sorted, options, collections.availableNames));
  return 'pass';
}

// --group-by and --count summarize instead of listing.
function searchOutput(results, options, availableNames) {
  if (options['group-by']) return groupLines(groupResults(results, options['group-by']));
  if (options.count) return [countLine(countResults(results), availableNames)];
  const withValues = options.sort === 'edhrec' || options.sort === 'price';
  return searchLines(results, { withOracleText: options.oracle, withValues });
}

function searchData(results, options) {
  if (options['group-by']) return { groups: groupResults(results, options['group-by']) };
  if (options.count) return { count: countResults(results) };
  return { cards: results.map(searchResultJson) };
}

// Scryfall identifiers for every collection row and every card a deck or upgrade names. Text list rows
// name a printing by set and collector number, or just a card name.
const rowIdentifier = (row) => {
  if (row.scryfallId) return { id: row.scryfallId };
  return row.set ? { set: row.set, collector_number: row.collectorNumber } : { name: row.name };
};

function refreshIdentifiers(collections, decks) {
  const rowIdentifiers = collections.sources.flatMap(({ rows }) => rows).map(rowIdentifier);
  const entries = decks.flatMap((deck) => [
    ...deckEntries(deck),
    ...(deck.upgrades ?? []).flatMap((swap) => [swap.add, swap.cut]),
  ]);
  const entryIdentifiers = entries.map((entry) =>
    entry.scryfall_id ? { id: entry.scryfall_id } : { name: entry.name },
  );
  return [...rowIdentifiers, ...entryIdentifiers];
}

// --bulk starts from every printing in Scryfall's bulk data, --missing from the current cache, and a
// plain refresh from nothing, so it fetches fresh data for just the collections and decks.
async function startingCache(workspace, options, write) {
  if (options.bulk && options.missing) throw new Error('Use --bulk or --missing, not both');
  if (!options.bulk) return options.missing ? workspace.loadCache() : emptyCache();
  write('Downloading Scryfall bulk data (about 105 MB)...');
  const onProgress = (file, read) => write(`Read ${read} printings from ${file}`);
  const { cards, fetchedAt } = await fetchBulkCards({ onProgress });
  write(`Read ${Object.keys(cards).length} printings from bulk data built ${fetchedAt}.`);
  return { ...emptyCache(), cards };
}

async function cardsRefresh({ workspace, options, write, warn }) {
  const [collections, loadedDecks] = await Promise.all([workspace.loadEveryCollection(), workspace.loadAllDecks()]);
  const skipped = loadedDecks.filter(({ error }) => error);
  for (const { slug, error } of skipped) warn(`SKIPPED ${slug}: ${error.message}`);
  const previous = await startingCache(workspace, options, write);
  const index = cardIndex(previous);
  const decks = loadedDecks.filter(({ deck }) => deck).map(({ deck }) => deck);
  const wanted = refreshIdentifiers(collections, decks).filter((identifier) => !index.isCached(identifier));
  const notFound = [];
  if (wanted.length || options.bulk) {
    const fetched = wanted.length
      ? await fetchCards(wanted, { onProgress: (done, total) => write(`Fetched ${done}/${total}`) })
      : { cards: {}, notFound: [] };
    notFound.push(...fetched.notFound);
    const cache = { ...previous, cards: { ...previous.cards, ...fetched.cards } };
    await workspace.saveCache(cache);
    write(
      `Cached ${Object.keys(cache.cards).length} printings (${Object.keys(fetched.cards).length} fetched from Scryfall's card API).`,
    );
  } else {
    write('Card cache already covers every collection row and deck entry.');
  }
  for (const missing of notFound) warn(`UNRESOLVED: ${JSON.stringify(missing)}`);
  return notFound.length || skipped.length ? 'incomplete' : 'pass';
}

// MTG_UNLIMITED_BASICS and MTG_ALLOW_PROXIES hold true or false; empty or unset means false.
function envFlag(env, name) {
  const value = env[name] || 'false';
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
}

function parseAmount(value, flag) {
  if (value === undefined) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`${flag} must be an amount such as 30 or 0.50`);
  return Number(value);
}

// deck:new's header fields from the brief, each left out when its option isn't given.
function newDeckHeader(options) {
  const currency = options.currency ?? 'USD';
  if (!['USD', 'EUR'].includes(currency)) throw new Error('--currency must be USD or EUR');
  const bracket = options['target-bracket'] === undefined ? undefined : Number(options['target-bracket']);
  if (bracket !== undefined && ![1, 2, 3, 4, 5].includes(bracket)) throw new Error('--target-bracket must be 1 to 5');
  const money = (flag) => {
    const amount = parseAmount(options[flag], `--${flag}`);
    return amount === undefined ? undefined : { amount, currency };
  };
  return {
    primer: options.primer,
    target_bracket: bracket,
    budget: money('budget'),
    max_card_price: money('max-card-price'),
    collection_source: options['collection-source'] ? patternList(options['collection-source']) : undefined,
  };
}

async function deckNew({ workspace, slug, options, env, write }) {
  const deck = newDeck(slug, {
    format: options.format,
    commanderNames: options.commander,
    name: options.name,
    allowProxies: options['allow-proxies'] ?? envFlag(env, 'MTG_ALLOW_PROXIES'),
    unlimitedBasics: options['unlimited-basics'] ?? envFlag(env, 'MTG_UNLIMITED_BASICS'),
    header: newDeckHeader(options),
  });
  const label = await workspace.createDeck(slug, deck);
  const todo = [deck.primer === PRIMER_PLACEHOLDER && 'the primer', 'the mainboard'].filter(Boolean).join(' and ');
  write(
    `Created ${label} (allow_proxies: ${deck.allow_proxies}, unlimited_basics: ${deck.unlimited_basics}). Fill in ${todo} next.`,
  );
  return 'pass';
}

async function deckCheck({ workspace, slug, write, emit }) {
  const deck = await workspace.loadDeck(slug);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const report = checkDeck(deck, collections, index);
  emit(checkJson(report));
  printAll(write, checkLines(slug, report));
  return report.outcome;
}

// With --upgrades apply, the deck as it would be with every swap made.
async function deckStatsCommand({ workspace, slug, options, write, emit }) {
  const [deck, index] = await Promise.all([workspace.loadDeck(slug), workspace.loadCardIndex()]);
  if (options.upgrades !== undefined && options.upgrades !== 'apply') throw new Error('--upgrades must be apply');
  const upgraded = options.upgrades && applyUpgrades(deck);
  const measured = upgraded ? { ...upgraded, mainboard: [...upgraded.mainboard, ...upgraded.upgradesIn] } : deck;
  const stats = deckStats(measured, index);
  emit({ upgrades_applied: Boolean(upgraded), ...statsJson(stats) });
  printAll(write, statsLines(deck, stats, { upgradesApplied: Boolean(upgraded) }));
  return stats.problems.length ? 'incomplete' : 'pass';
}

// The deck's own cards with their rules text, so a review reads the list rather than recalling it.
async function deckShow({ workspace, slug, options, write, emit }) {
  const [deck, index] = await Promise.all([workspace.loadDeck(slug), workspace.loadCardIndex()]);
  if (options.upgrades !== undefined && options.upgrades !== 'apply') throw new Error('--upgrades must be apply');
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

async function deckExport({ workspace, slug, options, env, write, warn, copyText }) {
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
const DECKLIST_FORMATS = ['archidekt', 'moxfield'];
const decklistFile = (format) => `decklist.${format}.txt`;
const upgradedDecklistFile = (format) => `decklist-upgraded.${format}.txt`;
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

// Records the bracket the deck's cards set in lowest_legal_bracket (casual decks have none), and
// removes plays_like_bracket when the card list changed, since that judged the old list.
async function recordBrackets(workspace, slug, deck, index, { listChanged }) {
  const bracket = lowestLegalBracket(deck, index);
  const after = ['plays_like_bracket', 'target_bracket'].find((key) => deck[key] !== undefined) ?? 'status';
  await workspace.putDeckField(slug, 'lowest_legal_bracket', bracket, { after });
  const cleared = listChanged && deck.plays_like_bracket !== undefined;
  if (cleared) await workspace.putDeckField(slug, 'plays_like_bracket', undefined);
  return { bracket, cleared };
}

const bracketNote = ({ bracket, cleared }) =>
  [
    bracket === undefined ? '' : `; set lowest_legal_bracket: ${bracket}`,
    cleared ? ' and removed plays_like_bracket because the card list changed; judge it again' : '',
  ].join('');

// The committed Moxfield list is compared before it's overwritten, to tell whether the cards changed.
async function deckFiles({ workspace, slug, warn, write }) {
  const { deck, index, render, warnUncached } = await exporter(workspace, slug, warn);
  const files = decklistFiles(deck, render);
  const before = await workspace.readDeckFile(slug, decklistFile('moxfield'));
  const cardList = (text) => moxfieldCardList(text).join('\n');
  const listChanged = before === null || cardList(before) !== cardList(files.get(decklistFile('moxfield')));
  const written = [];
  for (const [file, text] of files) {
    if (text === null) await workspace.removeDeckFile(slug, file);
    else written.push(await workspace.writeDeckFile(slug, file, text));
  }
  await Promise.all(LEGACY_DECKLIST_FILES.map((file) => workspace.removeDeckFile(slug, file)));
  warnUncached();
  const brackets = await recordBrackets(workspace, slug, deck, index, { listChanged });
  write(`Wrote ${written.join(', ')}${bracketNote(brackets)}.`);
  return 'pass';
}

const CANDIDATE_LIMIT = 20;

function parseLimit(value) {
  const limit = value === undefined ? CANDIDATE_LIMIT : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  return limit;
}

// The hand-off gate: deck:check plus everything else a finished deck needs (see verify.mjs).
async function deckVerifyCommand({ workspace, slug, options, write, warn, emit }) {
  const { deck, collections, index, render } = await exporter(workspace, slug, warn, { caveat: false });
  const expected = decklistFiles(deck, render);
  const actual = new Map(
    await Promise.all([...expected.keys()].map(async (file) => [file, await workspace.readDeckFile(slug, file)])),
  );
  const limit = parseLimit(options.limit);
  const report = verifyDeck({ deck, collections, index, limit, decklists: { expected, actual } });
  emit(checkJson(report));
  printAll(write, checkLines(slug, report));
  return report.outcome;
}

// The deck's most valued left-out cards, so a review explains each exclusion rather than missing one.
async function deckCandidatesCommand({ workspace, slug, options, write, warn, emit }) {
  const deck = await workspace.loadDeck(slug);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const limit = parseLimit(options.limit);
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

async function deckUpgrades({ workspace, slug, write, emit }) {
  const deck = await workspace.loadDeck(slug);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const report = upgradeReport(deck, collections, index);
  emit(upgradesJson(report));
  printAll(write, upgradeLines(report));
  return report.outcome;
}

// The cards deck:build takes, grouped by the collection file they come from.
function buildLines(plan, takenFrom, verb) {
  const lines = [`${verb}:`];
  for (const [path, takes] of takenFrom) {
    lines.push(`  from ${path}:`);
    for (const { row, card, quantity } of takes) lines.push(`    ${printingLine(quantity, card, row.finish)}`);
  }
  if (plan.untracked.length) {
    lines.push('  from untracked basics (unlimited_basics):');
    for (const { card, quantity } of plan.untracked) lines.push(`    ${nameLine(quantity, card)}`);
  }
  return lines;
}

// Takes each file's copies out of it, removing a file left with no cards.
async function removeTakenCopies(workspace, takenFrom, write) {
  for (const [path, takes] of takenFrom) {
    const taken = new Map();
    for (const { row, quantity } of takes) taken.set(row.position, (taken.get(row.position) ?? 0) + quantity);
    const remove = path.endsWith('.csv') ? removeCsvCopies : removeTextCopies;
    const updated = remove(await workspace.readCollectionFile(path), taken);
    if (updated === null) {
      await workspace.removeCollectionFile(path);
      write(`Removed ${path}: every card in it went into the deck.`);
    } else {
      await workspace.writeCollectionFile(path, updated);
    }
  }
}

// The deck's copies to take, or null after printing why it can't be built: it must pass deck:check,
// and every card must have real copies to take.
async function buildPlan(workspace, deckId, deck, { write, emit }) {
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const report = checkDeck(deck, collections, index);
  if (report.outcome !== 'pass') {
    emit({ applied: false, check: checkJson(report) });
    printAll(write, [...checkLines(deckId, report), `Not built: ${deckId} must pass deck:check first.`]);
    return { outcome: report.outcome };
  }
  const plan = planBuild(deck, collections, index);
  if (plan.problems.length) {
    emit({ applied: false, problems: plan.problems });
    printAll(write, [
      ...plan.problems.map((problem) => `ERROR: ${problem}`),
      `Not built: ${deckId} needs these cards owned as real copies first.`,
    ]);
    return { outcome: 'fail' };
  }
  const pathOf = new Map(collections.sources.map((source) => [source.name, source.path]));
  return { plan, takenFrom: Map.groupBy(plan.takes, ({ row }) => pathOf.get(row.collection)) };
}

// Moves a finished deck's cards out of the collections they're counted in and into a text list of
// its own, then points the deck's collection_destination at that list. Without --apply it only
// prints what it would take.
async function deckBuild({ workspace, slug, options, env, write, warn, emit }) {
  const deckId = await workspace.resolveDeckId(slug);
  const deck = await workspace.loadDeck(deckId);
  if (deck.collection_destination) throw new Error(`${deckId} is already built into ${deck.collection_destination}`);
  const template = env.MTG_BUILD_DESTINATION || undefined;
  const destination = options.to ?? workspace.defaultDeckCollection(deckId, deck.name, template);
  const { plan, takenFrom, outcome } = await buildPlan(workspace, deckId, deck, { write, emit });
  if (!plan) return outcome;
  emit({ applied: Boolean(options.apply), destination, ...takesJson(plan, takenFrom) });
  printAll(write, buildLines(plan, takenFrom, options.apply ? 'Taking' : 'Would take'));
  if (!workspace.protects(destination)) {
    warn(`${destination} isn't protected, so other decks could count its cards; see MTG_PROTECTED_COLLECTIONS`);
  }
  if (!options.apply) {
    write(`Would write ${destination} and set collection_destination and status: built in builds/${deckId}/deck.yaml.`);
    write('Nothing changed; rerun with --apply to build it.');
    return 'pass';
  }
  const heading = `${deck.name}: built from builds/${deckId} by deck:build`;
  await workspace.createCollectionFile(destination, deckCollectionText(plan, heading));
  await removeTakenCopies(workspace, takenFrom, write);
  await workspace.setDeckField(deckId, 'collection_destination', destination, { after: 'collection_source' });
  await workspace.changeDeckFields(deckId, { status: 'built' });
  const sources = [...takenFrom.keys()].join(', ') || 'no collection';
  write(`Wrote ${destination}, took the cards out of ${sources}, and set collection_destination and status: built.`);
  return 'pass';
}

// The copies in a built deck's own list, grouped by the text list each goes back to: lands to
// --lands-to when it's given, everything else to --to. Lines without a printing are the untracked basics
// deck:build lists under unlimited_basics, which no collection held, so they go nowhere.
async function teardownPlan(workspace, deck, options) {
  const own = deck.collection_destination;
  const rows = resolveTextRows(
    parseTextCollection(await workspace.readCollectionFile(own), own),
    await workspace.loadCardIndex(),
  );
  const uncached = rows.filter((row) => row.set && !row.scryfallId);
  if (uncached.length) {
    const names = uncached.map((row) => row.name).join(', ');
    throw new Error(`${own} has lines not in the card cache (${names}); run scryfall:refresh -- --missing`);
  }
  const index = await workspace.loadCardIndex();
  const returns = new Map();
  const untracked = [];
  for (const row of rows) {
    if (!row.set) {
      untracked.push(row);
      continue;
    }
    const card = index.byId.get(row.scryfallId);
    const path = options['lands-to'] && isLand(card) ? options['lands-to'] : options.to;
    returns.set(path, [...(returns.get(path) ?? []), { card, finish: row.finish, quantity: row.quantity }]);
  }
  return { returns, untracked };
}

function teardownLines({ returns, untracked }, verb) {
  const lines = [`${verb}:`];
  for (const [path, copies] of returns) {
    lines.push(`  to ${path}:`);
    for (const { card, finish, quantity } of copies) lines.push(`    ${printingLine(quantity, card, finish)}`);
  }
  if (untracked.length) {
    lines.push('  nowhere, as untracked basics (unlimited_basics):');
    for (const { name, quantity } of untracked) lines.push(`    ${quantity} ${name}`);
  }
  return lines;
}

// --to and --lands-to must name text lists under collections/ other than the deck's own.
function checkReturnPaths(workspace, options, own, warn) {
  for (const path of [options.to, options['lands-to']].filter(Boolean)) {
    if (!/^collections\/(?:[^/\\]+\/)*[^/\\]+\.txt$/.test(path) || path.split('/').includes('..')) {
      throw new Error(`${path} must be a text list (.txt) under collections/`);
    }
    if (path === own) throw new Error(`${path} is the deck's own list`);
    if (workspace.protects(path)) warn(`${path} is protected, so no deck will count the returned cards`);
  }
}

const readIfExists = (workspace, path) =>
  workspace.readCollectionFile(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

// Adds each list's copies to it, creating a list that doesn't exist yet.
async function returnCopies(workspace, returns) {
  for (const [path, copies] of returns) {
    const existing = await readIfExists(workspace, path);
    if (existing === null) {
      const lines = copies.map(({ card, finish, quantity }) => printingLine(quantity, card, finish));
      await workspace.createCollectionFile(path, `${lines.join('\n')}\n`);
    } else {
      await workspace.writeCollectionFile(path, addTextCopies(existing, copies));
    }
  }
}

// The reverse of deck:build: returns a built deck's cards from its own list to the text lists named,
// deletes that list, and makes the deck a draft again. Without --apply it only prints the plan.
async function deckTeardown({ workspace, slug, options, write, warn, emit }) {
  const deckId = await workspace.resolveDeckId(slug);
  const deck = await workspace.loadDeck(deckId);
  const own = deck.collection_destination;
  if (!own) throw new Error(`${deckId} isn't built: it has no collection_destination`);
  if (!options.to) throw new Error('deck:teardown needs --to PATH, the text list to return the cards to');
  checkReturnPaths(workspace, options, own, warn);
  const plan = await teardownPlan(workspace, deck, options);
  emit({ applied: Boolean(options.apply), deleted: own, ...returnsJson(plan) });
  printAll(write, teardownLines(plan, options.apply ? 'Returning' : 'Would return'));
  const deckChanges = { collection_destination: undefined, ...(deck.status === 'built' ? { status: 'draft' } : {}) };
  const changed = Object.keys(deckChanges).join(' and ');
  if (!options.apply) {
    write(`Would delete ${own} and change ${changed} in builds/${deckId}/deck.yaml.`);
    write('Nothing changed; rerun with --apply to tear it down.');
    return 'pass';
  }
  await returnCopies(workspace, plan.returns);
  await workspace.removeCollectionFile(own);
  await workspace.changeDeckFields(deckId, deckChanges);
  write(`Returned the cards to ${[...plan.returns.keys()].join(', ')}, deleted ${own}, and changed ${changed}.`);
  return 'pass';
}

// The copies each out card loses, by oracle ID, refusing more than the mainboard has.
function swapCuts(deck, pairs, index) {
  const mainboard = resolveEntries(deck.mainboard, index).tallies;
  const cuts = new Map();
  for (const pair of pairs) {
    if (pair.out.oracleId === pair.in.oracleId) throw new Error(`${pair.out.name} can't be swapped for itself`);
    const { quantity: has = 0, printingId } = mainboard.get(pair.out.oracleId) ?? {};
    const cut = cuts.get(pair.out.oracleId) ?? { card: pair.out, quantity: 0, printingId };
    cut.quantity += 1;
    if (cut.quantity > has) {
      throw new Error(`${pair.out.name}: the mainboard has ${has}, fewer than the ${cut.quantity} to swap out`);
    }
    cuts.set(pair.out.oracleId, cut);
  }
  return cuts;
}

// Pairs each --out with the --in at the same place, as cached cards. The out card must be in the
// mainboard with a copy for every swap, and every card must be cached.
function swapPairs(deck, options, index) {
  const outs = options.out ?? [];
  const ins = options.in ?? [];
  if (!outs.length || outs.length !== ins.length) {
    throw new Error('deck:swap needs one --in NAME for each --out NAME');
  }
  const lookup = (name) => {
    const { card, problem } = index.lookup({ name });
    if (problem) throw new Error(problem);
    return card;
  };
  const pairs = outs.map((out, position) => ({ out: lookup(out), in: lookup(ins[position]) }));
  return { pairs, cuts: swapCuts(deck, pairs, index) };
}

// Upgrades the swap leaves stale: ones cutting more copies of an out card than the deck now has, and
// ones adding a card the swap already put in.
function staleUpgrades(swapped, pairs, index) {
  const mainboard = resolveEntries(swapped.mainboard, index).tallies;
  const outs = new Set(pairs.map((pair) => pair.out.oracleId));
  const ins = new Set(pairs.map((pair) => pair.in.oracleId));
  return (swapped.upgrades ?? []).flatMap(({ add, cut }) => {
    const [added, removed] = [add, cut].map((entry) => index.lookup(entry).card);
    const stale = [];
    if (removed && outs.has(removed.oracleId) && (mainboard.get(removed.oracleId)?.quantity ?? 0) < cut.quantity) {
      stale.push(`the upgrade adding ${add.name} cuts ${cut.name}, which the swap takes out; give it another cut`);
    }
    if (added && ins.has(added.oracleId)) stale.push(`the upgrade adding ${add.name} is done by the swap; remove it`);
    return stale;
  });
}

// Copies a built deck's swap moves: the in cards from the other available collections into the deck's
// own list, and the out cards from that list back to --to (lands to --lands-to).
function swapMoves(deck, collections, cuts, pairs, options, index) {
  const own = collections.sources.find((source) => source.path === deck.collection_destination);
  const outPlan = planSwapOut(own.rows, cuts, index);
  const elsewhere = { available: collections.available.filter((row) => row.collection !== own.name) };
  const ins = pairs.map((pair) => ({ name: pair.in.name, quantity: 1 }));
  const inPlan = planBuild({ ...deck, commanders: [], mainboard: ins }, elsewhere, index);
  const pathOf = new Map(collections.sources.map((source) => [source.name, source.path]));
  const returns = new Map();
  for (const { row, card, quantity } of outPlan.takes) {
    const path = options['lands-to'] && isLand(card) ? options['lands-to'] : options.to;
    returns.set(path, [...(returns.get(path) ?? []), { card, finish: row.finish, quantity }]);
  }
  return {
    own,
    outPlan,
    inPlan,
    takenFrom: Map.groupBy(inPlan.takes, ({ row }) => pathOf.get(row.collection)),
    returns,
    problems: [...outPlan.problems, ...inPlan.problems],
  };
}

// The deck's own list with the out copies taken out and the in copies added, at the end of the list
// unless a line of the same printing and finish is already there.
function swappedOwnList(text, moves) {
  const taken = new Map();
  for (const { row, quantity } of [...moves.outPlan.takes, ...moves.outPlan.untracked]) {
    taken.set(row.position, (taken.get(row.position) ?? 0) + quantity);
  }
  const copies = moves.inPlan.takes.map(({ row, card, quantity }) => ({ card, finish: row.finish, quantity }));
  const basics = moves.inPlan.untracked.map(({ card, quantity }) => nameLine(quantity, card));
  const kept = removeTextCopies(text, taken);
  // Swapping out every card leaves no line for addTextCopies to place copies by, so they're appended.
  const base = kept === null ? text.replace(/^\s*\d+x?\s.*(?:\r?\n|$)/gm, '') : addTextCopies(kept, copies);
  const appended = [
    ...(kept === null ? copies.map(({ card, finish, quantity }) => printingLine(quantity, card, finish)) : []),
    ...basics,
  ];
  if (!appended.length) return base;
  return `${base}${base && !base.endsWith('\n') ? '\n' : ''}${appended.join('\n')}\n`;
}

function swapLines(pairs, moves, verb) {
  const lines = [`${verb} in deck.yaml:`, ...pairs.map((pair) => `  -1 ${pair.out.name}, +1 ${pair.in.name}`)];
  if (!moves) return lines;
  lines.push(...buildLines(moves.inPlan, moves.takenFrom, `${verb} into ${moves.own.path}`));
  lines.push(...teardownLines({ returns: moves.returns, untracked: moves.outPlan.untracked }, `${verb} out of it`));
  return lines;
}

// A built deck's moves, or the outcome after printing why it can't be swapped: the swapped deck must
// pass deck:check, and every card must have real copies to move.
function builtSwapPlan({ workspace, deckId, deck, collections, index, report, swap, options, write, warn, emit }) {
  if (report.outcome !== 'pass') {
    emit({ check: checkJson(report) });
    printAll(write, [
      ...checkLines(deckId, report),
      `Not swapped: ${deckId} is built, so the swapped deck must pass deck:check.`,
    ]);
    return { outcome: report.outcome };
  }
  checkReturnPaths(workspace, options, deck.collection_destination, warn);
  const moves = swapMoves(deck, collections, swap.cuts, swap.pairs, options, index);
  if (moves.problems.length) {
    emit({ problems: moves.problems });
    printAll(write, [...moves.problems.map((problem) => `ERROR: ${problem}`), 'Not swapped.']);
    return { outcome: 'fail' };
  }
  if (moves.returns.size && !options.to) {
    throw new Error('deck:swap needs --to PATH for a built deck, the text list the swapped-out cards go back to');
  }
  return { moves };
}

// One --reason per swap, or none, which leaves the swapped-out cards without a considered reason.
function swapReasons(options, swapCount, warn) {
  const reasons = options.reason ?? [];
  if (reasons.length && reasons.length !== swapCount) throw new Error('Give one --reason for each --out, or none');
  if (!reasons.length) {
    warn('WARNING: no --reason, so the cards swapped out get no considered reason and deck:candidates will list them');
  }
  return reasons;
}

// Swaps mainboard cards for others. A built deck's physical cards move too: each in card comes out of
// the available collections into the deck's own list, and each out card goes from that list back to
// --to. Without --apply it only prints the plan.
// What deck:swap changes, for --json: the swaps, and for a built deck the copies it moves.
const swapJson = (swaps, reasons, moves) => ({
  swaps: swaps.map((swap, at) => ({ ...swap, reason: reasons[at] ?? null })),
  ...(moves && {
    into: takesJson(moves.inPlan, moves.takenFrom),
    out_of: returnsJson({ returns: moves.returns, untracked: moves.outPlan.untracked }),
  }),
});

async function deckSwap({ workspace, slug, options, today, write, warn, emit }) {
  const deckId = await workspace.resolveDeckId(slug);
  const deck = await workspace.loadDeck(deckId);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const swap = swapPairs(deck, options, index);
  const swaps = swap.pairs.map((pair) => ({ out: pair.out.name, in: pair.in.name }));
  const record = { date: today, reasons: swapReasons(options, swaps.length, warn) };
  const swapped = await workspace.swapDeckCards(deckId, swaps, record);
  const report = checkDeck(swapped, collections, index);
  const own = deck.collection_destination;
  emit({ applied: false, ...swapJson(swaps, record.reasons) });
  let moves;
  if (own) {
    const context = { workspace, deckId, deck, collections, index, report, swap, options, write, warn, emit };
    const plan = builtSwapPlan(context);
    if (!plan.moves) return plan.outcome;
    ({ moves } = plan);
  } else if (options.to || options['lands-to']) {
    warn(`${deckId} isn't built, so only deck.yaml changes and --to is ignored`);
  }
  emit({ applied: Boolean(options.apply), ...swapJson(swaps, record.reasons, moves), check: checkJson(report) });
  printAll(write, swapLines(swap.pairs, moves, options.apply ? 'Swapping' : 'Would swap'));
  for (const stale of staleUpgrades(swapped, swap.pairs, index)) warn(`WARNING: ${stale}`);
  // A draft may be unfinished, so its check is shown rather than required.
  if (!own) printAll(write, checkLines(deckId, report));
  if (!options.apply) {
    write('Nothing changed; rerun with --apply to swap.');
    return 'pass';
  }
  if (moves) {
    await workspace.writeCollectionFile(own, swappedOwnList(await workspace.readCollectionFile(own), moves));
    await removeTakenCopies(workspace, moves.takenFrom, write);
    await returnCopies(workspace, moves.returns);
  }
  await workspace.swapDeckCards(deckId, swaps, { ...record, apply: true });
  const brackets = await recordBrackets(workspace, deckId, swapped, index, { listChanged: true });
  write(
    `Swapped ${swaps.length} card${swaps.length === 1 ? '' : 's'}, added a history entry${bracketNote(brackets)}; rerun deck:files.`,
  );
  return 'pass';
}

async function decksCheck({ workspace, write, emit }) {
  const loadedDecks = await workspace.loadAllDecks();
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
    const report = checkDeck(deck, collectionsFor.get(deck), index);
    printAll(write, checkLines(slug, report));
    return { deck: slug, ...checkJson(report) };
  });
  emit({ decks: results });
  const outcomes = results.map(({ outcome }) => outcome);
  if (loadedDecks.every(({ deck }) => deck?.status === 'example')) write('No decks yet besides the example.');
  return worstOutcome(outcomes);
}

const JSON_OPTION = {
  type: 'boolean',
  description:
    'Print one line of JSON: { command, deck, outcome, data, warnings }; defaults to MTG_OUTPUT in .env (--no-json for text)',
};

const SEARCH_OPTIONS = {
  commander: {
    type: 'string',
    placeholder: 'NAME',
    description: "Limit to this commander's color identity and Commander-legal cards",
  },
  commanders: {
    type: 'boolean',
    description: 'Only cards that can be a commander: legendary creatures, Backgrounds, "can be your commander"',
  },
  'game-changers': { type: 'boolean', description: 'Only cards on the Commander Game Changers list' },
  nonland: { type: 'boolean', description: 'Exclude lands (modal spell/land cards count as spells)' },
  identity: { type: 'string', placeholder: 'WUBRG', description: 'Limit to a color identity; C means colorless only' },
  type: {
    type: 'string',
    multiple: true,
    placeholder: 'REGEX',
    description: 'Type line must match (case-insensitive)',
  },
  text: {
    type: 'string',
    multiple: true,
    placeholder: 'REGEX',
    description: 'Rules text must match (case-insensitive)',
  },
  role: {
    type: 'string',
    multiple: true,
    placeholder: 'ROLE',
    description: `Rules text must look like this role: ${ROLE_CHOICES.join(', ')} (rough; read the list before quoting a count)`,
  },
  name: { type: 'string', placeholder: 'REGEX', description: 'Card name must match (case-insensitive)' },
  'min-mv': { type: 'string', placeholder: 'N', description: 'Minimum mana value' },
  'max-mv': { type: 'string', placeholder: 'N', description: 'Maximum mana value' },
  legal: { type: 'string', placeholder: 'FORMAT', description: 'Must be legal in this Scryfall format, e.g. modern' },
  'max-price': {
    type: 'string',
    placeholder: 'USD',
    description: 'Cheapest playable printing costs at most this; unknown prices are kept',
  },
  'min-copies': {
    type: 'string',
    placeholder: 'N',
    description: 'At least this many available copies, e.g. 4 for casual-60 playsets',
  },
  unowned: {
    type: 'boolean',
    description:
      'Search every card in the cache that has no available copy, e.g. for upgrades; needs scryfall:refresh -- --bulk',
  },
  'include-protected': { type: 'boolean', description: 'Also list cards that exist only in protected collections' },
  proxies: { type: 'boolean', description: 'Count proxy rows as owned copies' },
  oracle: { type: 'boolean', description: "Print each card's rules text" },
  count: { type: 'boolean', description: 'Print only how many distinct cards and copies match' },
  'group-by': {
    type: 'string',
    placeholder: 'KEY',
    description: `Count matches per group instead of listing them: ${GROUP_BY_CHOICES.join(', ')} (role uses the --role tests)`,
  },
  json: JSON_OPTION,
  sort: {
    type: 'string',
    placeholder: 'KEY',
    description: `Order the list by ${SORT_CHOICES.join(', ')} (mana value, default; EDHREC rank; price, highest first); edhrec and price also print both`,
  },
};

// Which collections to read and which not to dismantle. Each option wins over its .env variable
// (see .env.example). Both take comma-separated glob patterns relative to the project root, such as
// collections/conrad* or collections/**/precons. --collections defaults to every collection, and
// --protect to any precons collection or decks folder, which is where deck:build puts built decks; an
// empty value means every collection, or none protected.
const COLLECTION_OPTIONS = {
  collections: {
    type: 'string',
    placeholder: 'PATTERNS',
    description:
      'Comma-separated path globs (e.g. collections/conrad*) of collections to read, ignoring the rest; defaults to MTG_COLLECTIONS in .env, else all',
  },
  protect: {
    type: 'string',
    placeholder: 'PATTERNS',
    description:
      'Comma-separated path globs of collections to protect; defaults to MTG_PROTECTED_COLLECTIONS in .env, else collections/**/precons,collections/**/decks',
  },
};
const DEFAULT_PROTECTED = 'collections/**/precons,collections/**/decks';

const patternList = (value) =>
  value
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);

// The default protect patterns name folders that may not exist yet, so only chosen ones warn when unmatched.
const collectionScope = (options, env) => ({
  optionOnly: options.collections === undefined ? undefined : patternList(options.collections),
  envOnly: patternList(env.MTG_COLLECTIONS ?? ''),
  protect: patternList(options.protect ?? env.MTG_PROTECTED_COLLECTIONS ?? DEFAULT_PROTECTED),
  protectChosen: (options.protect ?? env.MTG_PROTECTED_COLLECTIONS) !== undefined,
});

// The workspace with the collection scope applied, so commands just call loadCollections(), passing
// the deck when there is one. The collections read come from --collections, else the deck's
// collection_source, else MTG_COLLECTIONS, and a built deck's collection_destination is always read as
// its own. Each distinct scope is loaded, and warned about, once.
// loadEveryCollection ignores the scope, so scryfall:refresh caches every collection, and leaves text
// lists unmatched, so a missing or outdated cache can't stop the refresh that replaces it.
function scopedWorkspace(workspace, scope, warn) {
  const loaded = new Map();
  async function load(only, own) {
    const collections = await workspace.loadCollections({ only, own, protect: scope.protect });
    for (const pattern of collections.unknownOnly) warn(`No collection matches ${pattern} to read`);
    if (scope.protectChosen) {
      for (const pattern of collections.unknownProtected) warn(`No collection matches ${pattern} to protect`);
    }
    if (collections.missingOwn) warn(`collection_destination ${collections.missingOwn} doesn't exist`);
    return collections;
  }
  function loadCollections(deck) {
    const only = scope.optionOnly ?? deck?.collection_source ?? scope.envOnly;
    const own = deck?.collection_destination;
    const key = JSON.stringify([only, own]);
    if (!loaded.has(key)) loaded.set(key, load(only, own));
    return loaded.get(key);
  }
  return {
    ...workspace,
    loadCollections,
    loadEveryCollection: () => workspace.loadCollections({ resolve: false }),
    protects: (path) => scope.protect.some((pattern) => pathMatches(path, pattern)),
  };
}

const FORMAT_OPTION = {
  type: 'string',
  placeholder: 'FORMAT',
  description: `${EXPORT_FORMAT_NAMES.join(', ')}; defaults to MTG_EXPORT_FORMAT in .env, else text`,
};

const COMMANDS = {
  'collection:check': {
    run: collectionCheck,
    summary: 'Validate every collection (ManaBox CSV or text list) and summarize it',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'collection:search': {
    run: collectionSearch,
    summary: 'Search owned cards by color identity, type, rules text and mana value',
    details:
      'Searches every collection (ManaBox CSV or text list, at any depth under collections/) that MTG_COLLECTIONS or --collections selects, except protected ones, whose copies are shown alongside. Filters combine with AND.',
    options: { ...SEARCH_OPTIONS, ...COLLECTION_OPTIONS },
  },
  'scryfall:refresh': {
    run: cardsRefresh,
    summary: 'Fetch Scryfall card data and prices for every collection and deck (network)',
    details:
      "A plain refresh replaces the cache with fresh data for just the collections' and decks' cards. --bulk caches every printing on Scryfall from its daily bulk data (about 105 MB of downloads), then fetches only what that lacks, such as non-English printings; --missing then keeps it all.",
    options: {
      missing: { type: 'boolean', description: 'Fetch only cards not already cached' },
      bulk: { type: 'boolean', description: "Cache every printing from Scryfall's bulk data, not just owned cards" },
    },
  },
  'deck:new': {
    run: deckNew,
    takesSlug: true,
    summary:
      'Create a draft deck at builds/<deck-slug>/deck.yaml (slug may be nested, e.g. brad/elves); never overwrites',
    options: {
      commander: {
        type: 'string',
        multiple: true,
        placeholder: 'NAME',
        description: 'Commander card; required for Commander, repeat for partners',
      },
      format: {
        type: 'string',
        placeholder: 'FORMAT',
        description: 'commander (default), custom-dollar-brawl or casual-60',
      },
      name: { type: 'string', placeholder: 'TEXT', description: 'Deck name; defaults to the slug in title case' },
      primer: { type: 'string', placeholder: 'TEXT', description: 'The game plan, in a sentence or two' },
      'target-bracket': {
        type: 'string',
        placeholder: 'N',
        description: 'The Commander Bracket the deck is built for, 1 to 5; deck:files records the one its cards set',
      },
      budget: { type: 'string', placeholder: 'AMOUNT', description: 'Budget for upgrades, in --currency' },
      'max-card-price': {
        type: 'string',
        placeholder: 'AMOUNT',
        description: 'Most any one card may cost, in --currency',
      },
      currency: {
        type: 'string',
        placeholder: 'CODE',
        description: 'USD (default) or EUR, for --budget and --max-card-price',
      },
      'collection-source': {
        type: 'string',
        placeholder: 'PATTERNS',
        description: 'Comma-separated path globs of the collections the deck is built from, e.g. collections/brad/*',
      },
      'unlimited-basics': {
        type: 'boolean',
        description:
          'The user has untracked basics; defaults to MTG_UNLIMITED_BASICS in .env (--no-unlimited-basics for false)',
      },
      'allow-proxies': {
        type: 'boolean',
        description: 'Proxy rows count as owned; defaults to MTG_ALLOW_PROXIES in .env (--no-allow-proxies for false)',
      },
    },
  },
  'deck:check': {
    run: deckCheck,
    takesSlug: true,
    summary: 'Check size, commander rules, color identity, bans, copy limits and ownership',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'deck:stats': {
    run: deckStatsCommand,
    takesSlug: true,
    summary: 'Show mainboard curve, card types, color pips, land sources and roles',
    details:
      "Also Karsten's suggested land count, role counts against the deck's role_targets (or, for Commander, the Command Zone template), and opening-hand odds. Land sources count only colors inside the commanders' identity.",
    options: {
      upgrades: {
        type: 'string',
        placeholder: 'MODE',
        description: 'apply: measure the deck with every upgrade swap made',
      },
      json: JSON_OPTION,
    },
  },
  'deck:show': {
    run: deckShow,
    takesSlug: true,
    summary: "List the deck's cards by role, with mana cost, type and optionally rules text",
    details:
      "Commanders first, then the mainboard grouped by each card's first role (cards with several roles name them all). Cards the cache lacks make it incomplete.",
    options: {
      role: { type: 'string', placeholder: 'ROLE', description: 'Only cards with this role label, e.g. removal' },
      oracle: SEARCH_OPTIONS.oracle,
      upgrades: {
        type: 'string',
        placeholder: 'MODE',
        description: 'apply: list the deck with every upgrade swap made',
      },
      json: JSON_OPTION,
    },
  },
  'deck:export': {
    run: deckExport,
    takesSlug: true,
    summary: 'Print a paste-ready decklist for another site, or copy it to the clipboard',
    details:
      'Does not validate the deck. Moxfield and Archidekt lines carry set and collector number: the pinned scryfall_id, else the printing owned in an available collection, else a cached printing.',
    options: {
      format: FORMAT_OPTION,
      upgrades: {
        type: 'string',
        placeholder: 'MODE',
        description:
          'apply: make every upgrade swap, e.g. for playtesting; split: list the kept cards as the deck, cuts in the sideboard and adds under Considering (Maybeboard in Archidekt)',
      },
      copy: { type: 'boolean', description: 'Copy to the clipboard instead of printing' },
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:files': {
    run: deckFiles,
    takesSlug: true,
    summary: 'Write the decklist files kept beside deck.yaml',
    details: `Sets lowest_legal_bracket in deck.yaml to the bracket the cards set, removes plays_like_bracket if the cards changed since the last run, and writes ${DECKLIST_FORMATS.map(decklistFile).join(' and ')} (the kept cards, upgrade cuts in the sideboard, adds under Considering or Maybeboard) and, if the deck has upgrades, ${DECKLIST_FORMATS.map(upgradedDecklistFile).join(' and ')} (the full deck with every swap made). Overwrites them; rerun after every deck edit. Does not validate the deck.`,
    options: COLLECTION_OPTIONS,
  },
  'deck:candidates': {
    run: deckCandidatesCommand,
    takesSlug: true,
    summary: "List the deck's most valued left-out cards, so every exclusion has a reason",
    details:
      "Lists available cards the deck could play but leaves out (in its commanders' color identity and Commander-legal, for commander formats), most played on EDHREC first, then by price. Each shows its reason from the deck's considered list, or says it has none. Price and rank only flag cards for a second look; they don't judge fit. Ranks come from scryfall:refresh.",
    options: {
      limit: { type: 'string', placeholder: 'N', description: `How many to list; defaults to ${CANDIDATE_LIMIT}` },
      sort: { type: 'string', placeholder: 'KEY', description: 'edhrec (default) or price, highest first' },
      text: { ...SEARCH_OPTIONS.text },
      type: { ...SEARCH_OPTIONS.type },
      role: SEARCH_OPTIONS.role,
      lands: { type: 'boolean', description: 'Include lands' },
      oracle: SEARCH_OPTIONS.oracle,
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:verify': {
    run: deckVerifyCommand,
    takesSlug: true,
    summary:
      'Check that a deck is ready to hand off: deck:check plus primer, stats, left-out cards, upgrades and decklist files',
    details:
      "Errors: anything deck:check fails, a placeholder primer, a top --limit left-out card without a considered reason, upgrades over budget or without one, and decklist files that differ from what deck:files would write. Notes: lands more than one away from Karsten's suggestion and role counts outside their targets, which need explaining rather than fixing.",
    options: {
      limit: {
        type: 'string',
        placeholder: 'N',
        description: `How many top left-out cards need a reason; defaults to ${CANDIDATE_LIMIT}`,
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:upgrades': {
    run: deckUpgrades,
    takesSlug: true,
    summary: 'Price the upgrade package and any shortfalls against the budget',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'deck:build': {
    run: deckBuild,
    takesSlug: true,
    summary: "Physically build a finished deck: move its cards out of the collections into the deck's own list",
    details:
      "Only when the user says to build the deck. Takes every card, commanders included, out of the deck's available collections (the pinned printing first, then nonfoil copies, then the printing with the most copies; never proxies or protected copies), writes them to a text list, and sets collection_destination and status: built in deck.yaml. Upgrades are not applied. The deck must pass deck:check. Without --apply, prints what it would take and changes nothing.",
    options: {
      apply: { type: 'boolean', description: 'Edit the collections and deck.yaml; without it, only print the plan' },
      to: {
        type: 'string',
        placeholder: 'PATH',
        description:
          "The deck's new text list; defaults to MTG_BUILD_DESTINATION in .env, else collections/{owner}/decks/{name}.txt",
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:teardown': {
    run: deckTeardown,
    takesSlug: true,
    summary: "Take apart a built deck: return its cards from its own list to the collection's text lists",
    details:
      "Only when the user says they've taken the deck apart. The reverse of deck:build: adds every card in the deck's collection_destination list to the text list --to names (lands to --lands-to, if given), raising the quantity of a line with the same printing and finish or adding a line, in name order when the list is mostly sorted by name. Then deletes the deck's list, removes collection_destination and sets a built deck back to draft. Untracked basics aren't returned. Without --apply, prints what it would return and changes nothing.",
    options: {
      apply: { type: 'boolean', description: 'Edit the collections and deck.yaml; without it, only print the plan' },
      to: { type: 'string', placeholder: 'PATH', description: 'The text list under collections/ the cards go back to' },
      'lands-to': {
        type: 'string',
        placeholder: 'PATH',
        description: 'A separate text list for the lands; defaults to --to',
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:swap': {
    run: deckSwap,
    takesSlug: true,
    summary: 'Swap mainboard cards for others, moving the physical cards too when the deck is built',
    details:
      "Each --out pairs with the --in at the same place and swaps one copy; repeat a pair to swap more copies. In deck.yaml a new card takes the out card's place and role, keeping comments; each --reason becomes its out card's considered reason, each in card leaves considered, and history gains an entry dated today. For a built deck, the swapped deck must pass deck:check; each in card is taken from the other available collections into the deck's collection_destination list (the same copy order as deck:build), and each out card goes from that list back to the text list --to names (lands to --lands-to, if given). Only when the user says they've swapped the physical cards. Warns about upgrades the swap leaves stale. Without --apply, prints the plan and changes nothing.",
    options: {
      out: { type: 'string', multiple: true, placeholder: 'NAME', description: 'A mainboard card to take out' },
      in: { type: 'string', multiple: true, placeholder: 'NAME', description: 'The card to put in its place' },
      reason: {
        type: 'string',
        multiple: true,
        placeholder: 'TEXT',
        description:
          "Why the --out card at the same place left; becomes its considered reason and the history entry's notes",
      },
      apply: { type: 'boolean', description: 'Edit deck.yaml and, for a built deck, the collections' },
      to: {
        type: 'string',
        placeholder: 'PATH',
        description: 'For a built deck: the text list under collections/ the out cards go back to',
      },
      'lands-to': {
        type: 'string',
        placeholder: 'PATH',
        description: 'A separate text list for out lands; defaults to --to',
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'decks:check': {
    run: decksCheck,
    summary: 'Check every deck independently; the example is schema-checked only',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
};

const HELP_FLAGS = ['--help', '-h', 'help'];

function parseCommandLine([name, ...rest]) {
  if (name === undefined || HELP_FLAGS.includes(name)) return { helpText: overviewHelp(COMMANDS) };
  if (!Object.hasOwn(COMMANDS, name)) throw new Error(`Unknown command "${name}".\n\n${overviewHelp(COMMANDS)}`);
  const command = COMMANDS[name];
  const usageError = (message, cause) => new Error(`${message}\n\n${commandHelp(name, command)}`, { cause });
  let parsed;
  try {
    const options = parseArgsOptions(withHelpOption(command.options));
    parsed = parseArgs({ args: rest, options, allowPositionals: true, allowNegative: true, strict: true });
  } catch (error) {
    throw usageError(error.message, error);
  }
  const { help, ...options } = parsed.values;
  if (help) return { helpText: commandHelp(name, command) };
  const expectedPositionals = command.takesSlug ? 1 : 0;
  if (parsed.positionals.length !== expectedPositionals) {
    throw usageError(
      command.takesSlug ? `${name} needs exactly one <deck-slug>` : `${name} takes no positional arguments`,
    );
  }
  return { name, command, options, slug: parsed.positionals[0] };
}

const OUTPUT_MODES = ['text', 'json'];

// --json or --no-json wins, then the MTG_OUTPUT project default (see .env.example), for commands that
// can print JSON.
function printsJson(command, options, env) {
  if (!Object.hasOwn(command.options ?? {}, 'json')) return false;
  if (options.json !== undefined) return options.json;
  const mode = env.MTG_OUTPUT || 'text';
  if (!OUTPUT_MODES.includes(mode)) throw new Error(`MTG_OUTPUT must be one of: ${OUTPUT_MODES.join(', ')}`);
  return mode === 'json';
}

// Text output writes as it goes. JSON output keeps what commands emit and warn, then prints one line:
// { command, deck, outcome, data, warnings }, or { command, deck, outcome: "fail", error, warnings } if the
// command threw.
function outputFor(json, { write, warn }) {
  if (!json) return { write, warn, emit() {}, finish() {}, fail: null };
  const warnings = [];
  let data = {};
  return {
    write() {},
    warn: (line) => warnings.push(line.trim()),
    emit: (value) => {
      data = { ...data, ...value };
    },
    finish: (header, outcome) => write(JSON.stringify({ ...header, outcome, data, warnings })),
    fail: (header, error) => write(JSON.stringify({ ...header, outcome: 'fail', error: error.message, warnings })),
  };
}

// Returns the process exit code: 0 pass, 1 fail, 2 incomplete. Invalid input throws.
// A date as deck.yaml records it, in local time: "2026-11-02".
const localDate = (time) => new Date(time).toLocaleDateString('en-CA');

export async function runCli(
  args,
  {
    root,
    env = process.env,
    now = Date.now(),
    write = console.log,
    warn = console.error,
    copyText = copyToClipboard,
  } = {},
) {
  const { helpText, name, command, options, slug } = parseCommandLine(args);
  if (helpText) {
    write(helpText);
    return EXIT_CODES.pass;
  }
  const output = outputFor(printsJson(command, options, env), { write, warn });
  const header = { command: name, ...(slug && { deck: slug }) };
  const workspace = scopedWorkspace(openWorkspace(root), collectionScope(options, env), output.warn);
  const today = localDate(now);
  const context = { workspace, options, slug, env, today, copyText, write: output.write, warn: output.warn };
  let outcome;
  try {
    outcome = await command.run({ ...context, emit: output.emit });
  } catch (error) {
    if (!output.fail) throw error;
    output.fail(header, error);
    return EXIT_CODES.fail;
  }
  output.finish(header, outcome);
  return EXIT_CODES[outcome];
}

// Project defaults live in an untracked .env; .env.example documents them.
function loadProjectEnv() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    loadProjectEnv();
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = EXIT_CODES.fail;
  }
}
