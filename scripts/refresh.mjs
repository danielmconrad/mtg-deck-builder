// scryfall:refresh: the only command that uses the network.
import { emptyCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { deckEntries } from './deck.mjs';
import { fetchBulkCards, fetchCards } from './scryfall.mjs';

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

// Where a refresh starts, and whether it fetches every collection and deck card again or only the
// ones the cache lacks:
// - --bulk: every printing in Scryfall's bulk data, then only what that lacks.
// - --missing: the current cache, then only what it lacks.
// - plain, on a cache built from bulk data: that cache, with every collection and deck card fetched
//   again, so their prices are fresh and the other printings stay for --unowned.
// - plain on any other cache, or --prune: nothing, so the cache ends up with just the collection and
//   deck cards.
async function startingCache(workspace, options, { write, pause }) {
  const chosen = ['bulk', 'missing', 'prune'].filter((mode) => options[mode]);
  if (chosen.length > 1) throw new Error(`Use only one of ${chosen.map((mode) => `--${mode}`).join(', ')}`);
  if (options.bulk) {
    write('Downloading Scryfall bulk data (about 105 MB)...');
    const onProgress = (file, read) => write(`Read ${read} printings from ${file}`);
    const { cards, fetchedAt } = await fetchBulkCards({ onProgress, pause });
    write(`Read ${Object.keys(cards).length} printings from bulk data built ${fetchedAt}.`);
    return { mode: 'bulk', cache: { ...emptyCache(), bulkBuiltAt: fetchedAt, cards }, refetch: false };
  }
  if (options.prune) return { mode: 'prune', cache: emptyCache(), refetch: true };
  if (options.missing) return { mode: 'missing', cache: await workspace.loadCache(), refetch: false };
  // A plain refresh replaces a cache it can't read, so a broken or outdated cache never blocks the fix.
  const current = await workspace.loadCache().catch(() => emptyCache());
  return cardIndex(current).isFromBulk()
    ? { mode: 'keep-bulk', cache: current, refetch: true }
    : { mode: 'prune', cache: emptyCache(), refetch: true };
}

// Fetching and saving happen under the refresh lock, so two refreshes can't overwrite each other.
export async function cardsRefresh({ workspace, options, now, pause, write, warn, emit }) {
  const [collections, loadedDecks] = await Promise.all([workspace.loadEveryCollection(), workspace.loadAllDecks()]);
  const skipped = loadedDecks.filter(({ error }) => error);
  for (const { slug, error } of skipped) warn(`SKIPPED ${slug}: ${error.message}`);
  const decks = loadedDecks.filter(({ deck }) => deck).map(({ deck }) => deck);
  return workspace.withRefreshLock(async () => {
    const { mode, cache: previous, refetch } = await startingCache(workspace, options, { write, pause });
    const index = cardIndex(previous);
    const identifiers = refreshIdentifiers(collections, decks);
    const wanted = refetch ? identifiers : identifiers.filter((identifier) => !index.isCached(identifier));
    let fetched = { cards: {}, notFound: [] };
    if (wanted.length || mode !== 'missing') {
      if (wanted.length) {
        fetched = await fetchCards(wanted, { pause, onProgress: (done, total) => write(`Fetched ${done}/${total}`) });
      }
      const cache = {
        ...previous,
        refreshedAt: new Date(now).toISOString(),
        cards: { ...previous.cards, ...fetched.cards },
      };
      await workspace.saveCache(cache);
      write(
        `Cached ${Object.keys(cache.cards).length} printings (${Object.keys(fetched.cards).length} fetched from Scryfall's card API).`,
      );
    } else {
      write('Card cache already covers every collection row and deck entry.');
    }
    for (const missing of fetched.notFound) warn(`UNRESOLVED: ${JSON.stringify(missing)}`);
    emit({
      mode,
      fetched: Object.keys(fetched.cards).length,
      unresolved: fetched.notFound,
      skipped_decks: skipped.map(({ slug, error }) => ({ deck: slug, error: error.message })),
    });
    return fetched.notFound.length || skipped.length ? 'incomplete' : 'pass';
  });
}
