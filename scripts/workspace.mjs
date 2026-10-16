import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCache, writeCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { parseCollection } from './collection.mjs';
import { parseDeck, serializeDeck } from './deck.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLLECTION_EXTENSION = '.csv';

// The project's on-disk layout: every path the tools read or write is defined here.
export function openWorkspace(root = PROJECT_ROOT) {
  const cachePath = join(root, '.cache', 'cards.json');
  const deckLabel = (slug) => `decks/${slug}/deck.yaml`;

  // The slug check also keeps deck paths inside decks/.
  function deckPath(slug) {
    if (!SLUG_PATTERN.test(slug)) {
      throw new Error('Deck slug must contain lowercase letters, numbers, and single hyphens only');
    }
    return join(root, deckLabel(slug));
  }

  const loadDeck = async (slug) => parseDeck(await readFile(deckPath(slug), 'utf8'), deckLabel(slug));

  // Keeps parse failures per deck instead of aborting the rest.
  async function loadAllDecks() {
    const folders = (await readdir(join(root, 'decks'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((first, second) => first.localeCompare(second));
    return Promise.all(
      folders.map(async (slug) => {
        try {
          return { slug, deck: await loadDeck(slug) };
        } catch (error) {
          return { slug, error };
        }
      }),
    );
  }

  // Never overwrites: the wx flag fails if the deck file already exists.
  async function createDeck(slug, deck) {
    const path = deckPath(slug);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, serializeDeck(deck), { flag: 'wx' });
    return deckLabel(slug);
  }

  // Generated files kept beside a deck's deck.yaml, such as exported decklists.
  async function writeDeckFile(slug, fileName, text) {
    await writeFile(join(deckPath(slug), '..', fileName), text);
    return `decks/${slug}/${fileName}`;
  }

  const removeDeckFile = (slug, fileName) => rm(join(deckPath(slug), '..', fileName), { force: true });

  // Every collections/*.csv is a collection named after its file; a non-empty only limits loading to
  // those names. Names in protect are protected: reported, but never available to decks. Names match
  // without regard to case, and each row records the collection it came from.
  async function loadCollections({ protect = [], only = [] } = {}) {
    const folder = join(root, 'collections');
    const allNames = (await readdir(folder))
      .filter((file) => file.toLowerCase().endsWith(COLLECTION_EXTENSION))
      .map((file) => file.slice(0, -COLLECTION_EXTENSION.length))
      .sort((first, second) => first.localeCompare(second));
    const onlyKeys = new Set(only.map((name) => name.toLowerCase()));
    const names = onlyKeys.size ? allNames.filter((name) => onlyKeys.has(name.toLowerCase())) : allNames;
    const protectedKeys = new Set(protect.map((name) => name.toLowerCase()));
    const sources = await Promise.all(
      names.map(async (name) => {
        const text = await readFile(join(folder, `${name}${COLLECTION_EXTENSION}`), 'utf8');
        const rows = parseCollection(text, name).map((row) => ({ ...row, collection: name }));
        return { name, isProtected: protectedKeys.has(name.toLowerCase()), rows };
      }),
    );
    const rowsWhere = (isProtected) =>
      sources.filter((source) => source.isProtected === isProtected).flatMap((source) => source.rows);
    const knownKeys = new Set(allNames.map((name) => name.toLowerCase()));
    return {
      sources,
      available: rowsWhere(false),
      protected: rowsWhere(true),
      availableNames: sources.filter((source) => !source.isProtected).map((source) => source.name),
      unknownProtected: protect.filter((name) => !knownKeys.has(name.toLowerCase())),
      unknownOnly: only.filter((name) => !knownKeys.has(name.toLowerCase())),
    };
  }

  const loadCache = () => readCache(cachePath);
  const saveCache = (cache) => writeCache(cachePath, cache);
  const loadCardIndex = async () => cardIndex(await loadCache());

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
