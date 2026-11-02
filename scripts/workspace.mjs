import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readCache, writeCache } from './card-cache.mjs';
import { cardIndex } from './card-index.mjs';
import { holdDeckCards, parseCollection, parseTextCollection, resolveTextRows } from './collection.mjs';
import { parseDeck, serializeDeck, withMainboardSwaps } from './deck.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const runFile = promisify(execFile);
// Room for the largest ManaBox export git show returns.
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;
// A deck is named by its folder under builds/, which may be nested (brad/bruenor-forge). Each part
// must be a slug, which also keeps deck paths inside builds/.
const DECK_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const DECKS_FOLDER = 'builds';
const DECK_FILE = 'deck.yaml';
const COLLECTIONS_FOLDER = 'collections';
// deck:build's default destination; MTG_BUILD_DESTINATION in .env replaces it.
const DEFAULT_BUILD_DESTINATION = `${COLLECTIONS_FOLDER}/{owner}/decks/{name}.txt`;
// A collection is a ManaBox CSV export or a plain-text list, parsed by its extension.
const COLLECTION_PARSERS = { '.csv': parseCollection, '.txt': parseTextCollection };
const COLLECTION_EXTENSION = /\.(?:csv|txt)$/i;
const withoutExtension = (path) => path.replace(COLLECTION_EXTENSION, '');

// A collection pattern matches the file's path, the path without its extension, or any folder it
// sits in, so collections/conrad* selects collections/conrad/ and everything below it.
export function pathMatches(path, pattern) {
  const glob = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  const parts = path.split('/');
  const candidates = [path, withoutExtension(path)];
  for (let length = 1; length < parts.length; length += 1) candidates.push(parts.slice(0, length).join('/'));
  return candidates.some((candidate) => posix.matchesGlob(candidate, glob));
}

// A file under collections/ that a command may read or change. Path segments are checked so a path in
// deck.yaml (collection_destination) or on the command line can't reach outside the folder.
const COLLECTION_FILE = /^collections\/(?:[^/\\]+\/)*[^/\\]+\.(?:csv|txt)$/;
// A file a change set may write: a collection file, or a file in a deck's folder under builds/.
const DECK_FOLDER_FILE = /^builds\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)+[^/\\]+$/;
const hasDotSegment = (path) => path.split('/').some((part) => part === '..' || part === '.');

export function checkCollectionPath(path) {
  if (!COLLECTION_FILE.test(path) || hasDotSegment(path)) {
    throw new Error(`${path} must be a .csv or .txt file under ${COLLECTIONS_FOLDER}/`);
  }
  return path;
}

// Every write goes through a temporary file beside the target and a rename, so an interrupted write
// never leaves a truncated collection or deck file.
let temporaryCount = 0;
const temporaryPath = (path) => `${path}.${process.pid}.${(temporaryCount += 1)}.tmp`;

async function writeAtomic(path, text) {
  const temporary = temporaryPath(path);
  await writeFile(temporary, text);
  await rename(temporary, path);
}

// Whether a process is alive: signal 0 checks without sending anything, and EPERM means it exists
// under another user.
function isRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

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
    await writeAtomic(join(decksFolder, deckId, fileName), text);
    return `${DECKS_FOLDER}/${deckId}/${fileName}`;
  }

  // A generated file beside deck.yaml, or null if it doesn't exist.
  async function readDeckFile(slug, fileName) {
    try {
      return await readFile(join(await deckFolder(slug), fileName), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  // Removes a generated file beside deck.yaml, returning whether there was one.
  async function removeDeckFile(slug, fileName) {
    const path = join(await deckFolder(slug), fileName);
    const existed = await exists(path);
    await rm(path, { force: true });
    return existed;
  }

  // The deck as a swap would leave it, without writing anything; see withMainboardSwaps, which also
  // records the swap when given a date. deck:swap writes the result through commitFiles.
  async function swapDeckCards(slug, swaps, { date, reasons } = {}) {
    const deckId = await resolveDeckId(slug);
    const path = join(decksFolder, deckId, DECK_FILE);
    const source = deckLabel(deckId);
    return withMainboardSwaps(await readFile(path, 'utf8'), swaps, { source, date, reasons }).deck;
  }

  // Where deck:build puts a deck's own cards by default, from a template whose {owner} is the deck's
  // parent folders under builds/ and {name} its name: with the default template builds/brad/elves,
  // named Elf Ball, keeps them in collections/brad/decks/Elf Ball.txt, and an unnested builds/elves
  // in collections/decks/Elf Ball.txt. Characters that aren't safe in a file name become hyphens.
  function defaultDeckCollection(deckId, deckName, template = DEFAULT_BUILD_DESTINATION) {
    if (!template.includes('{name}')) throw new Error('MTG_BUILD_DESTINATION must contain {name}');
    const owner = deckId.split('/').slice(0, -1).join('/');
    const fileName = deckName
      .replace(/[/\\:*?"<>|\p{Cc}]/gu, '-')
      .trim()
      .replace(/^\.+/, '');
    return template
      .replaceAll('{owner}', owner)
      .replaceAll('{name}', fileName)
      .replace(/\/{2,}/g, '/');
  }

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

  // Collection files are edited only by deck:build, deck:teardown and deck:swap, through commitFiles.
  // Paths are relative to the project root.
  const readCollectionFile = async (path) => readFile(join(root, checkCollectionPath(path)), 'utf8');

  // A new text list must not clash with an existing collection's name, whatever its extension.
  async function checkNewCollection(path) {
    if (!path.endsWith('.txt')) throw new Error(`${path} must be a .txt file under ${COLLECTIONS_FOLDER}/`);
    checkCollectionPath(path);
    const existing = (await collectionPaths()).find((other) => collectionName(other) === collectionName(path));
    if (existing) throw new Error(`${existing} already exists`);
  }

  // Every collection's rows by name, unresolved, as the working tree has them or, with ref, as Git has
  // them at that commit, for collection:diff.
  async function collectionRows(ref) {
    const git = async (...args) =>
      (await runFile('git', ['-C', root, ...args], { maxBuffer: GIT_OUTPUT_LIMIT })).stdout;
    let files;
    if (ref === undefined) {
      const paths = await collectionPaths();
      files = await Promise.all(paths.map(async (path) => [path, await readFile(join(root, path), 'utf8')]));
    } else {
      let listing;
      try {
        listing = await git('ls-tree', '-r', '--name-only', ref, '--', COLLECTIONS_FOLDER);
      } catch (error) {
        throw new Error(`Can't read collections at ${ref} from Git: ${error.stderr?.trim() || error.message}`, {
          cause: error,
        });
      }
      const paths = listing.split('\n').filter((path) => COLLECTION_EXTENSION.test(path));
      files = await Promise.all(paths.map(async (path) => [path, await git('show', `${ref}:${path}`)]));
    }
    return new Map(
      files.map(([path, text]) => {
        const name = collectionName(path);
        return [name, COLLECTION_PARSERS[path.match(COLLECTION_EXTENSION)[0].toLowerCase()](text, name)];
      }),
    );
  }

  // The deck.yaml of a deck, as its path from the project root and its text.
  async function readDeckText(slug) {
    const deckId = await resolveDeckId(slug);
    const path = `${DECKS_FOLDER}/${deckId}/${DECK_FILE}`;
    return { deckId, path, text: await readFile(join(root, path), 'utf8') };
  }

  // Writes a set of changes together, each { path, text } from the project root, where text null deletes
  // the file and create refuses one that exists. Every new text is written to a temporary file first,
  // and only once all are written are they renamed into place and the deletions made, so a failure
  // part way leaves every file as it was. Paths must be collection files or files in a deck's folder.
  async function commitFiles(changes) {
    for (const { path } of changes) {
      if (!DECK_FOLDER_FILE.test(path) || hasDotSegment(path)) checkCollectionPath(path);
    }
    for (const { path, create } of changes) {
      if (create && (await exists(join(root, path)))) throw new Error(`EEXIST: ${path} already exists`);
    }
    const written = [];
    try {
      for (const { path, text } of changes.filter((change) => change.text !== null)) {
        const target = join(root, path);
        await mkdir(dirname(target), { recursive: true });
        const temporary = temporaryPath(target);
        await writeFile(temporary, text);
        written.push({ temporary, target });
      }
    } catch (error) {
      await Promise.all(written.map(({ temporary }) => rm(temporary, { force: true })));
      throw error;
    }
    for (const { temporary, target } of written) await rename(temporary, target);
    for (const { path } of changes.filter((change) => change.text === null)) {
      await rm(join(root, path), { force: true });
    }
  }

  // Every .csv and .txt under collections/ is a collection, named by its path inside collections/
  // without the extension (conrad/precons), so a CSV and a text list of the same name are refused
  // rather than both counted. Text lists name printings rather than Scryfall IDs, so their rows are
  // matched to the card cache unless resolve is false, as scryfall:refresh needs before the cache
  // exists. only and protect hold glob patterns relative to the project root,
  // such as collections/conrad* or collections/**/precons. A non-empty only limits loading to
  // the matches, and protected matches are reported but never available to decks. Each row records
  // the collection it came from. Cards held for a collection's own deck binders are reported like
  // protected copies, as "<name> decks". own is a built deck's collection_destination: it's always
  // read and never protected, since it holds that deck's cards.
  async function loadCollections({ protect = [], only = [], resolve = true, own } = {}) {
    const allPaths = await collectionPaths();
    refuseDuplicateNames(allPaths);
    const selected = allPaths.filter(
      (path) => path === own || !only.length || only.some((pattern) => pathMatches(path, pattern)),
    );
    const sources = await Promise.all(
      selected.map(async (path) => {
        const name = collectionName(path);
        const parse = COLLECTION_PARSERS[path.match(COLLECTION_EXTENSION)[0].toLowerCase()];
        let rows = parse(await readFile(join(root, path), 'utf8'), name);
        if (resolve && rows.some((row) => !row.scryfallId)) rows = resolveTextRows(rows, await loadCardIndex());
        rows = rows.map((row) => ({ ...row, collection: name }));
        const isProtected = path !== own && protect.some((pattern) => pathMatches(path, pattern));
        return { name, path, isProtected, rows };
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
      missingOwn: own && !allPaths.includes(own) ? own : undefined,
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

  // scryfall:refresh holds this lock while it fetches and saves, so two refreshes can't overwrite each
  // other's cache. A lock whose process has ended is taken over.
  async function withRefreshLock(run) {
    const lockPath = join(root, '.cache', 'refresh.lock');
    await mkdir(dirname(lockPath), { recursive: true });
    try {
      await writeFile(lockPath, `${process.pid}\n`, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = Number((await readFile(lockPath, 'utf8')).trim());
      if (isRunning(holder)) {
        throw new Error(
          `Another scryfall:refresh (process ${holder}) is running; wait for it, or delete .cache/refresh.lock if it isn't`,
          { cause: error },
        );
      }
      await writeFile(lockPath, `${process.pid}\n`);
    }
    try {
      return await run();
    } finally {
      await rm(lockPath, { force: true });
    }
  }

  return {
    withRefreshLock,
    loadDeck,
    loadAllDecks,
    createDeck,
    writeDeckFile,
    readDeckFile,
    removeDeckFile,
    swapDeckCards,
    resolveDeckId,
    defaultDeckCollection,
    loadCollections,
    readCollectionFile,
    checkNewCollection,
    collectionRows,
    readDeckText,
    commitFiles,
    loadCache,
    saveCache,
    loadCardIndex,
  };
}
