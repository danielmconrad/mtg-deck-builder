# MTG Deck Builder

A workspace for brewing Commander and casual 60-card decks from cards you own, with an AI assistant doing the brewing and small offline scripts doing the checking. Decks are YAML files in Git; card data comes from Scryfall.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html), then:

```sh
mise trust && mise install
mise run setup          # npm ci (network) and the git pre-commit hook
mise run scryfall:refresh  # fetch card data and prices (network); add -- --bulk for every card on Scryfall
mise run check          # offline: collection, tests, every deck
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
.cache/cards.json           Scryfall data, about 140 MB after a bulk refresh (ignored by Git)
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
| `scryfall:refresh`  | Fetch Scryfall card data and prices (network); `--bulk` for all     |
| `deck:new`          | Create a draft deck                                                 |
| `deck:check`        | Check rules and ownership for one deck                              |
| `deck:stats`        | Curve, card types, color pips, land sources and roles               |
| `deck:upgrades`     | Price the upgrade package and any shortfalls against the budget     |
| `deck:export`       | Print or copy a paste-ready decklist                                |
| `deck:files`        | Write the committed decklist files beside `deck.yaml`               |
| `deck:build`        | Physically build a deck: move its cards into its own collection     |
| `decks:check`       | Check every deck; the example is schema-checked only                |
| `lint` / `fix`      | Check, or fix, linting and formatting                               |
| `check`             | `lint`, `collection:check`, `test` and `decks:check`                |

Exit codes: `0` passed, `1` a check failed or input is invalid, `2` incomplete (unknown cards, missing card data, unknown prices).

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

See `mise run collection:search -- --help` for the full list.

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

- **What it does:** takes every card in the deck, commanders included, out of the deck's available collections, lowering a row's quantity or removing the row (and removing a file left with no cards). It writes them to one text list, by default `collections/<owner>/decks/<deck name>.txt` (`--to PATH` overrides), and adds `collection_destination` to `deck.yaml`.
- **Which copies:** a pinned `scryfall_id` first, then the printing with the most available copies (the one the decklist files show), then the rest in collection order. Protected copies and proxies are never taken. With `unlimited_basics`, basics the collections lack are listed by name as coming from untracked basics.
- **Requirements:** the deck must pass `deck:check`, and it can be built only once. Upgrades aren't applied, so build after making any swaps you want in `mainboard`.
- **Afterwards:** the deck reads its own list as available, whatever its `collection_source` says, and every other deck sees those cards as protected (`collections/**/decks` is protected by default). Rerun `deck:files`.
- **ManaBox exports:** the edited CSV now differs from ManaBox. Before your next export, move the same cards into a deck binder in ManaBox (whose cards are held back anyway) or out of the app, or the cards will count twice.
- **What the text list keeps:** printing and finish. Purchase price, condition and language from a CSV row aren't carried over; they stay in Git history.

### Formatting and linting

Prettier formats, ESLint lints ([eslint.config.js](eslint.config.js)). Two things keep code tidy without thinking about it:

- **On commit:** the pre-commit hook from `setup` fixes and re-stages staged files, and blocks the commit on lint errors it can't fix. It refuses files with unstaged changes, since re-staging them would sweep those changes in; stage everything or run `mise run fix` first. `git commit --no-verify` skips it.
- **On check:** `mise run check` fails on unformatted or unlinted files.

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
- Never hand-edit ManaBox exports; replace them with fresh exports when the collection changes. `deck:build --apply` is the one tool that edits them (see above). Text lists can be edited by hand.
- Every deck is checked on its own. Two decks can both use your only copy of a card, until one of them is built.
- All printings and finishes of a card count together.
- Proxy rows count only when the deck sets `allow_proxies: true`. An export without a `Proxy` column has no proxies.
- Basic lands count from the export unless the deck sets `unlimited_basics: true`, for when you have a pile of basics that never went into ManaBox.

## Deck files

See [the example](builds/example/deck.yaml) and [the schema](schemas/deck.schema.json). The example is a 40-card structural template, not a real deck.

| Field                               | Meaning                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                            | `commander` (exactly 100 including commanders), `commander-60` (exactly 60, Commander rules) or `casual-60` (at least 60)                   |
| `status`                            | `draft` or `built`; `example` is for the template only                                                                                      |
| `commanders`                        | One or two entries with quantity 1; `[]` for casual                                                                                         |
| `mainboard`                         | Everything else, including lands                                                                                                            |
| card entry                          | `name`, `quantity`, optional `role` (comma-separated labels) and `scryfall_id` (pins the printing used for pricing)                         |
| `bracket`                           | Optional Commander Bracket (1–5); `deck:check` enforces its Game Changer limit                                                              |
| `allow_proxies`, `unlimited_basics` | Ownership policy, see above                                                                                                                 |
| `collection_source`                 | Optional path globs of the collections the deck is built from, e.g. `['collections/brad/*']`                                                |
| `collection_destination`            | The deck's own text list once physically built, set by `deck:build --apply`, e.g. `collections/brad/decks/elves.txt`                        |
| `budget`                            | `amount` and `currency` (`USD`/`EUR`), needed for `deck:upgrades`                                                                           |
| `max_card_price`                    | Optional `amount` and `currency`; `deck:check` fails any card (upgrade adds included) whose cheapest printing costs more. Basics are exempt |
| `upgrades`                          | Paired `add`/`cut`/`reason` swaps; never applied automatically                                                                              |
| `playtests`                         | `date` (`"YYYY-MM-DD"`), `notes`, optional `changes`                                                                                        |
| `primer`, `power_notes`, `notes`    | Free text                                                                                                                                   |

Use exact Scryfall names. You can give a double-faced card by its front-face name.

## Card data and prices

- **Refresh.** `scryfall:refresh` batches requests to Scryfall's collection endpoint (75 cards per request, 550ms apart) and keeps only the fields the tools use. A plain refresh replaces the cache with just the collections' and decks' cards; `--missing` adds only what's not cached. A failed refresh leaves the old cache in place.
- **Bulk data.** `scryfall:refresh -- --bulk` caches every printing on Scryfall from its daily [bulk data](https://scryfall.com/docs/api/bulk-data): the Default Cards file (every printing in English, or in its only language) and the Oracle Cards file, which marks the printing Scryfall shows for each name. That's about 105 MB of downloads and half a minute. It then fetches only what bulk data lacks, such as non-English printings in a collection. Afterwards, unowned cards named in a deck need no further fetching, and `--missing` keeps the bulk data while adding to it. Scryfall rebuilds the files every 12–24 hours, and its gameplay data changes rarely, so weekly or after a set release is plenty. Bulk prices are as old as the file, so they still go stale after 7 days.
- **Shared names.** Bulk data includes tokens, art cards and playtest cards that share names with real cards. When a name matches several cards and only one is legal in some format, that one is meant.
- **Old card data.** Card data older than 30 days adds a note to `deck:check` output but doesn't fail the check. Refresh to pick up new bans.
- **Prices.** `deck:upgrades` uses the cheapest cached Scryfall nonfoil quote less than 7 days old, or the printing set by `scryfall_id`. Older or missing quotes count as unknown, never zero. Shipping and tax aren't included. Cuts aren't resold.
- **Game Changers.** Scryfall marks each card on Wizards' Game Changers list, so `deck:check` lists a Commander deck's Game Changers and enforces the limit when `bracket` is set. `collection:search -- --game-changers` shows which ones you own. Refresh card data when the list changes.
- **Land count.** `deck:stats` prints Frank Karsten's suggested land count from the deck's average mana value and its cheap `ramp`/`draw` cards (mana value 2 or less).
- **Commander pairings.** Partner, Partner with, Friends forever, Choose a Background and Doctor's companion are recognized. Any other pair is reported for manual review.
- **Limits.** Casual checks only enforce deck size and copy limits, not a sanctioned format.

## Working with an assistant

Point the assistant at [AGENTS.md](AGENTS.md) (Claude Code and Copilot load it automatically). In Claude Code, two skills load when relevant, or run them as slash commands: [`new-deck`](.claude/skills/new-deck/SKILL.md) holds the step-by-step brewing process, and [`deckbuilding-strategy`](.claude/skills/deckbuilding-strategy/SKILL.md) holds established frameworks (Commander Brackets, the Command Zone template, Karsten's land math) for building and reviewing decks. A good opening brief:

> Find three Commander directions my collection supports. Keep precons intact, aim for casual interactive games, and suggest up to $30 of upgrades. Let me pick a direction before you build the list.
