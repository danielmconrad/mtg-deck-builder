# Agent Instructions

Read [README.md](README.md) first, and the deck's `deck.yaml` (under `builds/`, possibly nested, e.g. `builds/brad/<slug>/`) when working on an existing deck. For a new deck, follow the `new-deck` skill in [.claude/skills/new-deck/SKILL.md](.claude/skills/new-deck/SKILL.md). For plans, role counts, land counts, brackets or reviewing a deck, use [deckbuilding-strategy](.claude/skills/deckbuilding-strategy/SKILL.md). Every command documents its options with `mise run <task> -- --help`. Ask before adding infrastructure such as a database, server or frontend.

## Collection

- Every `.csv` (ManaBox export) or `.txt` (Moxfield, Archidekt or Arena list) under `collections/`, at any depth, supplies cards except protected collections (`MTG_PROTECTED_COLLECTIONS` in `.env`, path globs, default `collections/**/precons,collections/**/decks`). Mention useful protected copies, but never put them in a deck. `MTG_COLLECTIONS` (path globs such as `collections/conrad*`) can limit which collections are read at all. A deck's own `collection_source` field in `deck.yaml` overrides `MTG_COLLECTIONS` for that deck, and a built deck's `collection_destination` list is always available to that deck alone. Don't pass `--protect` or `--collections` unless the user asks.
- Never edit collection files by hand. The only exception is `deck:build -- <slug> --apply`, run only when the user says they're physically building that deck, after showing them its dry run. Otherwise the user maintains them, from fresh ManaBox exports or by editing text lists. Text list lines match the card cache by set and collector number, so `collection:check` reports lines that aren't cached yet (`scryfall:refresh -- --missing`) and errors on lines whose name doesn't match their printing.
- Decks are independent until built. Don't reserve cards across decks, and don't claim several decks can be assembled at once. A built deck (one with `collection_destination`) has its cards in its own protected list, so other decks no longer count them.

## Brewing

- Before building, settle the format, the commander or theme, playgroup power level, budget, proxy policy and whether basics are unlimited. Ask only about what's missing. The collections hold very few basic lands, so ask whether the user has untracked basics (`unlimited_basics: true`) rather than letting every deck fail ownership.
- For open-ended requests, survey with `collection:search` (`--commanders`, `--count`, `--group-by`) and propose two or three directions the collection supports. Let the user choose before running `deck:new` or writing a list.
- Explain the game plan, mana base, key inclusions and weaknesses. Use `deck:stats` to back up claims about curve and color sources.
- `deck.yaml` is the only decklist. Commanders go in `commanders`, not `mainboard`.
- Build from owned cards. Suggest purchases only as `upgrades` swaps with a reason, and don't apply them without approval. A card the user approved but hasn't bought is still unowned.
- Unowned cards have no card data until they're named in the deck and `scryfall:refresh -- --missing` runs, unless the cache came from `scryfall:refresh -- --bulk`, which holds every card (`deck:check` reports `not in card cache` otherwise). Ask before any refresh, since it uses the network, then price with `deck:upgrades`.
- Give mainboard entries a `role` from: `land`, `ramp`, `draw`, `removal`, `wipe`, `protection`, `wincon`, `synergy`.
- Never invent card text, legality, ownership, prices or test results. Use the cache via the CLI. If data is missing or stale, say so.
- Record playtest notes and small changes in `playtests`. A few games don't make statistics.

## Commands

- Run `mise run deck:check -- <slug>` after every deck edit, and read every ERROR and INCOMPLETE line. Exit code 2 is not a pass. Then run `mise run deck:files -- <slug>` so the committed decklist files match `deck.yaml`.
- Project defaults such as the export format live in `.env` (copied from `.env.example`). Don't pass `--format` unless the user asks for a different one.
- `scryfall:refresh` is the only command that uses the network. Run it when cards are missing (`-- --missing`) or prices are stale. `-- --bulk` downloads all of Scryfall's card data (about 105 MB), so run it only when the user asks. A plain refresh drops the bulk data; prefer `--missing` once it's there. Never run two at once.
- For code changes, run the relevant test file, then `mise run check`. Tests must stay offline and use only fixtures from `tests/fixtures.mjs`, never the real collection. Other people's unfinished decks may make the all-decks `decks:check` fail; say so rather than editing them.
- Run `mise run fix` before finishing a code change; `check` fails on lint errors or unformatted files. Don't silence a lint rule without a comment saying why.
- Use the existing CSV, YAML and schema libraries. Pin new dependencies through npm.

## Git

Don't commit, branch, push or buy anything without explicit permission. Keep `.cache/`, `node_modules/` and `mise.local.toml` out of Git. ManaBox collection CSVs contain purchase prices; don't publish them without permission.
