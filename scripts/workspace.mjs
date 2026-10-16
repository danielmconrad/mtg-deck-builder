import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCache, writeCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { parseCollection } from './collection.mjs';
import { parseDeck, serializeDeck } from './deck.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLLECTION_NAMES = ['Organized', 'Precons'];

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

  async function loadCollections() {
    const load = async (name) =>
      parseCollection(await readFile(join(root, 'collections', `${name}.csv`), 'utf8'), name);
    const [organized, precons] = await Promise.all(COLLECTION_NAMES.map(load));
    return { organized, precons };
  }

  const loadCache = () => readCache(cachePath);
  const saveCache = (cache) => writeCache(cachePath, cache);
  const loadCardIndex = async () => cardIndex(await loadCache());

  return { loadDeck, loadAllDecks, createDeck, loadCollections, loadCache, saveCache, loadCardIndex };
}
