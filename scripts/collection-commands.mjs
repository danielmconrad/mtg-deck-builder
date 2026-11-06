// collection:check, collection:search and card:show: what the collections and the card cache hold.
import { cacheStatus, cardReports } from './card-report.mjs';
import { collectionChanges, decksNaming } from './collection-diff.mjs';
import { summarize } from './collection.mjs';
import {
  cacheStatusLine,
  cardReportLines,
  collectionDiffLines,
  collectionSummaryLine,
  countLine,
  groupLines,
  printAll,
  searchLines,
} from './format.mjs';
import { cacheStatusJson, cardReportJson, collectionJson, searchResultJson } from './json.mjs';
import { countResults, groupResults, searchCollection, searchFilters, sortResults } from './search.mjs';

// Text list lines whose printing isn't cached yet are listed, since they count toward nothing.
export async function collectionCheck({ workspace, now, write, warn, emit }) {
  let unmatched = 0;
  const [{ sources }, cache, index] = await Promise.all([
    workspace.loadCollections(),
    workspace.loadCache(),
    workspace.loadCardIndex(),
  ]);
  const status = cacheStatus(cache, index, now);
  write(cacheStatusLine(status));
  emit({
    cache: cacheStatusJson(status),
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

export async function collectionSearch({ workspace, options, write, warn, emit }) {
  if (options.count && options['group-by']) throw new Error('Use --count or --group-by, not both');
  const [collections, index] = await Promise.all([workspace.loadCollections(), workspace.loadCardIndex()]);
  const { results, unresolvedRows } = searchCollection(collections, index, searchFilters(options, index));
  if ((options.unowned || options['all-cards']) && !index.isFromBulk()) {
    const flag = options.unowned ? '--unowned' : '--all-cards';
    warn(
      `The card cache holds only collection and deck cards, so ${flag} finds few; scryfall:refresh -- --bulk caches every card`,
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
  const withPrinting = Boolean(options.set || options.rarity);
  return searchLines(results, { withOracleText: options.oracle, withValues, withPrinting });
}

function searchData(results, options) {
  if (options['group-by']) return { groups: groupResults(results, options['group-by']) };
  if (options.count) return { count: countResults(results) };
  return { cards: results.map(searchResultJson) };
}

// Any card by name, owned or not, with where the collections and decks hold or name it.
export async function cardShow({ workspace, names, write, emit }) {
  const [collections, index, loadedDecks] = await Promise.all([
    workspace.loadCollections(),
    workspace.loadCardIndex(),
    workspace.loadAllDecks(),
  ]);
  const decks = loadedDecks.filter(({ deck }) => deck && deck.status !== 'example');
  const reports = cardReports(names, { index, collections, decks });
  emit({ cards: reports.map(cardReportJson) });
  printAll(write, cardReportLines(reports));
  return reports.some((report) => report.problem) ? 'incomplete' : 'pass';
}

// What each collection file gained or lost since a Git commit, and which decks name those cards.
export async function collectionDiff({ workspace, options, write, emit }) {
  const ref = options.ref ?? 'HEAD';
  const [before, after, loadedDecks] = await Promise.all([
    workspace.collectionRows(ref),
    workspace.collectionRows(),
    workspace.loadAllDecks(),
  ]);
  const changes = collectionChanges(before, after);
  const decks = decksNaming(
    changes,
    loadedDecks.filter(({ deck }) => deck && deck.status !== 'example'),
  );
  emit({ ref, collections: changes, decks });
  printAll(write, collectionDiffLines(ref, changes, decks));
  return 'pass';
}
