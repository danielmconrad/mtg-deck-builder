import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { emptyCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { summarize } from './collection.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { deckEntries, newDeck } from './deck.mjs';
import { PASTE_HINTS, exportDeck } from './export.mjs';
import {
  checkLines,
  collectionSummaryLine,
  countLine,
  groupLines,
  searchJson,
  searchLines,
  statsLines,
  upgradeLines,
} from './format.mjs';
import { checkDeck, worstOutcome } from './rules.mjs';
import { fetchCards } from './scryfall.mjs';
import { GROUP_BY_CHOICES, countResults, groupResults, searchCollection, searchFilters } from './search.mjs';
import { deckStats } from './stats.mjs';
import { commandHelp, overviewHelp, parseArgsOptions, withHelpOption } from './help.mjs';
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
  if (options.count && options['group-by']) throw new Error('Use --count or --group-by, not both');
  const [collections, index] = await Promise.all([workspace.loadCollections(), workspace.loadCardIndex()]);
  const { results, unresolvedRows } = searchCollection(collections, index, searchFilters(options, index));
  if (unresolvedRows) {
    warn(`${unresolvedRows} collection rows have no cached card data and were skipped; run cards:refresh`);
  }
  printAll(write, searchOutput(results, options));
  return 'pass';
}

// --group-by and --count summarize instead of listing; --json applies to whichever is printed.
function searchOutput(results, options) {
  const asJson = (value) => [JSON.stringify(value, null, 2)];
  if (options['group-by']) {
    const groups = groupResults(results, options['group-by']);
    return options.json ? asJson(groups) : groupLines(groups);
  }
  if (options.count) return options.json ? asJson(countResults(results)) : [countLine(countResults(results))];
  return options.json ? [searchJson(results)] : searchLines(results, { withOracleText: options.oracle });
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

async function deckExport({ workspace, slug, options, write, warn, copyText }) {
  const [deck, index] = await Promise.all([workspace.loadDeck(slug), workspace.loadCardIndex()]);
  const uncachedPins = new Set();
  const printingOf = (entry) => {
    if (!entry.scryfall_id) return null;
    const card = index.byId.get(entry.scryfall_id);
    if (!card) uncachedPins.add(entry.name);
    return card ?? null;
  };
  const format = options.format ?? 'text';
  const text = exportDeck(deck, { format, printingOf });
  warn('Export does not validate the deck; run deck:check first.');
  if (uncachedPins.size) {
    warn(`Pinned printings not cached, exported by name only: ${[...uncachedPins].join(', ')} (run cards:refresh)`);
  }
  if (!options.copy) {
    write(text.trimEnd());
    return 'pass';
  }
  await copyText(text);
  write(`Copied ${slug} in ${format} format to the clipboard. ${PASTE_HINTS[format]}`);
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
  commander: {
    type: 'string',
    placeholder: 'NAME',
    description: "Limit to this commander's color identity and Commander-legal cards",
  },
  commanders: {
    type: 'boolean',
    description: 'Only cards that can be a commander: legendary creatures, Backgrounds, "can be your commander"',
  },
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
  name: { type: 'string', placeholder: 'REGEX', description: 'Card name must match (case-insensitive)' },
  'min-mv': { type: 'string', placeholder: 'N', description: 'Minimum mana value' },
  'max-mv': { type: 'string', placeholder: 'N', description: 'Maximum mana value' },
  legal: { type: 'string', placeholder: 'FORMAT', description: 'Must be legal in this Scryfall format, e.g. modern' },
  precons: { type: 'boolean', description: 'Also list cards that only exist in Precons' },
  proxies: { type: 'boolean', description: 'Count proxy rows as owned copies' },
  oracle: { type: 'boolean', description: "Print each card's rules text" },
  count: { type: 'boolean', description: 'Print only how many distinct cards and copies match' },
  'group-by': {
    type: 'string',
    placeholder: 'KEY',
    description: `Count matches per group instead of listing them: ${GROUP_BY_CHOICES.join(' or ')}`,
  },
  json: { type: 'boolean', description: 'Print machine-readable JSON (list, count or groups)' },
};

const COMMANDS = {
  'collection:check': {
    run: collectionCheck,
    summary: 'Validate both collection exports and summarize them',
  },
  'collection:search': {
    run: collectionSearch,
    summary: 'Search owned cards by color identity, type, rules text and mana value',
    details: 'Searches Organized; Precons copies are shown as protected. Filters combine with AND.',
    options: SEARCH_OPTIONS,
  },
  'cards:refresh': {
    run: cardsRefresh,
    summary: 'Fetch Scryfall card data and prices for the collection and every deck (network)',
    options: { missing: { type: 'boolean', description: 'Fetch only cards not already cached' } },
  },
  'deck:new': {
    run: deckNew,
    takesSlug: true,
    summary: 'Create a draft deck at decks/<deck-slug>/deck.yaml; never overwrites',
    options: {
      commander: {
        type: 'string',
        multiple: true,
        placeholder: 'NAME',
        description: 'Commander card; required for Commander, repeat for partners',
      },
      format: { type: 'string', placeholder: 'FORMAT', description: 'commander (default) or casual-60' },
      name: { type: 'string', placeholder: 'TEXT', description: 'Deck name; defaults to the slug in title case' },
    },
  },
  'deck:check': {
    run: deckCheck,
    takesSlug: true,
    summary: 'Check size, commander rules, color identity, bans, copy limits and ownership',
  },
  'deck:stats': {
    run: deckStatsCommand,
    takesSlug: true,
    summary: 'Show mainboard curve, card types, color pips, land sources and roles',
  },
  'deck:export': {
    run: deckExport,
    takesSlug: true,
    summary: 'Print a paste-ready decklist for another site, or copy it to the clipboard',
    details: 'Does not validate the deck. Pinned scryfall_id printings export with set and collector number.',
    options: {
      format: { type: 'string', placeholder: 'FORMAT', description: 'text (default), moxfield or archidekt' },
      copy: { type: 'boolean', description: 'Copy to the clipboard instead of printing' },
    },
  },
  'deck:upgrades': {
    run: deckUpgrades,
    takesSlug: true,
    summary: 'Price the upgrade package and any shortfalls against the budget',
  },
  'decks:check': {
    run: decksCheck,
    summary: 'Check every deck independently; the example is schema-checked only',
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
    parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true });
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
  return { command, options, slug: parsed.positionals[0] };
}

// Returns the process exit code: 0 pass, 1 fail, 2 incomplete. Invalid input throws.
export async function runCli(
  args,
  { root, write = console.log, warn = console.error, copyText = copyToClipboard } = {},
) {
  const { helpText, command, options, slug } = parseCommandLine(args);
  if (helpText) {
    write(helpText);
    return EXIT_CODES.pass;
  }
  const outcome = await command.run({ workspace: openWorkspace(root), options, slug, write, warn, copyText });
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
