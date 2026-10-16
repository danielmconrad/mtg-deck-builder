# Agent Instructions

Read [README.md](README.md) and the target `decks/<slug>/deck.yaml` first. Ask before adding infrastructure such as a database, server or frontend.

## Collection

- Only `collections/Organized.csv` supplies cards. Mention useful `Precons.csv` copies, but never put them in a deck.
- Never edit the CSV exports. Collection changes come from fresh ManaBox exports.
- Decks are independent. Don't reserve cards across decks, and don't claim several decks can be assembled at once.

## Brewing

- Before building, settle the format, the commander or theme, playgroup power level, budget, proxy policy and whether basics are unlimited. Ask only about what's missing.
- For open-ended requests, use `collection:search` to propose two or three directions the collection supports, then let the user choose before writing a full list.
- Explain the game plan, mana base, key inclusions and weaknesses. Use `deck:stats` to back up claims about curve and color sources.
- `deck.yaml` is the only decklist. Commanders go in `commanders`, not `mainboard`.
- Build from owned cards. Suggest purchases only as `upgrades` swaps with a reason, and don't apply them without approval. A card the user approved but hasn't bought is still unowned.
- Never invent card text, legality, ownership, prices or test results. Use the cache via the CLI. If data is missing or stale, say so.
- Record playtest notes and small changes in `playtests`. A few games don't make statistics.

## Commands

- Run `mise run deck:check -- <slug>` after every deck edit, and read every ERROR and INCOMPLETE line. Exit code 2 is not a pass.
- `cards:refresh` is the only command that uses the network. Run it when cards are missing (`-- --missing`) or prices are stale. Never run two at once.
- For code changes, run the relevant test file, then `mise run check`. Tests must stay offline and use only fixtures from `tests/fixtures.mjs`, never the real collection. Unfinished decks may fail `decks:check`; say so rather than editing them.
- Run `mise run fix` before finishing a code change; `check` fails on lint errors or unformatted files. Don't silence a lint rule without a comment saying why.
- Use the existing CSV, YAML and schema libraries. Pin new dependencies through npm.

## Git

Don't commit, branch, push or buy anything without explicit permission. Keep `.cache/`, `node_modules/` and `mise.local.toml` out of Git. The collection CSVs contain purchase prices; don't publish them without permission.
