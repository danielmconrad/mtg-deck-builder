# MTG Deck Builder

A workspace for brewing Commander and casual 60-card decks from cards you own, with an AI assistant doing the brewing and small offline scripts doing the checking. Decks are YAML files in Git; card data comes from Scryfall.

## Setup

Install [mise](https://mise.jdx.dev/getting-started.html), then:

```sh
mise trust && mise install
mise run setup          # npm ci (network) and the git pre-commit hook
mise run cards:refresh  # fetch card data and prices (network)
mise run check          # offline: collection, tests, every deck
```

## Layout

```text
collections/Organized.csv   ManaBox export: cards available for decks
collections/Precons.csv     ManaBox export: precon cards, reported but never used
decks/<slug>/deck.yaml      One file per deck (see decks/example and schemas/)
scripts/                    CLI (cli.mjs) and the modules behind it
tests/                      Offline tests on synthetic fixtures
.cache/cards.json           Scryfall data (ignored by Git)
```

## Commands

Pass arguments after `--`, e.g. `mise run deck:check -- green-value`.

| Command                               | What it does                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `collection:check`                    | Validate both CSVs and summarize them                                                               |
| `collection:search -- [filters]`      | Find owned cards (see below)                                                                        |
| `cards:refresh [-- --missing]`        | Fetch Scryfall data for every collection row and deck card; `--missing` fetches only uncached cards |
| `deck:new -- <slug> --commander NAME` | Create a draft deck (`--commander` twice for partners; `--format casual-60` for casual)             |
| `deck:check -- <slug>`                | Check size, commander rules, color identity, bans, copy limits and ownership                        |
| `deck:stats -- <slug>`                | Curve, card types, color pips, land color sources and role counts                                   |
| `deck:upgrades -- <slug>`             | Price the upgrade package plus any shortfalls against the budget                                    |
| `deck:export -- <slug>`               | Print a plain-text list for deck sites                                                              |
| `decks:check`                         | Check every deck; the example is schema-checked only                                                |
| `lint`                                | ESLint plus a Prettier formatting check                                                             |
| `fix`                                 | Apply ESLint fixes and format everything with Prettier                                              |
| `check`                               | `lint`, `collection:check`, `test` and `decks:check`                                                |

Exit codes: `0` passed, `1` a check failed or input is invalid, `2` incomplete (unknown cards, missing card data, unknown prices).

### Searching the collection

```sh
mise run collection:search -- --commander "Radagast the Brown" --type creature --max-mv 3
mise run collection:search -- --identity BG --text "graveyard" --oracle
mise run collection:search -- --identity C --type artifact --text "add \{" --json
```

`--commander NAME` limits results to that commander's color identity and Commander-legal cards. `--identity` takes letters from `WUBRG`, or `C` for colorless only. `--type`, `--text` and `--name` are case-insensitive regular expressions, and you can repeat `--type` and `--text`. `--min-mv`/`--max-mv` filter by mana value. `--legal FORMAT` uses Scryfall format names. `--precons` adds cards that only exist in Precons. `--proxies` counts proxy rows. `--oracle` prints rules text. `--json` prints machine-readable output.

### Formatting and linting

Prettier formats, ESLint lints ([eslint.config.js](eslint.config.js)). Two things keep code tidy without thinking about it:

- **On commit:** the pre-commit hook from `setup` fixes and re-stages staged files, and blocks the commit on lint errors it can't fix. It refuses files with unstaged changes, since re-staging them would sweep those changes in; stage everything or run `mise run fix` first. `git commit --no-verify` skips it.
- **On check:** `mise run check` fails on unformatted or unlinted files.

## Collection rules

- Only Organized counts as available. Precons copies are shown as "in Precons (protected)" but never fill a deck. To use them, move them to Organized in ManaBox and re-export.
- Never hand-edit the exports. Replace them with fresh exports when the collection changes.
- Every deck is checked on its own. Two decks can both use your only copy of a card.
- All printings and finishes of a card count together.
- Proxy rows count only when the deck sets `allow_proxies: true`.
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
| `allow_proxies`, `unlimited_basics` | Ownership policy, see above                                                                                         |
| `budget`                            | `amount` and `currency` (`USD`/`EUR`), needed for `deck:upgrades`                                                   |
| `upgrades`                          | Paired `add`/`cut`/`reason` swaps; never applied automatically                                                      |
| `playtests`                         | `date` (`"YYYY-MM-DD"`), `notes`, optional `changes`                                                                |
| `strategy`, `power_notes`, `notes`  | Free text                                                                                                           |

Use exact Scryfall names. You can give a double-faced card by its front-face name.

## Card data and prices

- **Refresh.** `cards:refresh` batches requests to Scryfall's collection endpoint (75 cards per request, 550ms apart) and keeps only the fields the tools use. A failed refresh leaves the old cache in place.
- **Old card data.** Card data older than 30 days adds a note to `deck:check` output but doesn't fail the check. Refresh to pick up new bans.
- **Prices.** `deck:upgrades` uses the cheapest cached Scryfall nonfoil quote less than 7 days old, or the printing set by `scryfall_id`. Older or missing quotes count as unknown, never zero. Shipping and tax aren't included. Cuts aren't resold.
- **Commander pairings.** Partner, Partner with, Friends forever, Choose a Background and Doctor's companion are recognized. Any other pair is reported for manual review.
- **Limits.** Casual checks only enforce deck size and copy limits, not a sanctioned format.

## Working with an assistant

Point the assistant at [AGENTS.md](AGENTS.md) (Claude Code and Copilot load it automatically). A good opening brief:

> Find three Commander directions my Organized collection supports. Keep precons intact, aim for casual interactive games, and suggest up to $30 of upgrades. Let me pick a direction before you build the list.
