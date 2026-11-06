// Option specs shared by several commands, and the collection scope every command reads through.
import { COMMANDER_SORT_CHOICES, DEFAULT_MIN_CARDS } from './commanders.mjs';
import { EXPORT_FORMAT_NAMES } from './export.mjs';
import { GROUP_BY_CHOICES, RARITY_CHOICES, ROLE_CHOICES, SORT_CHOICES } from './search.mjs';
import { pathMatches } from './workspace.mjs';

// Option values arrive as strings; a spec's kind turns them into numbers and its choices limit them:
// - integer: a whole number of 1 or more
// - number: zero or more, decimals allowed
// - amount: money, up to two decimal places
// A repeatable option checks each value. Help lists the choices (see help.mjs).
const KINDS = {
  integer: { pattern: /^[1-9]\d*$/, problem: 'must be a positive integer' },
  number: { pattern: /^\d+(\.\d+)?$/, problem: 'must be a number' },
  amount: { pattern: /^\d+(\.\d{1,2})?$/, problem: 'must be an amount such as 30 or 0.50' },
};

function typedValue(name, spec, value) {
  if (typeof value !== 'string') return value;
  const kind = KINDS[spec.kind];
  if (kind && !kind.pattern.test(value)) throw new Error(`--${name} ${kind.problem}`);
  const typed = kind ? Number(value) : value;
  if (spec.choices && !spec.choices.includes(typed)) {
    throw new Error(`--${name} must be one of: ${spec.choices.join(', ')}`);
  }
  return typed;
}

export function typedOptions(specs, values) {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const typed = (one) => typedValue(name, specs[name] ?? {}, one);
      return [name, Array.isArray(value) ? value.map(typed) : typed(value)];
    }),
  );
}

export const JSON_OPTION = {
  type: 'boolean',
  description:
    'Print one line of JSON: { command, deck, outcome, data, warnings }; defaults to MTG_OUTPUT in .env (--no-json for text)',
};

export const SEARCH_OPTIONS = {
  commander: {
    type: 'string',
    placeholder: 'NAME',
    description: "Limit to this commander's color identity and Commander-legal cards",
  },
  commanders: {
    type: 'boolean',
    description: 'Only cards that can be a commander: legendary creatures, Backgrounds, "can be your commander"',
  },
  'game-changers': { type: 'boolean', description: 'Only cards on the Commander Game Changers list' },
  nonland: { type: 'boolean', description: 'Exclude lands (modal spell/land cards count as spells)' },
  identity: { type: 'string', placeholder: 'WUBRG', description: 'Limit to a color identity; C means colorless only' },
  type: {
    type: 'string',
    multiple: true,
    placeholder: 'REGEX',
    description: 'Type line must match (case-insensitive)',
  },
  text: {
    type: 'string',
    multiple: true,
    placeholder: 'REGEX',
    description: 'Rules text must match (case-insensitive)',
  },
  role: {
    type: 'string',
    multiple: true,
    placeholder: 'ROLE',
    choices: ROLE_CHOICES,
    description: 'Rules text must look like this role (rough; read the list before quoting a count)',
  },
  name: { type: 'string', placeholder: 'REGEX', description: 'Card name must match (case-insensitive)' },
  'min-mv': { type: 'string', kind: 'number', placeholder: 'N', description: 'Minimum mana value' },
  'max-mv': { type: 'string', kind: 'number', placeholder: 'N', description: 'Maximum mana value' },
  legal: { type: 'string', placeholder: 'FORMAT', description: 'Must be legal in this Scryfall format, e.g. modern' },
  'max-price': {
    type: 'string',
    kind: 'number',
    placeholder: 'USD',
    description: 'Cheapest playable printing costs at most this; unknown prices are kept',
  },
  'min-copies': {
    type: 'string',
    kind: 'integer',
    placeholder: 'N',
    description: 'At least this many available copies, e.g. 4 for casual-60 playsets',
  },
  unowned: {
    type: 'boolean',
    description:
      'Search every card in the cache that has no available copy, e.g. for upgrades; needs scryfall:refresh -- --bulk',
  },
  'all-cards': {
    type: 'boolean',
    description:
      'Search every card in the cache, owned or not, e.g. a whole set with --set; needs scryfall:refresh -- --bulk',
  },
  set: {
    type: 'string',
    multiple: true,
    placeholder: 'CODE',
    description: 'Only cards with a printing in this set (Scryfall code such as trk; repeatable or comma-separated)',
  },
  rarity: {
    type: 'string',
    multiple: true,
    placeholder: 'RARITY',
    choices: RARITY_CHOICES,
    description: 'Only cards with a printing of this rarity, in --set if given (repeatable)',
  },
  'include-protected': { type: 'boolean', description: 'Also list cards that exist only in protected collections' },
  proxies: { type: 'boolean', description: 'Count proxy rows as owned copies' },
  oracle: { type: 'boolean', description: "Print each card's rules text" },
  count: { type: 'boolean', description: 'Print only how many distinct cards and copies match' },
  'group-by': {
    type: 'string',
    placeholder: 'KEY',
    choices: GROUP_BY_CHOICES,
    description: 'Count matches per group instead of listing them (role uses the --role tests)',
  },
  json: JSON_OPTION,
  sort: {
    type: 'string',
    placeholder: 'KEY',
    choices: SORT_CHOICES,
    description:
      'Order the list by mana value (the default), EDHREC rank or price, highest first; edhrec and price also print both',
  },
};

// The filters collection:commanders ranks by, which edhrec:refresh --top shares.
export const COMMANDER_RANK_OPTIONS = {
  identity: {
    type: 'string',
    placeholder: 'WUBRG',
    description: 'Only commanders whose color identity fits within these colors; C means colorless only',
  },
  owned: { type: 'boolean', description: 'Only commanders with an available copy' },
  unowned: { type: 'boolean', description: 'Only commanders without an available copy (protected copies are noted)' },
  name: { type: 'string', placeholder: 'REGEX', description: 'Commander name must match (case-insensitive)' },
  theme: {
    type: 'string',
    placeholder: 'REGEX',
    description: 'Only commanders with a theme or creature type matching this (case-insensitive), e.g. food or Dwarf',
  },
  'max-price': {
    type: 'string',
    kind: 'number',
    placeholder: 'USD',
    description: "The commander's cheapest playable printing costs at most this; unknown prices are kept",
  },
  'min-cards': {
    type: 'string',
    kind: 'number',
    placeholder: 'N',
    description: `List only commanders with at least this many owned on-theme cards (default ${DEFAULT_MIN_CARDS}; 0 lists all)`,
  },
  sort: {
    type: 'string',
    placeholder: 'KEY',
    choices: COMMANDER_SORT_CHOICES,
    description:
      'lift (the default): owned on-theme cards against an average collection; cards: the most on-theme cards; edhrec: the most of its EDHREC synergy owned',
  },
};

// Which collections to read and which not to dismantle. Each option wins over its .env variable
// (see .env.example). Both take comma-separated glob patterns relative to the project root, such as
// collections/conrad* or collections/**/precons. --collections defaults to every collection, and
// --protect to any precons collection or decks folder, which is where deck:build puts built decks; an
// empty value means every collection, or none protected.
export const COLLECTION_OPTIONS = {
  collections: {
    type: 'string',
    placeholder: 'PATTERNS',
    description:
      'Comma-separated path globs (e.g. collections/conrad*) of collections to read, ignoring the rest; defaults to MTG_COLLECTIONS in .env, else all',
  },
  protect: {
    type: 'string',
    placeholder: 'PATTERNS',
    description:
      'Comma-separated path globs of collections to protect; defaults to MTG_PROTECTED_COLLECTIONS in .env, else collections/**/precons,collections/**/decks',
  },
};
const DEFAULT_PROTECTED = 'collections/**/precons,collections/**/decks';

export const patternList = (value) =>
  value
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);

// The default protect patterns name folders that may not exist yet, so only chosen ones warn when unmatched.
export const collectionScope = (options, env) => ({
  optionOnly: options.collections === undefined ? undefined : patternList(options.collections),
  envOnly: patternList(env.MTG_COLLECTIONS ?? ''),
  protect: patternList(options.protect ?? env.MTG_PROTECTED_COLLECTIONS ?? DEFAULT_PROTECTED),
  protectChosen: (options.protect ?? env.MTG_PROTECTED_COLLECTIONS) !== undefined,
});

// The workspace with the collection scope applied, so commands just call loadCollections(), passing
// the deck when there is one. The collections read come from --collections, else the deck's
// collection_source, else MTG_COLLECTIONS, and a built deck's collection_destination is always read as
// its own. Each distinct scope is loaded, and warned about, once.
// loadEveryCollection ignores the scope, so scryfall:refresh caches every collection, and leaves text
// lists unmatched, so a missing or outdated cache can't stop the refresh that replaces it.
export function scopedWorkspace(workspace, scope, warn) {
  const loaded = new Map();
  async function load(only, own) {
    const collections = await workspace.loadCollections({ only, own, protect: scope.protect });
    for (const pattern of collections.unknownOnly) warn(`No collection matches ${pattern} to read`);
    if (scope.protectChosen) {
      for (const pattern of collections.unknownProtected) warn(`No collection matches ${pattern} to protect`);
    }
    if (collections.missingOwn) warn(`collection_destination ${collections.missingOwn} doesn't exist`);
    return collections;
  }
  function loadCollections(deck) {
    const only = scope.optionOnly ?? deck?.collection_source ?? scope.envOnly;
    const own = deck?.collection_destination;
    const key = JSON.stringify([only, own]);
    if (!loaded.has(key)) loaded.set(key, load(only, own));
    return loaded.get(key);
  }
  return {
    ...workspace,
    loadCollections,
    loadEveryCollection: () => workspace.loadCollections({ resolve: false }),
    protects: (path) => scope.protect.some((pattern) => pathMatches(path, pattern)),
  };
}

export const FORMAT_OPTION = {
  type: 'string',
  placeholder: 'FORMAT',
  choices: EXPORT_FORMAT_NAMES,
  description: 'Defaults to MTG_EXPORT_FORMAT in .env, else text',
};
