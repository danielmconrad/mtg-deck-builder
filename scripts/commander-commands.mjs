// collection:commanders and edhrec:refresh: which commanders, owned or not, the collection supports.
import { commanderFilters, rankCommanders } from './commanders.mjs';
import { DEFAULT_MAX_AGE_DAYS, emptyEdhrecCache, fetchPages, isStale } from './edhrec.mjs';
import { commanderLines, printAll } from './format.mjs';
import { commanderJson } from './json.mjs';

export const COMMANDER_LIMIT = 25;

// edhrecCache is the EDHREC cache, or a promise of it; edhrec:refresh passes the one it's refreshing.
async function loadRanking(workspace, options, warn, edhrecCache = workspace.loadEdhrec()) {
  const [collections, index, loadedDecks, edhrec] = await Promise.all([
    workspace.loadCollections(),
    workspace.loadCardIndex(),
    workspace.loadAllDecks(),
    edhrecCache,
  ]);
  if (!index.isFromBulk()) {
    warn(
      'The card cache holds only collection and deck cards, so unowned commanders are missing; scryfall:refresh -- --bulk caches every card',
    );
  }
  const decks = loadedDecks.filter(({ deck }) => deck && deck.status !== 'example');
  const filters = commanderFilters(options);
  const ranking = rankCommanders(collections, index, filters, { edhrec: edhrec.commanders, decks });
  if (ranking.unresolvedRows) {
    warn(`${ranking.unresolvedRows} collection rows have no cached card data and were skipped; run scryfall:refresh`);
  }
  return { index, filters, ranking, edhrec };
}

export async function collectionCommanders({ workspace, options, write, warn, emit }) {
  const { filters, ranking, edhrec } = await loadRanking(workspace, options, warn);
  if (filters.sort === 'edhrec' && !Object.keys(edhrec.commanders).length) {
    warn('No EDHREC pages are cached, so --sort edhrec falls back to lift; run edhrec:refresh');
  }
  const limit = options.limit ?? COMMANDER_LIMIT;
  const { results, considered, belowMinimum, unthemed } = ranking;
  emit({
    considered,
    listed: results.length,
    below_minimum: belowMinimum,
    unthemed,
    commanders: results.slice(0, limit).map(commanderJson),
  });
  printAll(
    write,
    commanderLines(results, {
      limit,
      withOracleText: options.oracle,
      sort: filters.sort,
      minCards: filters.minCards,
      belowMinimum,
      unthemed,
      considered,
      themeFiltered: Boolean(filters.theme),
    }),
  );
  return 'pass';
}

// The commanders to fetch: each --commander by its cached name, then the top of collection:commanders'
// ranking with the same filters.
async function wantedCommanders(workspace, options, warn, cache) {
  if (!options.commander?.length && !options.top) {
    throw new Error('Name commanders with --commander, or pass --top N to fetch the best-ranked ones');
  }
  const index = await workspace.loadCardIndex();
  const named = (options.commander ?? []).map((name) => {
    const { card, problem } = index.lookup({ name });
    if (problem) throw new Error(problem);
    return card.name;
  });
  const top = options.top
    ? (await loadRanking(workspace, options, warn, cache)).ranking.results.slice(0, options.top)
    : [];
  return [...new Set([...named, ...top.map(({ card }) => card.name)])];
}

// Fetches EDHREC's commander pages, skipping ones cached within --max-age days unless --force. The
// pages fetched are saved even if a later request fails.
export async function edhrecRefresh({ workspace, options, now, pause, write, warn, emit }) {
  // A cache this version can't read is replaced, so it never blocks the refresh that fixes it.
  const cache = await workspace.loadEdhrec().catch(() => emptyEdhrecCache());
  const names = await wantedCommanders(workspace, options, warn, cache);
  const maxAge = options['max-age'] ?? DEFAULT_MAX_AGE_DAYS;
  const wanted = names.filter((name) => options.force || isStale(cache.commanders[name], now, maxAge));
  const fetched = [];
  try {
    await fetchPages(wanted, {
      pause,
      now,
      onPage: (name, page, done) => {
        cache.commanders[name] = page;
        fetched.push({ name, page });
        write(`Fetched ${done}/${wanted.length}: ${name}${page.missing ? ' (no EDHREC page)' : ''}`);
      },
    });
  } finally {
    if (fetched.length) await workspace.saveEdhrec(cache);
  }
  const missing = fetched.filter(({ page }) => page.missing).map(({ name }) => name);
  for (const name of missing) warn(`NO EDHREC PAGE: ${name}`);
  write(
    `Cached EDHREC pages for ${names.length} commanders: ${fetched.length} fetched, ${names.length - wanted.length} already fresh (within ${maxAge} days).`,
  );
  emit({
    commanders: names,
    fetched: fetched.map(({ name }) => name),
    already_cached: names.filter((name) => !wanted.includes(name)),
    missing,
  });
  return 'pass';
}
