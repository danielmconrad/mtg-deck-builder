import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Bump whenever the card model in scryfall.mjs changes shape, so stale caches are rejected.
export const CACHE_VERSION = 6;

export const emptyCache = () => ({ version: CACHE_VERSION, cards: {} });

export function validateCache(cache) {
  if (cache?.version !== CACHE_VERSION || typeof cache.cards !== 'object' || Array.isArray(cache.cards)) {
    throw new Error('Card cache is from an older version or invalid; run scryfall:refresh');
  }
  for (const [id, card] of Object.entries(cache.cards)) {
    const isValid =
      card?.id === id &&
      card.oracleId &&
      card.name &&
      Array.isArray(card.colorIdentity) &&
      !Number.isNaN(Date.parse(card.fetchedAt));
    if (!isValid) throw new Error(`Invalid card cache record ${id}; run scryfall:refresh`);
  }
  return cache;
}

export async function readCache(path) {
  try {
    return validateCache(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyCache();
    throw error;
  }
}

// Writes through a temporary file so an interrupted write never leaves a truncated cache.
export async function writeCache(path, cache) {
  validateCache(cache);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache)}\n`);
  await rename(temporaryPath, path);
}
