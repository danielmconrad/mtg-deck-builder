import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCache, writeCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { holdDeckCards, parseCollection, parseTextCollection, resolveTextRows } from './collection.mjs';
import { parseDeck, serializeDeck } from './deck.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
// A deck is named by its folder under builds/, which may be nested (brad/bruenor-forge). Each part
// must be a slug, which also keeps deck paths inside builds/.
const DECK_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const DECKS_FOLDER = 'builds';
const DECK_FILE = 'deck.yaml';
const COLLECTIONS_FOLDER = 'collections';
// A collection is a ManaBox CSV export or a plain-text list, parsed by its extension.
const COLLECTION_PARSERS = { '.csv': parseCollection, '.txt': parseTextCollection };
const COLLECTION_EXTENSION = /\.(?:csv|txt)$/i;
const withoutExtension = (path) => path.replace(COLLECTION_EXTENSION, '');

// A collection pattern matches the file's path, the path without its extension, or any folder it
// sits in, so collections/conrad* selects collections/conrad/ and everything below it.
function pathMatches(path, pattern) {
  const glob = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  const parts = path.split('/');
  const candidates = [path, withoutExtension(path)];
  for (let length = 1; length < parts.length; length += 1) candidates.push(parts.slice(0, length).join('/'));
  return candidates.some((candidate) => posix.matchesGlob(candidate, glob));
}

// The project's on-disk layout: every path the tools read or write is defined here.
export function openWorkspace(root = PROJECT_ROOT) {
  const cachePath = join(root, '.cache', 'cards.json');
  const decksFolder = join(root, DECKS_FOLDER);
  const deckLabel = (deckId) => `${DECKS_FOLDER}/${deckId}/${DECK_FILE}`;

  function checkDeckPath(slug) {
    if (!DECK_PATH_PATTERN.test(slug)) {
      throw new Error(
        'Deck slug must contain lowercase letters, numbers, and single hyphens only, with / between nested folders',
      );
    }
  }

  // Every folder under builds/ that holds a deck.yaml, at any depth, as its path from builds/. A deck's
  // own folder isn't searched further. Folders holding neither a deck nor other folders are listed
  // too, so a missing deck.yaml is reported rather than skipped.
  async function deckIds(folder = '') {
    const entries = await readdir(join(decksFolder, folder), { withFileTypes: true });
    if (folder && entries.some((entry) => entry.isFile() && entry.name === DECK_FILE)) return [folder];
    const subfolders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (folder && !subfolders.length) return [folder];
    const nested = await Promise.all(subfolders.map((name) => deckIds(folder ? `${folder}/${name}` : name)));
    return nested.flat().sort((first, second) => first.localeCompare(second));
  }

  // A full path names its deck directly. A bare slug finds the one deck whose folder has that name,
  // wherever it's nested; with none it means builds/<slug>, so a load reports the missing file.
  async function resolveDeckId(slug) {
    checkDeckPath(slug);
    if (slug.includes('/')) return slug;
    const matches = (await deckIds()).filter((deckId) => deckId.split('/').at(-1) === slug);
    if (matches.length > 1) throw new Error(`Deck slug ${slug} matches ${matches.join(', ')}; give the full path`);
    return matches[0] ?? slug;
  }

  const deckFolder = async (slug) => join(decksFolder, await resolveDeckId(slug));

  async function loadDeck(slug) {
    const deckId = await resolveDeckId(slug);
    return parseDeck(await readFile(join(decksFolder, deckId, DECK_FILE), 'utf8'), deckLabel(deckId));
  }

  // Keeps parse failures per deck instead of aborting the rest. Each slug is the deck's full path.
  async function loadAllDecks() {
    return Promise.all(
      (await deckIds()).map(async (slug) => {
        try {
          return { slug, deck: await loadDeck(slug) };
        } catch (error) {
          return { slug, error };
        }
      }),
    );
  }

  // Never overwrites: a bare slug already used by a nested deck is refused, and the wx flag fails if
  // the deck file already exists. The editor schema path climbs out of however deep the deck sits.
  async function createDeck(slug, deck) {
    const deckId = await resolveDeckId(slug);
    if (deckId !== slug) throw new Error(`EEXIST: a deck named ${slug} already exists at ${deckLabel(deckId)}`);
    const path = join(decksFolder, deckId, DECK_FILE);
    await mkdir(join(path, '..'), { recursive: true });
    const schemaPath = `${'../'.repeat(deckId.split('/').length + 1)}schemas/deck.schema.json`;
    await writeFile(path, serializeDeck(deck, { schemaPath }), { flag: 'wx' });
    return deckLabel(deckId);
  }

  // Generated files kept beside a deck's deck.yaml, such as exported decklists.
  async function writeDeckFile(slug, fileName, text) {
    const deckId = await resolveDeckId(slug);
    await writeFile(join(decksFolder, deckId, fileName), text);
    return `${DECKS_FOLDER}/${deckId}/${fileName}`;
  }

  const removeDeckFile = async (slug, fileName) => rm(join(await deckFolder(slug), fileName), { force: true });

  const collectionName = (path) => withoutExtension(path.slice(COLLECTIONS_FOLDER.length + 1));

  function refuseDuplicateNames(paths) {
    const seen = new Map();
    for (const path of paths) {
      const name = collectionName(path);
      if (seen.has(name)) throw new Error(`${seen.get(name)} and ${path} are both collection ${name}; keep one`);
      seen.set(name, path);
    }
  }

  // Every .csv and .txt under collections/, at any depth, as its path from the project root.
  async function collectionPaths(folder = COLLECTIONS_FOLDER) {
    const entries = await readdir(join(root, folder), { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = `${folder}/${entry.name}`;
        if (entry.isDirectory()) return collectionPaths(path);
        return entry.isFile() && COLLECTION_EXTENSION.test(entry.name) ? [path] : [];
      }),
    );
    return nested.flat().sort((first, second) => first.localeCompare(second));
  }

  // Every .csv and .txt under collections/ is a collection, named by its path inside collections/
  // without the extension (conrad/precons), so a CSV and a text list of the same name are refused
  // rather than both counted. Text lists name printings rather than Scryfall IDs, so their rows are
  // matched to the card cache unless resolve is false, as scryfall:refresh needs before the cache
  // exists. only and protect hold glob patterns relative to the project root,
  // such as collections/conrad* or collections/**/precons. A non-empty only limits loading to
  // the matches, and protected matches are reported but never available to decks. Each row records
  // the collection it came from. Cards held for a collection's own deck binders are reported like
  // protected copies, as "<name> decks".
  async function loadCollections({ protect = [], only = [], resolve = true } = {}) {
    const allPaths = await collectionPaths();
    refuseDuplicateNames(allPaths);
    const selected = only.length
      ? allPaths.filter((path) => only.some((pattern) => pathMatches(path, pattern)))
      : allPaths;
    const sources = await Promise.all(
      selected.map(async (path) => {
        const name = collectionName(path);
        const parse = COLLECTION_PARSERS[path.match(COLLECTION_EXTENSION)[0].toLowerCase()];
        let rows = parse(await readFile(join(root, path), 'utf8'), name);
        if (resolve && rows.some((row) => !row.scryfallId)) rows = resolveTextRows(rows, await loadCardIndex());
        rows = rows.map((row) => ({ ...row, collection: name }));
        return { name, path, isProtected: protect.some((pattern) => pathMatches(path, pattern)), rows };
      }),
    );
    const split = sources.map((source) => {
      if (source.isProtected) return { free: [], held: source.rows };
      const { free, held } = holdDeckCards(source.rows);
      return { free, held: held.map((row) => ({ ...row, collection: `${source.name} decks` })) };
    });
    const matchesNothing = (pattern) => !allPaths.some((path) => pathMatches(path, pattern));
    return {
      sources,
      available: split.flatMap(({ free }) => free),
      protected: split.flatMap(({ held }) => held),
      availableNames: sources.filter((source) => !source.isProtected).map((source) => source.name),
      unknownProtected: protect.filter(matchesNothing),
      unknownOnly: only.filter(matchesNothing),
    };
  }

  // The cache is read and indexed once per workspace, since collections and commands both need it.
  let cachePromise;
  let indexPromise;
  const loadCache = () => (cachePromise ??= readCache(cachePath));
  const loadCardIndex = () => (indexPromise ??= loadCache().then(cardIndex));
  async function saveCache(cache) {
    await writeCache(cachePath, cache);
    cachePromise = Promise.resolve(cache);
    indexPromise = undefined;
  }

  return {
    loadDeck,
    loadAllDecks,
    createDeck,
    writeDeckFile,
    removeDeckFile,
    loadCollections,
    loadCache,
    saveCache,
    loadCardIndex,
  };
}
