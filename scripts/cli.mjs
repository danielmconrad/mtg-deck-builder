import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { emptyCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { summarize } from './collection.mjs';
import { deckEntries, exportDeck, newDeck } from './deck.mjs';
import { checkLines, collectionSummaryLine, searchJson, searchLines, statsLines, upgradeLines } from './format.mjs';
import { checkDeck, worstOutcome } from './rules.mjs';
import { fetchCards } from './scryfall.mjs';
import { searchCollection, searchFilters } from './search.mjs';
import { deckStats } from './stats.mjs';
import { upgradeReport } from './upgrades.mjs';
import { openWorkspace } from './workspace.mjs';

const EXIT_CODES = { pass: 0, fail: 1, incomplete: 2 };

const printAll = (write, lines) => {
  for (const line of lines) write(line);
};

async function collectionCheck({ workspace, write }) {
  for (const [name, rows] of Object.entries(await workspace.loadCollections())) {
    write(collectionSummaryLine(name, summarize(rows)));
  }
  return 'pass';
}

async function collectionSearch({ workspace, options, write, warn }) {
  const [collections, index] = await Promise.all([workspace.loadCollections(), workspace.loadCardIndex()]);
  const { results, unresolvedRows } = searchCollection(collections, index, searchFilters(options, index));
  if (unresolvedRows) {
    warn(`${unresolvedRows} collection rows have no cached card data and were skipped; run cards:refresh`);
  }
  printAll(write, options.json ? [searchJson(results)] : searchLines(results, { withOracleText: options.oracle }));
  return 'pass';
}

// Scryfall identifiers for every collection row and every card a deck or upgrade names.
function refreshIdentifiers(collections, decks) {
  const rowIdentifiers = [...collections.organized, ...collections.precons].map((row) => ({ id: row.scryfallId }));
  const entries = decks.flatMap((deck) => [
    ...deckEntries(deck),
    ...(deck.upgrades ?? []).flatMap((swap) => [swap.add, swap.cut]),
  ]);
  const entryIdentifiers = entries.map((entry) =>
    entry.scryfall_id ? { id: entry.scryfall_id } : { name: entry.name },
  );
  return [...rowIdentifiers, ...entryIdentifiers];
}

async function cardsRefresh({ workspace, options, write, warn }) {
  const [collections, loadedDecks] = await Promise.all([workspace.loadCollections(), workspace.loadAllDecks()]);
  const skipped = loadedDecks.filter(({ error }) => error);
  for (const { slug, error } of skipped) warn(`SKIPPED ${slug}: ${error.message}`);
  const previous = options.missing ? await workspace.loadCache() : emptyCache();
  const index = cardIndex(previous);
  const decks = loadedDecks.filter(({ deck }) => deck).map(({ deck }) => deck);
  const wanted = refreshIdentifiers(collections, decks).filter((identifier) => !index.isCached(identifier));
  const notFound = [];
  if (wanted.length) {
    const fetched = await fetchCards(wanted, { onProgress: (done, total) => write(`Fetched ${done}/${total}`) });
    notFound.push(...fetched.notFound);
    const cache = { ...previous, cards: { ...previous.cards, ...fetched.cards } };
    await workspace.saveCache(cache);
    write(
      `Cached ${Object.keys(cache.cards).length} printings (${Object.keys(fetched.cards).length} fetched from Scryfall).`,
    );
  } else {
    write('Card cache already covers every collection row and deck entry.');
  }
  for (const missing of notFound) warn(`UNRESOLVED: ${JSON.stringify(missing)}`);
  return notFound.length || skipped.length ? 'incomplete' : 'pass';
}

async function deckNew({ workspace, slug, options, write }) {
  const deck = newDeck(slug, { format: options.format, commanderNames: options.commander, name: options.name });
  const label = await workspace.createDeck(slug, deck);
  write(`Created ${label} with an empty mainboard. Set the strategy, basics policy, and cards next.`);
  return 'pass';
}

async function deckCheck({ workspace, slug, write }) {
  const [deck, collections, index] = await Promise.all([
    workspace.loadDeck(slug),
    workspace.loadCollections(),
    workspace.loadCardIndex(),
  ]);
  const report = checkDeck(deck, collections, index);
  printAll(write, checkLines(slug, report));
  return report.outcome;
}

async function deckStatsCommand({ workspace, slug, write }) {
  const [deck, index] = await Promise.all([workspace.loadDeck(slug), workspace.loadCardIndex()]);
  const stats = deckStats(deck, index);
  printAll(write, statsLines(deck, stats));
  return stats.problems.length ? 'incomplete' : 'pass';
}

async function deckExport({ workspace, slug, write, warn }) {
  warn('Export does not validate the deck; run deck:check first.');
  write(exportDeck(await workspace.loadDeck(slug)).trimEnd());
  return 'pass';
}

async function deckUpgrades({ workspace, slug, write }) {
  const [deck, collections, index] = await Promise.all([
    workspace.loadDeck(slug),
    workspace.loadCollections(),
    workspace.loadCardIndex(),
  ]);
  const report = upgradeReport(deck, collections, index);
  printAll(write, upgradeLines(report));
  return report.outcome;
}

async function decksCheck({ workspace, write }) {
  const loadedDecks = await workspace.loadAllDecks();
  const candidates = loadedDecks.filter(({ deck }) => deck && deck.status !== 'example');
  const [collections, index] = candidates.length
    ? await Promise.all([workspace.loadCollections(), workspace.loadCardIndex()])
    : [];
  const outcomes = loadedDecks.map(({ slug, deck, error }) => {
    if (error) {
      write(`FAIL: ${slug}: ${error.message}`);
      return 'fail';
    }
    if (deck.status === 'example') {
      write(`SCHEMA ONLY: ${slug} (example template)`);
      return 'pass';
    }
    const report = checkDeck(deck, collections, index);
    printAll(write, checkLines(slug, report));
    return report.outcome;
  });
  if (loadedDecks.every(({ deck }) => deck?.status === 'example')) write('No decks yet besides the example.');
  return worstOutcome(outcomes);
}

const SEARCH_OPTIONS = {
  name: { type: 'string' },
  type: { type: 'string', multiple: true },
  text: { type: 'string', multiple: true },
  identity: { type: 'string' },
  commander: { type: 'string' },
  legal: { type: 'string' },
  'min-mv': { type: 'string' },
  'max-mv': { type: 'string' },
  precons: { type: 'boolean' },
  proxies: { type: 'boolean' },
  oracle: { type: 'boolean' },
  json: { type: 'boolean' },
};

const NEW_DECK_OPTIONS = {
  commander: { type: 'string', multiple: true },
  format: { type: 'string' },
  name: { type: 'string' },
};

const COMMANDS = {
  'collection:check': { run: collectionCheck },
  'collection:search': {
    run: collectionSearch,
    options: SEARCH_OPTIONS,
    usage:
      '[--commander NAME | --identity WUBRG] [--type RE]... [--text RE]... [--name RE] [--min-mv N] [--max-mv N] [--legal FORMAT] [--precons] [--proxies] [--oracle] [--json]',
  },
  'cards:refresh': { run: cardsRefresh, options: { missing: { type: 'boolean' } }, usage: '[--missing]' },
  'deck:new': {
    run: deckNew,
    takesSlug: true,
    options: NEW_DECK_OPTIONS,
    usage: '[--commander NAME]... [--format commander|casual-60] [--name TEXT]',
  },
  'deck:check': { run: deckCheck, takesSlug: true },
  'deck:stats': { run: deckStatsCommand, takesSlug: true },
  'deck:export': { run: deckExport, takesSlug: true },
  'deck:upgrades': { run: deckUpgrades, takesSlug: true },
  'decks:check': { run: decksCheck },
};

function usage() {
  const lines = Object.entries(COMMANDS).map(([name, command]) =>
    [name, command.takesSlug && '<deck-slug>', command.usage].filter(Boolean).join(' '),
  );
  return `Usage:\n${lines.map((line) => `  ${line}`).join('\n')}`;
}

function parseCommandLine([name, ...rest]) {
  const command = Object.hasOwn(COMMANDS, name ?? '') ? COMMANDS[name] : null;
  if (!command) throw new Error(usage());
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: command.options ?? {}, allowPositionals: true, strict: true });
  } catch (error) {
    throw new Error(`${error.message}\n${usage()}`, { cause: error });
  }
  const expectedPositionals = command.takesSlug ? 1 : 0;
  if (parsed.positionals.length !== expectedPositionals) throw new Error(usage());
  return { command, options: parsed.values, slug: parsed.positionals[0] };
}

// Returns the process exit code: 0 pass, 1 fail, 2 incomplete. Invalid input throws.
export async function runCli(args, { root, write = console.log, warn = console.error } = {}) {
  const { command, options, slug } = parseCommandLine(args);
  const outcome = await command.run({ workspace: openWorkspace(root), options, slug, write, warn });
  return EXIT_CODES[outcome];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = EXIT_CODES.fail;
  }
}
