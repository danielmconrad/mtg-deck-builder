// The command table: each command's handler, help text and options.
import { cardShow, collectionCheck, collectionDiff, collectionSearch } from './collection-commands.mjs';
import { COMMANDER_LIMIT, collectionCommanders, edhrecRefresh } from './commander-commands.mjs';
import {
  CANDIDATE_LIMIT,
  DECKLIST_FORMATS,
  deckCandidatesCommand,
  deckCheck,
  deckExport,
  deckFiles,
  deckNew,
  deckShow,
  deckStatsCommand,
  deckUpgrades,
  deckVerifyCommand,
  decklistFile,
  decksCheck,
  upgradedDecklistFile,
} from './deck-commands.mjs';
import { COLLECTION_OPTIONS, COMMANDER_RANK_OPTIONS, FORMAT_OPTION, JSON_OPTION, SEARCH_OPTIONS } from './options.mjs';
import { ROLE_VOCABULARY } from './deck.mjs';
import { DEFAULT_MAX_AGE_DAYS } from './edhrec.mjs';
import { BRACKETS, CURRENCIES, FORMAT_NAMES } from './formats.mjs';
import { deckBuild, deckSwap, deckTeardown } from './physical.mjs';
import { cardsRefresh } from './refresh.mjs';

export const COMMANDS = {
  'collection:check': {
    run: collectionCheck,
    summary: 'Validate every collection (ManaBox CSV or text list) and summarize it, with the card cache',
    details:
      'The first line describes the card cache: how many printings and cards, whether from bulk data, and when it was last refreshed.',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'collection:search': {
    run: collectionSearch,
    summary: 'Search owned cards by color identity, type, rules text and mana value',
    details:
      'Searches every collection (ManaBox CSV or text list, at any depth under collections/) that MTG_COLLECTIONS or --collections selects, except protected ones, whose copies are shown alongside. Filters combine with AND.',
    options: { ...SEARCH_OPTIONS, ...COLLECTION_OPTIONS },
  },
  'collection:commanders': {
    run: collectionCommanders,
    summary:
      'Rank commanders, owned or not, by how much of the collection feeds the themes their rules text cares about',
    details:
      "Reads each Commander-legal commander's rules text for the themes it cares about (tokens, Food, +1/+1 counters, the creature types it names...) and counts the available nonland cards in its color identity that feed them. Lift compares that with an average collection of the same size: owned cards drawn at random from every Commander-legal card. Commanders need --min-cards on-theme cards to be listed. The tests are rough rules-text patterns, so read a commander's cards before trusting its rank. With EDHREC pages cached by edhrec:refresh, each commander also shows how much of its EDHREC synergy and average deck you own. Unowned commanders need scryfall:refresh -- --bulk.",
    options: {
      ...COMMANDER_RANK_OPTIONS,
      limit: {
        type: 'string',
        kind: 'integer',
        placeholder: 'N',
        description: `Show this many commanders (default ${COMMANDER_LIMIT})`,
      },
      oracle: { type: 'boolean', description: "Print each commander's rules text" },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'collection:diff': {
    run: collectionDiff,
    summary: 'Show what each collection file gained or lost since a Git commit, and the decks naming those cards',
    details:
      'Compares every collection file in the working tree with Git, card by card (all printings and finishes together), so after a new ManaBox export you see what changed and which decks to check again.',
    options: {
      ref: { type: 'string', placeholder: 'REF', description: 'The commit to compare with; defaults to HEAD' },
      json: JSON_OPTION,
    },
  },
  'card:show': {
    run: cardShow,
    takesNames: true,
    summary: 'Show any card by name, owned or not: rules text, legality, value, copies held and the decks that name it',
    details:
      'Reads the card cache, so with bulk data (scryfall:refresh -- --bulk) every card is there. A name the cache lacks gets close suggestions. Decks list where they play the card, cut or add it in upgrades, or left it out with a considered reason.',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'scryfall:refresh': {
    run: cardsRefresh,
    summary: 'Fetch Scryfall card data and prices for every collection and deck (network)',
    details:
      'A plain refresh fetches every collection and deck card again for fresh data and prices. On a cache built from bulk data it keeps the other printings; otherwise, or with --prune, the cache ends up with just those cards. --bulk caches every printing on Scryfall from its daily bulk data (about 105 MB of downloads), then fetches only what that lacks, such as non-English printings. --missing fetches only cards the cache lacks. Rate limits and server errors are retried; any other failure leaves the cache unchanged. Only one refresh runs at a time.',
    options: {
      missing: { type: 'boolean', description: 'Fetch only cards not already cached' },
      bulk: { type: 'boolean', description: "Cache every printing from Scryfall's bulk data, not just owned cards" },
      prune: {
        type: 'boolean',
        description: 'Keep only the collection and deck cards, dropping bulk data the cache holds',
      },
      json: JSON_OPTION,
    },
  },
  'edhrec:refresh': {
    run: edhrecRefresh,
    summary: "Fetch EDHREC's commander pages for collection:commanders (network)",
    details:
      "Fetches each --commander's EDHREC page, and with --top N the N best-ranked commanders under the same filters as collection:commanders, one request a second, into .cache/edhrec.json. Pages fetched within --max-age days are kept. EDHREC's JSON isn't a documented API, so its shape is checked and a change fails loudly.",
    options: {
      commander: {
        type: 'string',
        multiple: true,
        placeholder: 'NAME',
        description: "Fetch this commander's page",
      },
      top: {
        type: 'string',
        kind: 'integer',
        placeholder: 'N',
        description: 'Fetch the N commanders collection:commanders ranks first with the same filters',
      },
      ...COMMANDER_RANK_OPTIONS,
      'max-age': {
        type: 'string',
        kind: 'integer',
        placeholder: 'DAYS',
        description: `Keep pages fetched within this many days (default ${DEFAULT_MAX_AGE_DAYS})`,
      },
      force: { type: 'boolean', description: 'Fetch every page again, however recent' },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:new': {
    run: deckNew,
    takesSlug: true,
    summary:
      'Create a draft deck at builds/<deck-slug>/deck.yaml (slug may be nested, e.g. brad/elves); never overwrites',
    options: {
      commander: {
        type: 'string',
        multiple: true,
        placeholder: 'NAME',
        description: 'Commander card; required for Commander, repeat for partners',
      },
      format: { type: 'string', placeholder: 'FORMAT', choices: FORMAT_NAMES, description: 'Defaults to commander' },
      name: { type: 'string', placeholder: 'TEXT', description: 'Deck name; defaults to the slug in title case' },
      primer: { type: 'string', placeholder: 'TEXT', description: 'The game plan, in a sentence or two' },
      'target-bracket': {
        type: 'string',
        kind: 'integer',
        choices: BRACKETS,
        placeholder: 'N',
        description: 'The Commander Bracket the deck is built for; deck:files records the lowest its cards allow',
      },
      budget: {
        type: 'string',
        kind: 'amount',
        placeholder: 'AMOUNT',
        description: 'Budget for upgrades, in --currency',
      },
      'max-card-price': {
        type: 'string',
        kind: 'amount',
        placeholder: 'AMOUNT',
        description: 'Most any one card may cost, in --currency',
      },
      currency: {
        type: 'string',
        placeholder: 'CODE',
        choices: CURRENCIES,
        description: 'For --budget and --max-card-price; defaults to USD',
      },
      'collection-source': {
        type: 'string',
        placeholder: 'PATTERNS',
        description: 'Comma-separated path globs of the collections the deck is built from, e.g. collections/brad/*',
      },
      'unlimited-basics': {
        type: 'boolean',
        description:
          'The user has untracked basics; defaults to MTG_UNLIMITED_BASICS in .env (--no-unlimited-basics for false)',
      },
      'allow-proxies': {
        type: 'boolean',
        description: 'Proxy rows count as owned; defaults to MTG_ALLOW_PROXIES in .env (--no-allow-proxies for false)',
      },
      json: JSON_OPTION,
    },
  },
  'deck:check': {
    run: deckCheck,
    takesSlug: true,
    summary: 'Check size, commander rules, color identity, bans, copy limits and ownership',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'deck:stats': {
    run: deckStatsCommand,
    takesSlug: true,
    summary: 'Show mainboard curve, card types, color pips, land sources and roles',
    details:
      "Also Karsten's suggested land count, role counts against the deck's role_targets (or, for Commander, the Command Zone template), and opening-hand odds. Land sources count only colors inside the commanders' identity.",
    options: {
      upgrades: {
        type: 'string',
        placeholder: 'MODE',
        choices: ['apply'],
        description: 'apply: measure the deck with every upgrade swap made',
      },
      json: JSON_OPTION,
    },
  },
  'deck:show': {
    run: deckShow,
    takesSlug: true,
    summary: "List the deck's cards by role, with mana cost, type and optionally rules text",
    details:
      "Commanders first, then the mainboard grouped by each card's first role (cards with several roles name them all). Cards the cache lacks make it incomplete.",
    options: {
      role: {
        type: 'string',
        placeholder: 'ROLE',
        choices: ROLE_VOCABULARY,
        description: 'Only cards with this role label',
      },
      oracle: SEARCH_OPTIONS.oracle,
      upgrades: {
        type: 'string',
        placeholder: 'MODE',
        choices: ['apply'],
        description: 'apply: list the deck with every upgrade swap made',
      },
      json: JSON_OPTION,
    },
  },
  'deck:export': {
    run: deckExport,
    takesSlug: true,
    summary: 'Print a paste-ready decklist for another site, or copy it to the clipboard',
    details:
      'Does not validate the deck. Moxfield and Archidekt lines carry set and collector number: the pinned scryfall_id, else the printing owned in an available collection, else a cached printing.',
    options: {
      format: FORMAT_OPTION,
      upgrades: {
        type: 'string',
        placeholder: 'MODE',
        choices: ['apply', 'split'],
        description:
          'apply: make every upgrade swap, e.g. for playtesting; split: list the kept cards as the deck, cuts in the sideboard and adds under Considering (Maybeboard in Archidekt)',
      },
      copy: { type: 'boolean', description: 'Copy to the clipboard instead of printing' },
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:files': {
    run: deckFiles,
    takesSlug: true,
    summary: 'Write the decklist files kept beside deck.yaml',
    details: `Sets lowest_legal_bracket in deck.yaml to the bracket the cards set, removes plays_like_bracket if the cards changed since the last run, and writes ${DECKLIST_FORMATS.map(decklistFile).join(' and ')} (the kept cards, upgrade cuts in the sideboard, adds under Considering or Maybeboard) and, if the deck has upgrades, ${DECKLIST_FORMATS.map(upgradedDecklistFile).join(' and ')} (the full deck with every swap made). Overwrites them; rerun after every deck edit. Does not validate the deck.`,
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'deck:candidates': {
    run: deckCandidatesCommand,
    takesSlug: true,
    summary: "List the deck's most valued left-out cards, so every exclusion has a reason",
    details:
      "Lists available cards the deck could play but leaves out (in its commanders' color identity and Commander-legal, for commander formats), most played on EDHREC first, then by price. Each shows its reason from the deck's considered list, or says it has none. Price and rank only flag cards for a second look; they don't judge fit. Ranks come from scryfall:refresh.",
    options: {
      limit: {
        type: 'string',
        kind: 'integer',
        placeholder: 'N',
        description: `How many to list; defaults to ${CANDIDATE_LIMIT}`,
      },
      sort: {
        type: 'string',
        placeholder: 'KEY',
        choices: ['edhrec', 'price'],
        description: 'EDHREC rank (the default) or price, highest first',
      },
      text: { ...SEARCH_OPTIONS.text },
      type: { ...SEARCH_OPTIONS.type },
      role: SEARCH_OPTIONS.role,
      lands: { type: 'boolean', description: 'Include lands' },
      oracle: SEARCH_OPTIONS.oracle,
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:verify': {
    run: deckVerifyCommand,
    takesSlug: true,
    summary:
      'Check that a deck is ready to hand off: deck:check plus primer, stats, left-out cards, upgrades and decklist files',
    details:
      "Errors: anything deck:check fails, a placeholder primer, a top --limit left-out card without a considered reason, upgrades over budget or without one, and decklist files that differ from what deck:files would write. Notes: lands more than one away from Karsten's suggestion and role counts outside their targets, which need explaining rather than fixing.",
    options: {
      limit: {
        type: 'string',
        kind: 'integer',
        placeholder: 'N',
        description: `How many top left-out cards need a reason; defaults to ${CANDIDATE_LIMIT}`,
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:upgrades': {
    run: deckUpgrades,
    takesSlug: true,
    summary: 'Price the upgrade package and any shortfalls against the budget',
    options: { ...COLLECTION_OPTIONS, json: JSON_OPTION },
  },
  'deck:build': {
    run: deckBuild,
    takesSlug: true,
    summary: "Physically build a finished deck: move its cards out of the collections into the deck's own list",
    details:
      "Only when the user says to build the deck. Takes every card, commanders included, out of the deck's available collections (the pinned printing first, then nonfoil copies, then the printing with the most copies; never proxies or protected copies), writes them to a text list, and sets collection_destination and status: built in deck.yaml. Upgrades are not applied. The deck must pass deck:check. Without --apply, prints what it would take and changes nothing.",
    options: {
      apply: { type: 'boolean', description: 'Edit the collections and deck.yaml; without it, only print the plan' },
      to: {
        type: 'string',
        placeholder: 'PATH',
        description:
          "The deck's new text list; defaults to MTG_BUILD_DESTINATION in .env, else collections/{owner}/decks/{name}.txt",
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:teardown': {
    run: deckTeardown,
    takesSlug: true,
    summary: "Take apart a built deck: return its cards from its own list to the collection's text lists",
    details:
      "Only when the user says they've taken the deck apart. The reverse of deck:build: adds every card in the deck's collection_destination list to the text list --to names (lands to --lands-to, if given), raising the quantity of a line with the same printing and finish or adding a line, in name order when the list is mostly sorted by name. Then deletes the deck's list, removes collection_destination and sets a built deck back to draft. Untracked basics aren't returned. Without --apply, prints what it would return and changes nothing.",
    options: {
      apply: { type: 'boolean', description: 'Edit the collections and deck.yaml; without it, only print the plan' },
      to: { type: 'string', placeholder: 'PATH', description: 'The text list under collections/ the cards go back to' },
      'lands-to': {
        type: 'string',
        placeholder: 'PATH',
        description: 'A separate text list for the lands; defaults to --to',
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'deck:swap': {
    run: deckSwap,
    takesSlug: true,
    summary: 'Swap mainboard cards for others, moving the physical cards too when the deck is built',
    details:
      "Each --out pairs with the --in at the same place and swaps one copy; repeat a pair to swap more copies. In deck.yaml a new card takes the out card's place and role, keeping comments; each --reason becomes its out card's considered reason, each in card leaves considered, and history gains an entry dated today. For a built deck, the swapped deck must pass deck:check; each in card is taken from the other available collections into the deck's collection_destination list (the same copy order as deck:build), and each out card goes from that list back to the text list --to names (lands to --lands-to, if given). Only when the user says they've swapped the physical cards. Warns about upgrades the swap leaves stale. Without --apply, prints the plan and changes nothing.",
    options: {
      out: { type: 'string', multiple: true, placeholder: 'NAME', description: 'A mainboard card to take out' },
      in: { type: 'string', multiple: true, placeholder: 'NAME', description: 'The card to put in its place' },
      reason: {
        type: 'string',
        multiple: true,
        placeholder: 'TEXT',
        description:
          "Why the --out card at the same place left; becomes its considered reason and the history entry's notes",
      },
      apply: { type: 'boolean', description: 'Edit deck.yaml and, for a built deck, the collections' },
      to: {
        type: 'string',
        placeholder: 'PATH',
        description: 'For a built deck: the text list under collections/ the out cards go back to',
      },
      'lands-to': {
        type: 'string',
        placeholder: 'PATH',
        description: 'A separate text list for out lands; defaults to --to',
      },
      json: JSON_OPTION,
      ...COLLECTION_OPTIONS,
    },
  },
  'decks:check': {
    run: decksCheck,
    summary: 'Check every deck independently; the example is schema-checked only',
    details:
      'mise run check runs it with --status built, so drafts in progress never turn the code check red; run it plain to see every deck.',
    options: {
      status: {
        type: 'string',
        placeholder: 'STATUS',
        choices: ['draft', 'built'],
        description: 'Only decks with this status',
      },
      decks: {
        type: 'string',
        placeholder: 'PATTERNS',
        description: 'Comma-separated globs of deck paths under builds/, e.g. conrad/* or brad/*,conrad/kwia-*',
      },
      ...COLLECTION_OPTIONS,
      json: JSON_OPTION,
    },
  },
};
