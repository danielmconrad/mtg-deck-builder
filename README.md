# MTG Deck Builder

A workspace for brewing Commander and casual 60-card decks from cards you own, with an AI assistant doing the brewing and small offline scripts doing the checking. Decks are YAML files in Git; card data comes from Scryfall.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html), then:

```sh
mise trust && mise install
mise run setup          # npm ci (network) and the git pre-commit hook
mise run cards:refresh  # fetch card data and prices (network)
mise run check          # offline: collection, tests, every deck
cp .env.example .env    # project defaults, e.g. the export format (ignored by Git)
```

## Layout

```text
collections/*.csv           ManaBox exports, one per collection, named after the file
                            (e.g. Organized.csv). Protected ones are reported but never used
decks/<slug>/deck.yaml      One file per deck (see decks/example and schemas/); may be nested, e.g. decks/brad/<slug>/
decks/<slug>/decklist*.txt  Generated Archidekt and Moxfield decklists, written by deck:files and committed
scripts/                    CLI (cli.mjs) and the modules behind it
tests/                      Offline tests on synthetic fixtures
.cache/cards.json           Scryfall data (ignored by Git)
```

## Commands

`mise tasks ls` lists every task. Deck and collection tasks pass arguments after `--` to the CLI, which documents its own options:

```sh
mise run deck:export -- --help      # options for one command
node scripts/cli.mjs --help         # every command, plus exit codes
```

| Task                | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `collection:check`  | Validate both CSVs and summarize them                               |
| `collection:search` | Find owned cards by color identity, type, rules text and mana value |
| `cards:refresh`     | Fetch Scryfall card data and prices (network)                       |
| `deck:new`          | Create a draft deck                                                 |
| `deck:check`        | Check rules and ownership for one deck                              |
| `deck:stats`        | Curve, card types, color pips, land sources and roles               |
| `deck:upgrades`     | Price the upgrade package and any shortfalls against the budget     |
| `deck:export`       | Print or copy a paste-ready decklist                                |
| `deck:files`        | Write the committed decklist files beside `deck.yaml`               |
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
- **Printings:** a pinned `scryfall_id` wins, then the printing you own in an available collection, then any cached printing. The plain `text` format lists names only.
- **Upgrades:** `--upgrades apply` makes every swap and lists the added cards in their own Upgrades section (an `Upgrade` category in Archidekt), so they're easy to select for buying. Moxfield's import has no custom sections, so there the added cards go in the sideboard instead of Deck. `--upgrades split` keeps the deck, lists the cards it would cut under Swap Out (still in the deck) and the cards it would add in the sideboard. Moxfield has no Swap Out section, so those cards stay in Deck.

### Decklist files

Every finished deck keeps generated files beside `deck.yaml`, committed with it, in both Archidekt and Moxfield format:

```sh
mise run deck:files -- green-value
```

- **`decklist.archidekt.txt`, `decklist.moxfield.txt`:** the deck exported with `--upgrades split`.
- **`decklist-upgraded.archidekt.txt`, `decklist-upgraded.moxfield.txt`:** the deck exported with `--upgrades apply`: every swap made, with the added cards in an `Upgrade` category in Archidekt. They're written only when the deck has upgrades, and removed when it has none.
- **Buying upgrades:** in Archidekt, select the `Upgrade` category of the upgraded list. In Moxfield, import `decklist-upgraded.moxfield.txt` and select its sideboard, which holds every upgrade card; its Deck section is the baseline with the cuts made, so it's short by the number of swaps.

`MTG_EXPORT_FORMAT` doesn't apply here. The files are overwritten on every run, and decklist files under older names (`decklist.txt`, `decklist-upgraded.txt`, `decklist-archidekt.txt` and so on) are removed, so rerun `deck:files` after every deck edit, including upgrade changes.

`--copy` uses `pbcopy`, `clip`, or `wl-copy`/`xclip`/`xsel` depending on the OS.

### Formatting and linting

Prettier formats, ESLint lints ([eslint.config.js](eslint.config.js)). Two things keep code tidy without thinking about it:

- **On commit:** the pre-commit hook from `setup` fixes and re-stages staged files, and blocks the commit on lint errors it can't fix. It refuses files with unstaged changes, since re-staging them would sweep those changes in; stage everything or run `mise run fix` first. `git commit --no-verify` skips it.
- **On check:** `mise run check` fails on unformatted or unlinted files.

## Deck folders

- Decks can be grouped in subfolders, such as `decks/brad/bruenor-forge/`. `decks:check` finds every `deck.yaml` at any depth.
- Commands take the full path (`brad/bruenor-forge`) or just the deck's folder name (`bruenor-forge`) when no other deck shares it. A shared name asks for the full path.
- `mise run deck:new -- brad/<slug>` creates a nested deck, with the editor `$schema` path adjusted for its depth. Moving a deck by hand means fixing that first line's `../` count yourself.

## Collection rules

- Every `.csv` under `collections/`, at any depth, is a collection named by its path inside `collections/` without `.csv` (e.g. `conrad/Precons`). Every one counts as available unless it's protected. Add a collection by dropping in a new ManaBox export, in a subfolder if you like.
- Both settings below take comma-separated glob patterns relative to the project root. `*` matches within one folder or file name and `**` across folders. A pattern matches a CSV's path, the path without `.csv`, or any folder it sits in, so `collections/conrad*` selects everything in `collections/conrad/`.
- Protected collections are ones you don't want to dismantle, such as precons. Their copies are shown as e.g. "3 in conrad/Precons (protected)" but never fill a deck. List patterns for them in `MTG_PROTECTED_COLLECTIONS` in `.env`, e.g. `collections/**/Precons.csv`. `--protect PATTERNS` overrides it for one command, and `--protect ''` protects nothing. With neither set, every `Precons.csv` at any depth is protected.
- A deck can name its own collections with a `collections` list of patterns in `deck.yaml`, such as a friend's deck built only from `collections/brad/*`. Every deck command, `decks:check` included, then reads just those collections for it. `--collections` beats a deck's field, which beats `MTG_COLLECTIONS`.
- To read only some collections, list patterns in `MTG_COLLECTIONS` in `.env`, e.g. `MTG_COLLECTIONS=collections/conrad*,collections/other*`, or pass `--collections PATTERNS` to one command. The rest are ignored entirely, and protection still applies to the ones read. Empty means every collection. `cards:refresh` always covers every collection, so changing the list never leaves card data missing.
- ManaBox binder exports (with `Binder Name` and `Binder Type` columns) work too. A card named in any of the export's deck binders is in use: every copy of it, spares in other binders included, is shown as e.g. "3 in BradsCollection decks (protected)" and never fills a new deck.
- `collection:check` lists the collections it reads and marks the protected ones. A pattern in either list that matches no collection gets a warning.
- Never hand-edit the exports. Replace them with fresh exports when the collection changes.
- Every deck is checked on its own. Two decks can both use your only copy of a card.
- All printings and finishes of a card count together.
- Proxy rows count only when the deck sets `allow_proxies: true`. An export without a `Proxy` column has no proxies.
- Basic lands count from the export unless the deck sets `unlimited_basics: true`, for when you have a pile of basics that never went into ManaBox.

## Deck files

See [the example](decks/example/deck.yaml) and [the schema](schemas/deck.schema.json). The example is a 40-card structural template, not a real deck.

| Field                               | Meaning                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `format`                            | `commander` (exactly 100 including commanders) or `casual-60` (at least 60)                                         |
| `status`                            | `draft` or `ready`; `example` is for the template only                                                              |
| `commanders`                        | One or two entries with quantity 1; `[]` for casual                                                                 |
| `mainboard`                         | Everything else, including lands                                                                                    |
| card entry                          | `name`, `quantity`, optional `role` (comma-separated labels) and `scryfall_id` (pins the printing used for pricing) |
| `bracket`                           | Optional Commander Bracket (1–5); `deck:check` enforces its Game Changer limit                                      |
| `allow_proxies`, `unlimited_basics` | Ownership policy, see above                                                                                         |
| `collections`                       | Optional path globs of the collections the deck is built from, e.g. `['collections/brad/*']`                        |
| `budget`                            | `amount` and `currency` (`USD`/`EUR`), needed for `deck:upgrades`                                                   |
| `upgrades`                          | Paired `add`/`cut`/`reason` swaps; never applied automatically                                                      |
| `playtests`                         | `date` (`"YYYY-MM-DD"`), `notes`, optional `changes`                                                                |
| `primer`, `power_notes`, `notes`    | Free text                                                                                                           |

Use exact Scryfall names. You can give a double-faced card by its front-face name.

## Card data and prices

- **Refresh.** `cards:refresh` batches requests to Scryfall's collection endpoint (75 cards per request, 550ms apart) and keeps only the fields the tools use. A failed refresh leaves the old cache in place.
- **Old card data.** Card data older than 30 days adds a note to `deck:check` output but doesn't fail the check. Refresh to pick up new bans.
- **Prices.** `deck:upgrades` uses the cheapest cached Scryfall nonfoil quote less than 7 days old, or the printing set by `scryfall_id`. Older or missing quotes count as unknown, never zero. Shipping and tax aren't included. Cuts aren't resold.
- **Game Changers.** Scryfall marks each card on Wizards' Game Changers list, so `deck:check` lists a Commander deck's Game Changers and enforces the limit when `bracket` is set. `collection:search -- --game-changers` shows which ones you own. Refresh card data when the list changes.
- **Land count.** `deck:stats` prints Frank Karsten's suggested land count from the deck's average mana value and its cheap `ramp`/`draw` cards (mana value 2 or less).
- **Commander pairings.** Partner, Partner with, Friends forever, Choose a Background and Doctor's companion are recognized. Any other pair is reported for manual review.
- **Limits.** Casual checks only enforce deck size and copy limits, not a sanctioned format.

## Working with an assistant

Point the assistant at [AGENTS.md](AGENTS.md) (Claude Code and Copilot load it automatically). In Claude Code, two skills load when relevant, or run them as slash commands: [`new-deck`](.claude/skills/new-deck/SKILL.md) holds the step-by-step brewing process, and [`deckbuilding-strategy`](.claude/skills/deckbuilding-strategy/SKILL.md) holds established frameworks (Commander Brackets, the Command Zone template, Karsten's land math) for building and reviewing decks. A good opening brief:

> Find three Commander directions my collection supports. Keep precons intact, aim for casual interactive games, and suggest up to $30 of upgrades. Let me pick a direction before you build the list.
