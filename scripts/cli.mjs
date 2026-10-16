import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { stringify } from 'yaml';
import { CACHE_VERSION, DAY_MS, PRICE_MAX_AGE_MS, cardIndex, emptyCache, fetchCards, loadCache, saveCache } from './cards.mjs';
import { loadCollections, summarize } from './collection.mjs';
import { checkDeck, deckEntries, exportDeck, parseDeck, upgradeReport } from './deck.mjs';
import { parseIdentity, searchCollection } from './search.mjs';
import { deckStats, formatStats } from './stats.mjs';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const EXIT = { ok: 0, failed: 1, incomplete: 2 };

function deckPath(root, slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Deck slug must contain lowercase letters, numbers, and single hyphens only');
  return `${root}/decks/${slug}/deck.yaml`;
}

async function loadDeck(root, slug) {
  return parseDeck(await readFile(deckPath(root, slug), 'utf8'), `decks/${slug}/deck.yaml`);
}

// Loads every deck folder, keeping parse failures per deck instead of aborting the rest.
async function loadAllDecks(root) {
  const folders = (await readdir(`${root}/decks`, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  folders.sort((first, second) => first.name.localeCompare(second.name));
  return Promise.all(folders.map(async ({ name: slug }) => {
    try {
      return { slug, deck: await loadDeck(root, slug) };
    } catch (error) {
      return { slug, error };
    }
  }));
}

const loadIndex = async (root) => cardIndex(await loadCache(root));

function printCheck(slug, report, write) {
  const status = report.errors.length ? 'FAIL' : report.incomplete.length ? 'INCOMPLETE' : 'PASS';
  write(`${status}: ${slug} (${report.total} cards)`);
  for (const message of report.errors) write(`  ERROR: ${message}`);
  for (const message of report.incomplete) write(`  INCOMPLETE: ${message}`);
  for (const message of report.warnings) write(`  NOTE: ${message}`);
  return report.errors.length ? EXIT.failed : report.incomplete.length ? EXIT.incomplete : EXIT.ok;
}

const worst = (codes) => (codes.includes(EXIT.failed) ? EXIT.failed : Math.max(EXIT.ok, ...codes));

async function collectionCheck({ root, write }) {
  for (const [name, rows] of Object.entries(await loadCollections(root))) {
    const { rows: count, copies, names, proxyCopies } = summarize(rows);
    write(`${name}: ${count} rows, ${copies} copies, ${names} distinct names, ${proxyCopies} proxy copies`);
  }
  return EXIT.ok;
}

async function collectionSearch({ root, options, write, warn }) {
  if (options.commander && options.identity) throw new Error('Use --commander or --identity, not both');
  const number = (value, flag) => {
    if (value === undefined) return undefined;
    if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`${flag} must be a number`);
    return Number(value);
  };
  const pattern = (value) => new RegExp(value, 'i');
  const index = await loadIndex(root);
  const filters = {
    name: options.name && pattern(options.name),
    type: options.type?.map(pattern),
    text: options.text?.map(pattern),
    identity: options.identity && parseIdentity(options.identity),
    legal: options.legal,
    minMv: number(options['min-mv'], '--min-mv'),
    maxMv: number(options['max-mv'], '--max-mv'),
    precons: options.precons,
    proxies: options.proxies,
  };
  if (options.commander) {
    const { card, problem } = index.lookup({ name: options.commander });
    if (problem) throw new Error(problem);
    filters.identity = new Set(card.color_identity);
    filters.legal ??= 'commander';
  }
  const { results, unresolved } = searchCollection(await loadCollections(root), index, filters);
  if (unresolved) warn(`${unresolved} collection rows have no cached card data and were skipped; run cards:refresh`);
  if (options.json) {
    write(JSON.stringify(results.map(({ card, organized, precons }) => ({
      name: card.name,
      organized,
      precons,
      mana_cost: card.mana_cost,
      mana_value: card.cmc,
      type_line: card.type_line,
      color_identity: card.color_identity,
      oracle_text: card.oracle_text,
    })), null, 2));
    return EXIT.ok;
  }
  for (const { card, organized, precons } of results) {
    const protectedCopies = precons ? ` (+${precons} in Precons)` : '';
    write(`${organized}x ${card.name} ${card.mana_cost} — ${card.type_line} [${card.color_identity.join('') || 'C'}]${protectedCopies}`);
    if (options.oracle) for (const line of card.oracle_text.split('\n')) write(`    ${line}`);
  }
  write(`${results.length} cards`);
  return EXIT.ok;
}

async function cardsRefresh({ root, options, write, warn }) {
  const collections = await loadCollections(root);
  const identifiers = [...collections.organized, ...collections.precons].map((row) => ({ id: row.scryfallId }));
  let exitCode = EXIT.ok;
  for (const { slug, deck, error } of await loadAllDecks(root)) {
    if (error) {
      warn(`SKIPPED ${slug}: ${error.message}`);
      exitCode = EXIT.incomplete;
      continue;
    }
    for (const entry of [...deckEntries(deck), ...(deck.upgrades ?? []).flatMap((swap) => [swap.add, swap.cut])]) {
      identifiers.push(entry.scryfall_id ? { id: entry.scryfall_id } : { name: entry.name });
    }
  }
  const existing = options.missing ? await loadCache(root) : emptyCache();
  const index = cardIndex(existing);
  const wanted = identifiers.filter((identifier) => (identifier.id ? !index.byId.has(identifier.id) : index.lookup(identifier).problem));
  if (!wanted.length) {
    write('Card cache already covers every collection row and deck entry.');
    return exitCode;
  }
  const { cards, notFound } = await fetchCards(wanted, { onBatch: (count, total) => write(`Fetched ${count}/${total}`) });
  const cache = { version: CACHE_VERSION, cards: { ...existing.cards, ...cards } };
  await saveCache(root, cache);
  write(`Cached ${Object.keys(cache.cards).length} printings (${Object.keys(cards).length} fetched from Scryfall).`);
  for (const missing of notFound) warn(`UNRESOLVED: ${JSON.stringify(missing)}`);
  return notFound.length ? EXIT.incomplete : exitCode;
}

async function deckNew({ root, slug, options, write }) {
  const format = options.format ?? 'commander';
  const commanders = (options.commander ?? []).map((name) => ({ name, quantity: 1 }));
  if (format === 'commander' && !commanders.length) throw new Error('Commander decks need --commander "<name>" (repeat it for a partner pair)');
  const deck = {
    schema_version: 1,
    name: options.name ?? slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '),
    format,
    status: 'draft',
    allow_proxies: false,
    unlimited_basics: false,
    strategy: 'Describe the game plan.',
    commanders,
    mainboard: [],
    upgrades: [],
    playtests: [],
  };
  const text = `# yaml-language-server: $schema=../../schemas/deck.schema.json\n${stringify(deck)}`;
  parseDeck(text, `decks/${slug}/deck.yaml`);
  const path = deckPath(root, slug);
  await mkdir(`${root}/decks/${slug}`, { recursive: true });
  await writeFile(path, text, { flag: 'wx' });
  write(`Created decks/${slug}/deck.yaml with an empty mainboard. Set the strategy, basics policy, and cards next.`);
  return EXIT.ok;
}

async function deckCheck({ root, slug, write }) {
  const [deck, collections, index] = await Promise.all([loadDeck(root, slug), loadCollections(root), loadIndex(root)]);
  return printCheck(slug, checkDeck(deck, collections, index), write);
}

async function deckStatsCommand({ root, slug, write }) {
  const [deck, index] = await Promise.all([loadDeck(root, slug), loadIndex(root)]);
  const stats = deckStats(deck, index);
  for (const line of formatStats(deck, stats)) write(line);
  for (const problem of stats.problems) write(`  INCOMPLETE: ${problem}`);
  return stats.problems.length ? EXIT.incomplete : EXIT.ok;
}

async function deckExport({ root, slug, write, warn }) {
  warn('Export does not validate the deck; run deck:check first.');
  write(exportDeck(await loadDeck(root, slug)).trimEnd());
  return EXIT.ok;
}

async function deckUpgrades({ root, slug, write }) {
  const [deck, collections, index] = await Promise.all([loadDeck(root, slug), loadCollections(root), loadIndex(root)]);
  const report = upgradeReport(deck, collections, index);
  const { currency } = deck.budget;
  write(`Cards Organized cannot supply, priced at the cheapest cached Scryfall nonfoil ${currency} quote under ${PRICE_MAX_AGE_MS / DAY_MS} days old. Excludes shipping and tax.`);
  for (const line of report.lines) write(`  ${line}`);
  const total = `${(report.totalCents / 100).toFixed(2)} of ${(report.budgetCents / 100).toFixed(2)} ${currency} budget`;
  if (!report.complete) {
    write(`INCOMPLETE: known prices total ${total}`);
    return EXIT.incomplete;
  }
  write(`${report.withinBudget ? 'WITHIN BUDGET' : 'OVER BUDGET'}: ${total}`);
  return report.withinBudget ? EXIT.ok : EXIT.failed;
}

async function decksCheck({ root, write }) {
  const decks = await loadAllDecks(root);
  const candidates = decks.filter(({ deck }) => deck?.status !== 'example');
  const [collections, index] = candidates.some(({ deck }) => deck)
    ? await Promise.all([loadCollections(root), loadIndex(root)])
    : [];
  const codes = [];
  for (const { slug, deck, error } of decks) {
    if (error) {
      write(`FAIL: ${slug}: ${error.message}`);
      codes.push(EXIT.failed);
    } else if (deck.status === 'example') {
      write(`SCHEMA ONLY: ${slug} (example template)`);
    } else {
      codes.push(printCheck(slug, checkDeck(deck, collections, index), write));
    }
  }
  if (!candidates.length) write('No decks yet besides the example.');
  return worst(codes);
}

const searchOptions = {
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

const commands = {
  'collection:check': { run: collectionCheck },
  'collection:search': { run: collectionSearch, options: searchOptions, usage: '[--commander NAME | --identity WUBRG] [--type RE] [--text RE] [--name RE] [--min-mv N] [--max-mv N] [--legal FORMAT] [--precons] [--proxies] [--oracle] [--json]' },
  'cards:refresh': { run: cardsRefresh, options: { missing: { type: 'boolean' } }, usage: '[--missing]' },
  'deck:new': { run: deckNew, slug: true, options: { commander: { type: 'string', multiple: true }, format: { type: 'string' }, name: { type: 'string' } }, usage: '[--commander NAME]... [--format commander|casual-60] [--name TEXT]' },
  'deck:check': { run: deckCheck, slug: true },
  'deck:stats': { run: deckStatsCommand, slug: true },
  'deck:export': { run: deckExport, slug: true },
  'deck:upgrades': { run: deckUpgrades, slug: true },
  'decks:check': { run: decksCheck },
};

const usage = () => `Usage:\n${Object.entries(commands)
  .map(([name, command]) => `  ${[name, command.slug && '<deck-slug>', command.usage].filter(Boolean).join(' ')}`)
  .join('\n')}`;

export async function runCli(args, { root = projectRoot, write = console.log, warn = console.error } = {}) {
  const [name, ...rest] = args;
  const command = Object.hasOwn(commands, name ?? '') ? commands[name] : null;
  if (!command) throw new Error(usage());
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: command.options ?? {}, allowPositionals: true, strict: true });
  } catch (error) {
    throw new Error(`${error.message}\n${usage()}`);
  }
  if (parsed.positionals.length !== (command.slug ? 1 : 0)) throw new Error(usage());
  return command.run({ root, write, warn, options: parsed.values, slug: parsed.positionals[0] });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = EXIT.failed;
  }
}
