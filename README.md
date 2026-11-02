# MTG Deck Builder

A workspace for brewing Commander and casual 60-card decks from cards you own, with an AI assistant doing the brewing and small offline scripts doing the checking. Decks are YAML files in Git; card data comes from Scryfall.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html), then:

```sh
mise trust && mise install
mise run setup          # npm ci (network) and the git pre-commit hook
mise run scryfall:refresh  # fetch card data and prices (network); add -- --bulk for every card on Scryfall
mise run check          # offline: lint, collections, tests and built decks
cp .env.example .env    # project defaults, e.g. the export format (ignored by Git)
```

## Layout

```text
collections/*.csv, *.txt    ManaBox exports or text lists, one per collection, named after the file
                            (e.g. Organized.csv). Protected ones are reported but never used
collections/<owner>/decks/  Physically built decks' own lists, written by deck:build
builds/<slug>/deck.yaml      One file per deck (see builds/example and schemas/); may be nested, e.g. builds/brad/<slug>/
builds/<slug>/decklist*.txt  Generated Archidekt and Moxfield decklists, written by deck:files and committed
scripts/                    CLI (cli.mjs) and the modules behind it
tests/                      Offline tests on synthetic fixtures
.cache/cards.json           Scryfall data, about 55 MB after a bulk refresh (ignored by Git)
```

## Commands

`mise tasks ls` lists every task. Deck and collection tasks pass arguments after `--` to the CLI, which documents its own options:

```sh
mise run deck:export -- --help      # options for one command
node scripts/cli.mjs --help         # every command, plus exit codes
```

| Task                | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `collection:check`  | Validate every collection and summarize it                          |
| `collection:search` | Find owned cards by color identity, type, rules text and mana value |
| `collection:diff`   | What each collection gained or lost since a Git commit              |
| `card:show`         | Any card by name, owned or not, with copies and decks using it      |
| `scryfall:refresh`  | Fetch Scryfall card data and prices (network); `--bulk` for all     |
| `deck:new`          | Create a draft deck                                                 |
| `deck:check`        | Check rules and ownership for one deck                              |
| `deck:stats`        | Curve, card types, color pips, land sources and roles               |
| `deck:show`         | List a deck's cards by role, with rules text on request             |
| `deck:verify`       | Check a deck is ready to hand off                                   |
| `deck:upgrades`     | Price the upgrade package and any shortfalls against the budget     |
| `deck:candidates`   | List the deck's most valued left-out cards and why they're out      |
| `deck:export`       | Print or copy a paste-ready decklist                                |
| `deck:files`        | Write the committed decklist files beside `deck.yaml`               |
| `deck:build`        | Physically build a deck: move its cards into its own collection     |
| `deck:teardown`     | Take a built deck apart: return its cards to the collection         |
| `deck:swap`         | Swap mainboard cards, moving a built deck's cards too               |
| `decks:check`       | Check every deck, or `--status`/`--decks`; example is schema-only   |
| `lint` / `fix`      | Check, or fix, linting and formatting                               |
| `check`             | `lint`, `collection:check`, `test` and built decks' `decks:check`   |

Exit codes: `0` passed, `1` a check failed or input is invalid, `2` incomplete (unknown cards, missing card data, unknown prices).

### JSON output

Every command except `deck:export` prints text by default, or one line of JSON with `--json`: the read commands, `card:show`, `collection:diff`, `scryfall:refresh`, `deck:new`, `deck:files`, and the plans and results of `deck:build`, `deck:teardown` and `deck:swap`. A test pins each command's `data` keys:

```json
{
  "command": "deck:check",
  "deck": "green-value",
  "outcome": "pass",
  "data": { "outcome": "pass", "total_cards": 100, "findings": [] },
  "warnings": []
}
```

Warnings go in `warnings` instead of stderr, and a command that fails with an error prints `{"command", "deck", "outcome": "fail", "error", "warnings"}`. Field names are snake_case, like `deck.yaml`. `MTG_OUTPUT=json` in `.env` makes JSON the default; `--no-json` then asks for text. Text is shorter to read, so JSON is for scripts.

### Searching the collection

```sh
mise run collection:search -- --commander "Radagast the Brown" --type creature --max-mv 3
mise run collection:search -- --identity BG --text "graveyard" --oracle
mise run collection:search -- --identity C --type artifact --text "add \{" --json
```

Filters combine, and `--type`, `--text` and `--name` take case-insensitive regular expressions. To size up the collection before listing anything:

```sh
mise run collection:search -- --commanders --legal commander --group-by identity   # commander candidates per color identity
mise run collection:search -- --identity WR --group-by creature-type               # tribes within red-white
mise run collection:search -- --identity WR --nonland --text 'destroy target' --count
```

- **Roles:** `--role ramp` (or `draw`, `removal`, `wipe`, `protection`) keeps cards whose rules text looks like that role, and `--group-by role` counts them, lands as `land` and the rest as `other`. The tests are rough: draw also matches cards that make an opponent draw, and removal includes counterspells. Read the list before quoting a count.
- **Price and copies:** `--max-price 1` keeps cards whose cheapest playable printing costs at most 1 USD (unknown prices are kept), for Custom Dollar Brawl. `--min-copies 4` keeps cards with at least four available copies, for casual-60 playsets.
- **Unowned cards:** `--unowned` searches every playable card in the cache that has no available copy, for upgrades. It needs `scryfall:refresh -- --bulk` to find more than the collections' and decks' own cards, and warns without it. Copies in protected collections are still noted.
- **Value:** `--sort edhrec` lists the most played cards on EDHREC first, and `--sort price` the most valuable (cheapest cached USD printing), each line showing both numbers. They flag cards worth a second look; they don't say a card fits. Ranks are fetched by `scryfall:refresh`, so a cache from before they were added shows `?` until the next refresh.
- **Game Changers** are marked `[Game Changer]` in every list.

See `mise run collection:search -- --help` for the full list.

### Looking up any card

```sh
mise run card:show -- "Sol Ring" "Craterhoof Behemoth"
```

It reads the card cache, so with bulk data every card is there, owned or not: rules text, Commander legality, Game Changer status, EDHREC rank, cheapest playable price, available and protected copies, and every deck that plays the card, cuts or adds it in upgrades, or left it out with a `considered` reason. A misspelled name gets the closest cached names as suggestions, here and wherever a deck names a card.

### What changed in the collection

```sh
mise run collection:diff                 # since the last commit
mise run collection:diff -- --ref HEAD~3
```

After you drop in a new ManaBox export or edit a text list, it lists each collection's gains and losses by card name (every printing and finish together) against Git, then the decks that name those cards, so you know which to check again.

### Reviewing left-out cards

```sh
mise run deck:candidates -- conrad/kwia-lotus-engine --oracle               # the top 20 owned cards the deck could play but doesn't
mise run deck:candidates -- conrad/kwia-lotus-engine --text treasure --limit 50
```

It lists available cards in the commanders' color identity (and Commander-legal) that aren't in the deck, ordered by EDHREC rank and then price (`--sort price` reverses that). Cards over the deck's price cap (`max_card_price`, or Custom Dollar Brawl's 1 USD) are left out and counted. Each shows its reason from the deck's `considered` list, or `not in considered`. The last line counts the shown cards without a reason, and all of them. Lands are left out unless you pass `--lands`; `--role` and `--text` narrow the list.

### Reading and finishing a deck

```sh
mise run deck:show -- green-value --oracle            # commanders, then the mainboard by role, with rules text
mise run deck:show -- green-value --role removal
mise run deck:stats -- green-value --upgrades apply   # the deck as it would be with every upgrade made
mise run deck:verify -- green-value                   # ready to hand off?
```

- **`deck:stats`** compares role counts with the deck's `role_targets`, or, for a Commander deck without them, the Command Zone template (ramp 10–12, draw 10+, removal 10–12, wipes 3–4). It also gives opening-hand odds: the chance of 0–1, 2–4 or 5+ lands in seven cards, and of at least one ramp card.
- **`deck:verify`** runs `deck:check` and adds what a finished deck needs. It fails on a placeholder primer, a top-20 left-out card without a `considered` reason (`--limit` changes 20), upgrades over budget or without one, and decklist files that differ from what `deck:files` would write. It notes lands more than one away from Karsten's suggestion and role counts outside their targets, which need explaining rather than fixing.

### Viewing a deck on Moxfield or Archidekt

Neither site has a public API for creating decks, so export and paste:

```sh
mise run deck:export -- green-value --format moxfield --copy
mise run deck:export -- green-value --upgrades apply --copy   # every upgrade swap made, for playtesting
```

- **Default format:** `MTG_EXPORT_FORMAT` in `.env` (see [.env.example](.env.example)); `--format` overrides it, and without either the format is `text`.
- **Moxfield:** create a deck and paste into Import, or replace an existing list with Bulk Edit. The export uses MTG Arena's `Commander`/`Deck`/`Sideboard` sections.
- **Archidekt:** open a deck's Import menu, paste and save. Roles become Title Case categories and commanders get `[Commander{top}]`.
- **Printings:** a pinned `scryfall_id` wins, then the printing you own in an available collection, then Scryfall's default printing if the cache came from bulk data, else any cached printing. The plain `text` format lists names only.
- **Upgrades:** `--upgrades apply` makes every swap. Moxfield gets the full upgraded deck in Deck; Archidekt tags the added cards with an `Upgrade` category, still in the deck, and the text format lists them under Upgrades. `--upgrades split` lists the cards the upgrades keep as the deck, the cards they would cut in the sideboard (Moxfield's `Sideboard` section, Archidekt's `Sideboard` category) and the cards they would add as candidates to buy (Moxfield's `Considering` section, Archidekt's `Maybeboard` category). Neither of those counts toward the deck, so the split deck is short by the number of swaps.

### Decklist files

Every finished deck keeps generated files beside `deck.yaml`, committed with it, in both Archidekt and Moxfield format:

```sh
mise run deck:files -- green-value
```

- **`decklist.archidekt.txt`, `decklist.moxfield.txt`:** the deck exported with `--upgrades split`.
- **`decklist-upgraded.archidekt.txt`, `decklist-upgraded.moxfield.txt`:** the deck exported with `--upgrades apply`: the full deck with every swap made and no sideboard, with the added cards in an `Upgrade` category in Archidekt. They're written only when the deck has upgrades, and removed when it has none.
- **Buying upgrades:** import `decklist.moxfield.txt` or `decklist.archidekt.txt` and select its Considering section (Maybeboard in Archidekt), which holds every upgrade card. Its Sideboard holds the cards they replace.

`MTG_EXPORT_FORMAT` doesn't apply here. The files are overwritten on every run, and decklist files under older names (`decklist.txt`, `decklist-upgraded.txt`, `decklist-archidekt.txt` and so on) are removed, so rerun `deck:files` after every deck edit, including upgrade changes.

`--copy` uses `pbcopy`, `clip`, or `wl-copy`/`xclip`/`xsel` depending on the OS.

### Physically building a deck

Once a deck is finished and you've sleeved it up, move its cards out of the shared collections so other decks stop counting them:

```sh
mise run deck:build -- brad/great-goblin-penny            # dry run: what it would take, from which file
mise run deck:build -- brad/great-goblin-penny --apply    # do it
```

- **What it does:** takes every card in the deck, commanders included, out of the deck's available collections, lowering a row's quantity or removing the row (and removing a file left with no cards). It writes them to one text list and sets `collection_destination` and `status: built` in `deck.yaml`.
- **Where:** `MTG_BUILD_DESTINATION` in `.env` is a template, such as `collections/{owner}/protected/custom/{name}.txt`, where `{owner}` is the deck's folder under `builds/` and `{name}` its name. Without it the list goes to `collections/<owner>/decks/<deck name>.txt`, and `--to PATH` overrides both. Keep it inside a protected folder; the dry run warns otherwise.
- **Which copies:** a pinned `scryfall_id` first, then nonfoil copies before foil or etched ones, then the printing with the most available copies (the one the decklist files show), then the rest in collection order. Protected copies and proxies are never taken. With `unlimited_basics`, basics the collections lack are listed by name as coming from untracked basics.
- **Requirements:** the deck must pass `deck:check`, apart from problems only its unapplied upgrades cause, and it can be built only once. Upgrades aren't applied, so build after making any swaps you want in `mainboard`.
- **Other drafts:** the dry run names the drafts that play any card it takes from a collection they read too, since they may come up short afterwards.
- **All or nothing:** every file it changes (the deck's new list, each collection it takes from, `deck.yaml`) is written to a temporary file first and only then moved into place, so a failure part way changes nothing. The same holds for `deck:teardown` and `deck:swap`. Paths in `deck.yaml` and on the command line must stay inside `collections/`.
- **Afterwards:** the deck reads its own list as available, whatever its `collection_source` says, and every other deck sees those cards as protected (`collections/**/decks` is protected by default). Rerun `deck:files`.
- **ManaBox exports:** the edited CSV now differs from ManaBox. Before your next export, move the same cards into a deck binder in ManaBox (whose cards are held back anyway) or out of the app, or the cards will count twice.
- **What the text list keeps:** printing and finish. Purchase price, condition and language from a CSV row aren't carried over; they stay in Git history.

### Taking a built deck apart

When you take a built deck apart, return its cards to your collection's text lists:

```sh
mise run deck:teardown -- conrad/kwias-canopy --to collections/conrad/binders/Alphabetized.txt --lands-to collections/conrad/binders/Lands.txt          # dry run
mise run deck:teardown -- conrad/kwias-canopy --to collections/conrad/binders/Alphabetized.txt --lands-to collections/conrad/binders/Lands.txt --apply  # do it
```

- **What it does:** adds every card in the deck's `collection_destination` list to the `--to` text list, and lands to `--lands-to` if given. A line with the same printing and finish gets its quantity raised. Otherwise a new line is added, in alphabetical order if the list is sorted by name (a few misfiled lines are fine), else at the end. Then it deletes the deck's list, removes `collection_destination` and sets `status: built` back to `draft`. The decklist in `deck.yaml` stays.
- **Destinations:** text lists under `collections/` only, never ManaBox CSVs. A list that doesn't exist yet is created. Returning to a protected list gets a warning, since no deck would count those cards.
- **Untracked basics** (name-only lines from `unlimited_basics`) aren't returned, since no collection held them.

### Swapping cards

To swap cards in a deck, especially a built one whose physical cards have to move too:

```sh
mise run deck:swap -- conrad/kwia-lotus-engine --out "Tome of Legends" --in "Gleaming Splendor" --to collections/conrad/binders/Alphabetized.txt          # dry run
mise run deck:swap -- conrad/kwia-lotus-engine --out "Tome of Legends" --in "Gleaming Splendor" --to collections/conrad/binders/Alphabetized.txt --apply  # do it
```

- **Pairs:** each `--out` pairs with the `--in` at the same place and swaps one copy. Repeat the options for more cards, or repeat a pair for more copies.
- **`deck.yaml`:** a new card takes the out card's place and role, keeping comments such as role headings. A card already in the mainboard gets a copy added instead. Edit the role afterwards if it differs.
- **Records:** each swap adds a `history` entry dated today. `--reason TEXT`, one per `--out`, becomes that card's `considered` reason and the entry's notes, so `deck:candidates` doesn't list it unexplained. Each in card leaves `considered`.
- **Built decks:** the swapped deck must pass `deck:check`. Each in card is taken from the other available collections into the deck's `collection_destination` list, choosing copies the way `deck:build` does, and each out card goes from that list to the `--to` text list (lands to `--lands-to`, if given), as `deck:teardown` returns them. If an in card comes from a ManaBox export, move the same card in ManaBox before your next export.
- **Drafts:** only `deck.yaml` changes, and `deck:check`'s result is shown.
- **Upgrades:** it warns about any upgrade that cuts a card the swap took out, or adds one it put in, so you can fix them. Rerun `deck:files` afterwards.

### Formatting and linting

Prettier formats, ESLint lints ([eslint.config.js](eslint.config.js)). Two things keep code tidy without thinking about it:

- **On commit:** the pre-commit hook from `setup` fixes and re-stages staged files, and blocks the commit on lint errors it can't fix. It refuses files with unstaged changes, since re-staging them would sweep those changes in; stage everything or run `mise run fix` first. `git commit --no-verify` skips it.
- **On check:** `mise run check` fails on unformatted or unlinted files. It checks only built decks, so a draft in progress never turns it red; `mise run decks:check` checks every deck.

## Deck folders

- Decks can be grouped in subfolders, such as `builds/brad/bruenor-forge/`. `decks:check` finds every `deck.yaml` at any depth.
- Commands take the full path (`brad/bruenor-forge`) or just the deck's folder name (`bruenor-forge`) when no other deck shares it. A shared name asks for the full path.
- `mise run deck:new -- brad/<slug>` creates a nested deck, with the editor `$schema` path adjusted for its depth. Moving a deck by hand means fixing that first line's `../` count yourself.

## Collection rules

- Every `.csv` or `.txt` under `collections/`, at any depth, is a collection named by its path inside `collections/` without the extension (e.g. `conrad/precons`). Every one counts as available unless it's protected. Add a collection by dropping in a new ManaBox export or text list, in a subfolder if you like. A CSV and a text list with the same name are an error rather than counted twice.
- A text list is what Moxfield, Archidekt and MTG Arena export: one card per line, like `1 Sol Ring (TMC) 59`, `4x Forest (tmt) 319 *F*` (`*F*` foil, `*E*` etched) or just `1 Sol Ring`. Section headings such as `Commander`, `Deck` and `Sideboard`, `//` comments and Archidekt's `[Category]` tags are ignored, and any other line is an error.
- Text lists carry no Scryfall IDs, so each line is matched to the card cache by set code and collector number, or by name when it has no printing. The name must be that printing's, though a single slash (`Dusk / Dawn`) and a printing's alternate name (`Aggro Amalgam` for Voracious Hydra) are fine; a mismatch is reported as a typo. Lines not cached yet count toward nothing, and `collection:check` lists them until `scryfall:refresh -- --missing` fetches them. Text lists have no proxies, deck binders or purchase prices.
- Both settings below take comma-separated glob patterns relative to the project root. `*` matches within one folder or file name and `**` across folders. A pattern matches a collection's path, the path without its extension, or any folder it sits in, so `collections/conrad*` selects everything in `collections/conrad/`.
- Protected collections are ones you don't want to dismantle, such as precons. Their copies are shown as e.g. "3 in conrad/precons (protected)" but never fill a deck. List patterns for them in `MTG_PROTECTED_COLLECTIONS` in `.env`, e.g. `collections/**/precons` or `collections/**/decks/**`. `--protect PATTERNS` overrides it for one command, and `--protect ''` protects nothing. With neither set, every `precons.csv`, `precons.txt` and `precons/` folder and every `decks/` folder at any depth is protected.
- A deck can name its own collections with a `collection_source` list of patterns in `deck.yaml`, such as a friend's deck built only from `collections/brad/*`. Every deck command, `decks:check` included, then reads just those collections for it. `--collections` beats a deck's field, which beats `MTG_COLLECTIONS`. A built deck's `collection_destination` is read on top of whichever applies, and is never protected from that deck.
- To read only some collections, list patterns in `MTG_COLLECTIONS` in `.env`, e.g. `MTG_COLLECTIONS=collections/conrad*,collections/other*`, or pass `--collections PATTERNS` to one command. The rest are ignored entirely, and protection still applies to the ones read. Empty means every collection. `scryfall:refresh` always covers every collection, so changing the list never leaves card data missing.
- ManaBox binder exports (with `Binder Name` and `Binder Type` columns) work too. A card named in any of the export's deck binders is in use: every copy of it, spares in other binders included, is shown as e.g. "3 in BradsCollection decks (protected)" and never fills a new deck.
- `collection:check` lists the collections it reads and marks the protected ones. A pattern in either list that matches no collection gets a warning.
- Never hand-edit ManaBox exports; replace them with fresh exports when the collection changes. `deck:build --apply` and `deck:swap --apply` are the only tools that edit them (see above); `deck:teardown --apply` edits only text lists. Text lists can be edited by hand.
- Every deck is checked on its own. Two decks can both use your only copy of a card, until one of them is built.
- All printings and finishes of a card count together.
- Proxy rows count only when the deck sets `allow_proxies: true`. An export without a `Proxy` column has no proxies.
- Basic lands count from the export unless the deck sets `unlimited_basics: true`, for when you have a pile of basics that never went into ManaBox.

## Deck files

See [the example](builds/example/deck.yaml) and [the schema](schemas/deck.schema.json). The example is a 40-card structural template, not a real deck.

`deck:new` fills the header from the brief: `--target-bracket`, `--budget`, `--max-card-price` (both in `--currency`, USD by default), `--primer`, `--collection-source` and `--unlimited-basics`/`--allow-proxies` (or their `--no-` forms). The last two default to `MTG_UNLIMITED_BASICS` and `MTG_ALLOW_PROXIES` in `.env`, else false.

| Field                               | Meaning                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                            | `commander` (exactly 100 including commanders), `custom-dollar-brawl` (a house format: exactly 60 including commanders, Commander legality, every card at most 1 USD unless `max_card_price` says otherwise) or `casual-60` (at least 60). Moxfield's format names: [formats.md](.claude/skills/deckbuilding-strategy/formats.md) |
| `status`                            | `draft` or `built`; `example` is for the template only                                                                                                                                                                                                                                                                            |
| `commanders`                        | One or two entries with quantity 1; `[]` for casual                                                                                                                                                                                                                                                                               |
| `mainboard`                         | Everything else, including lands                                                                                                                                                                                                                                                                                                  |
| card entry                          | `name`, `quantity`, optional `role` (comma-separated labels) and `scryfall_id` (pins the printing used for pricing)                                                                                                                                                                                                               |
| `target_bracket`                    | Optional Commander Bracket (1–5) the deck is built for; `deck:check` fails cards that need a higher one                                                                                                                                                                                                                           |
| `plays_like_bracket`                | How the deck actually plays, judged by its reviewer with reasons in `power_notes`; `deck:files` removes it when the cards change                                                                                                                                                                                                  |
| `lowest_legal_bracket`              | The lowest bracket its cards allow (Game Changers, extra turns, mass land denial), written by `deck:files`                                                                                                                                                                                                                        |
| `allow_proxies`, `unlimited_basics` | Ownership policy, see above                                                                                                                                                                                                                                                                                                       |
| `collection_source`                 | Optional path globs of the collections the deck is built from, e.g. `['collections/brad/*']`                                                                                                                                                                                                                                      |
| `collection_destination`            | The deck's own text list once physically built, set by `deck:build --apply`, e.g. `collections/brad/decks/elves.txt`                                                                                                                                                                                                              |
| `budget`                            | `amount` and `currency` (`USD`/`EUR`), needed for `deck:upgrades`                                                                                                                                                                                                                                                                 |
| `max_card_price`                    | Optional `amount` and `currency`; `deck:check` fails any card (upgrade adds included) whose cheapest printing costs more. Basics are exempt                                                                                                                                                                                       |
| `considered`                        | Owned cards weighed and left out, each a `name` and `reason`; `deck:candidates` shows them                                                                                                                                                                                                                                        |
| `role_targets`                      | Optional role counts to aim for, e.g. `ramp: { min: 10, max: 12 }`; `deck:stats` compares. Commander decks default to the Command Zone template                                                                                                                                                                                   |
| `history`                           | List reviews and swaps: `date`, `changes`, optional `notes`; `deck:swap` adds an entry                                                                                                                                                                                                                                            |
| `upgrades`                          | Paired `add`/`cut`/`reason` swaps; never applied automatically                                                                                                                                                                                                                                                                    |
| `playtests`                         | Games played: `date` (`"YYYY-MM-DD"`), `notes`, optional `changes`                                                                                                                                                                                                                                                                |
| `primer`, `power_notes`, `notes`    | Free text; the `new-deck` skill keeps the engine map in `notes`                                                                                                                                                                                                                                                                   |

Use exact Scryfall names. You can give a double-faced card by its front-face name.

## Card data and prices

- **Refresh.** `scryfall:refresh` batches requests to Scryfall's collection endpoint (75 cards per request, 550ms apart) and keeps only the fields the tools use. A plain refresh fetches every collection and deck card again, for fresh data and prices. On a cache built from bulk data it keeps every other printing, so `--unowned` keeps working; otherwise, or with `--prune`, the cache ends up with just those cards. `--missing` adds only what's not cached.
- **Failures.** Rate limits (429), server errors and dropped connections are retried after 1, 2 and 4 seconds, or after Scryfall's `Retry-After`. Any other failure leaves the old cache in place. Only one refresh runs at a time: a second one stops at `.cache/refresh.lock` while the first is running, and takes over a lock its process left behind.
- **Cache file.** The rules fields every printing shares are stored once per card, and legalities only where a card isn't `not_legal`, so a bulk cache is about 55 MB and each command loads it in about half a second. A cache written in the older one-record-per-printing layout is still read, and the next refresh rewrites it. `collection:check` starts with a line describing the cache: printings and cards, whether from bulk data, and when it was last refreshed.
- **Bulk data.** `scryfall:refresh -- --bulk` caches every printing on Scryfall from its daily [bulk data](https://scryfall.com/docs/api/bulk-data): the Default Cards file (every printing in English, or in its only language) and the Oracle Cards file, which marks the printing Scryfall shows for each name. That's about 105 MB of downloads and half a minute. It then fetches only what bulk data lacks, such as non-English printings in a collection. Afterwards, unowned cards named in a deck need no further fetching, and both a plain refresh and `--missing` keep the bulk data. Scryfall rebuilds the files every 12–24 hours, and its gameplay data changes rarely, so weekly or after a set release is plenty. Bulk prices are as old as the file, so they still go stale after 7 days.
- **Shared names.** Bulk data includes tokens, art cards and playtest cards that share names with real cards. When a name matches several cards and only one is legal in some format, that one is meant.
- **Old card data.** Card data older than 30 days adds a note to `deck:check` output but doesn't fail the check. Refresh to pick up new bans.
- **Prices.** `deck:upgrades` uses the cheapest cached Scryfall nonfoil quote less than 7 days old, or the printing set by `scryfall_id`. Older or missing quotes count as unknown, never zero. Shipping and tax aren't included. Cuts aren't resold. Gold-bordered and memorabilia printings (World Championship decks, Collectors' Edition) can't be played, so they never set a price unless they're a card's only printings. A cache from before these fields were recorded treats every printing as playable until the next refresh.
- **Game Changers.** Scryfall marks each card on Wizards' Game Changers list, so they count toward `lowest_legal_bracket`, and `deck:check` fails them when they need a higher bracket than `target_bracket`. `collection:search -- --game-changers` shows which ones you own. Refresh card data when the list changes.
- **Brackets.** `deck:files` (and `deck:swap --apply`) writes `lowest_legal_bracket`: the lowest Commander Bracket the cards allow. Game Changers raise it to 3 (4 with more than three), cards that take extra turns to 2, and mass land denial found in rules text (Armageddon, Blood Moon, Winter Orb) to 4. Two-card combos and intent aren't detected, so it's a floor, not a rating. `plays_like_bracket` is the rating: a reviewer's judgment of the whole list. `deck:files` removes it when the card list changes (it compares the committed Moxfield list, ignoring printings and upgrade adds), and `deck:swap --apply` always does. `deck:verify` fails when either is missing or out of date, `deck:check` fails a `plays_like_bracket` above `target_bracket` or below `lowest_legal_bracket`, and `deck:stats` shows all three.
- **Upgrades.** `deck:check` judges the deck with every upgrade made, too: adds outside the color identity, not legal in the format, over the copy limit or needing a higher bracket than `target_bracket` fail, marked "With upgrades applied".
- **Land sources.** In a commander format, `deck:stats` counts only the colors inside the commanders' identity, so Command Tower in a green-white deck counts for green and white.
- **Land count.** `deck:stats` prints Frank Karsten's suggested land count from the deck's average mana value and its cheap `ramp`/`draw` cards (mana value 2 or less).
- **Commander pairings.** Partner, Partner with, Friends forever, Choose a Background and Doctor's companion are recognized. Any other pair is reported for manual review.
- **Limits.** Casual checks only enforce deck size and copy limits, not a sanctioned format.

## Working with an assistant

Point the assistant at [AGENTS.md](AGENTS.md) (Claude Code and Copilot load it automatically). In Claude Code, these skills load when relevant, or run them as slash commands:

- [`new-deck`](.claude/skills/new-deck/SKILL.md): the step-by-step brewing process, from the brief to the hand-off.
- [`collection-survey`](.claude/skills/collection-survey/SKILL.md): which commanders and themes the collection supports.
- [`deck-review`](.claude/skills/deck-review/SKILL.md): the check-and-fix loop for reviewing or finishing a deck.
- [`deck-upgrades`](.claude/skills/deck-upgrades/SKILL.md): suggesting and pricing purchases.
- [`physical-deck`](.claude/skills/physical-deck/SKILL.md): building, swapping or tearing down a deck's physical cards.
- [`deckbuilding-strategy`](.claude/skills/deckbuilding-strategy/SKILL.md): established frameworks (Commander Brackets, the Command Zone template, Karsten's land math).

A good opening brief:

> Find three Commander directions my collection supports. Keep precons intact, aim for casual interactive games, and suggest up to $30 of upgrades. Let me pick a direction before you build the list.
