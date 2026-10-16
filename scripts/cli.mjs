import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { emptyCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { summarize } from './collection.mjs';
import { copyToClipboard } from './clipboard.mjs';
import { applyUpgrades, deckEntries, newDeck, splitUpgrades } from './deck.mjs';
import { EXPORT_FORMAT_NAMES, PASTE_HINTS, exportDeck, printingChooser } from './export.mjs';
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

// --upgrades apply makes every swap; split keeps the deck, with cuts and adds in their own sections.
function withUpgrades(deck, mode) {
  if (mode === undefined) return deck;
  if (mode === 'apply') return applyUpgrades(deck);
  if (mode === 'split') return splitUpgrades(deck);
  throw new Error('--upgrades must be one of: apply, split');
}

// --format wins, then the MTG_EXPORT_FORMAT project default (see .env.example), then text.
function exportFormat(options, env) {
  const format = options.format ?? env.MTG_EXPORT_FORMAT ?? 'text';
  if (!EXPORT_FORMAT_NAMES.includes(format)) {
    const source = options.format === undefined ? 'MTG_EXPORT_FORMAT' : '--format';
    throw new Error(`${source} must be one of: ${EXPORT_FORMAT_NAMES.join(', ')}`);
  }
  return format;
}

// Loads what every export needs once, then renders the deck under each requested upgrades mode.
async function exporter(workspace, slug, warn) {
  const [deck, collections, index] = await Promise.all([
    workspace.loadDeck(slug),
    workspace.loadCollections(),
    workspace.loadCardIndex(),
  ]);
  const uncached = new Set();
  const printingOf = printingChooser(index, collections.organized, uncached);
  warn('Export does not validate the deck; run deck:check first.');
  const render = (format, upgradesMode) => exportDeck(withUpgrades(deck, upgradesMode), { format, printingOf });
  const warnUncached = () => {
    if (uncached.size) {
      warn(`Printings not cached, exported by name only: ${[...uncached].join(', ')} (run cards:refresh)`);
    }
  };
  const warnApplied = () =>
    warn(`Applied ${deck.upgrades.length} upgrade swaps; some added cards may not be owned yet.`);
  return { deck, render, warnUncached, warnApplied };
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

const DECKLIST_FILE = 'decklist.txt';
const UPGRADED_DECKLIST_FILE = 'decklist-upgraded.txt';

// Writes the decklists kept in Git beside deck.yaml: the deck with upgrade swaps split out, and,
// when the deck has upgrades, the deck with every swap made.
async function deckFiles({ workspace, slug, options, env, write, warn }) {
  const format = exportFormat(options, env);
  const { deck, render, warnUncached } = await exporter(workspace, slug, warn);
  const written = [await workspace.writeDeckFile(slug, DECKLIST_FILE, render(format, 'split'))];
  if (deck.upgrades?.length) {
    written.push(await workspace.writeDeckFile(slug, UPGRADED_DECKLIST_FILE, render(format, 'apply')));
  } else {
    await workspace.removeDeckFile(slug, UPGRADED_DECKLIST_FILE);
  }
  warnUncached();
  write(`Wrote ${written.join(' and ')} in ${format} format.`);
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

const FORMAT_OPTION = {
  type: 'string',
  placeholder: 'FORMAT',
  description: `${EXPORT_FORMAT_NAMES.join(', ')}; defaults to MTG_EXPORT_FORMAT in .env, else text`,
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
    details:
      'Does not validate the deck. Moxfield and Archidekt lines carry set and collector number: the pinned scryfall_id, else the printing owned in Organized, else a cached printing.',
    options: {
      format: FORMAT_OPTION,
      upgrades: {
        type: 'string',
        placeholder: 'MODE',
        description:
          'apply: make every upgrade swap, e.g. for playtesting; split: keep the deck, listing cuts under Swap Out and adds in the sideboard',
      },
      copy: { type: 'boolean', description: 'Copy to the clipboard instead of printing' },
    },
  },
  'deck:files': {
    run: deckFiles,
    takesSlug: true,
    summary: 'Write the decklist files kept beside deck.yaml',
    details: `Writes ${DECKLIST_FILE} (upgrade cuts under Swap Out, adds in the sideboard) and, if the deck has upgrades, ${UPGRADED_DECKLIST_FILE} (every swap made). Overwrites both; rerun after every deck edit. Does not validate the deck.`,
    options: { format: FORMAT_OPTION },
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
  { root, env = process.env, write = console.log, warn = console.error, copyText = copyToClipboard } = {},
) {
  const { helpText, command, options, slug } = parseCommandLine(args);
  if (helpText) {
    write(helpText);
    return EXIT_CODES.pass;
  }
  const outcome = await command.run({ workspace: openWorkspace(root), options, slug, env, write, warn, copyText });
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
