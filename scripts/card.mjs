// The card model shared by every module: one printing, in this project's camelCase vocabulary.
// See toCard in scryfall.mjs for the fields.

const DAY_MS = 86_400_000;

export const normalizeName = (name) => name.trim().toLocaleLowerCase('en-US');

export const hasName = (card, name) =>
  [card.name, card.frontName].some((candidate) => normalizeName(candidate) === normalizeName(name));

export const isBasic = (card) => /\bBasic\b/.test(card.frontType);

export const isLand = (card) => card.frontType.includes('Land');

export const ageInDays = (card, now) => (now - Date.parse(card.fetchedAt)) / DAY_MS;
