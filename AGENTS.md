# Agent Instructions

Read [README.md](README.md) first, and the deck's `deck.yaml` (under `builds/`, possibly nested, e.g. `builds/brad/<slug>/`) when working on an existing deck. Skills in [.claude/skills/](.claude/skills/) hold the workflows:

- **[new-deck](.claude/skills/new-deck/SKILL.md):** brewing a deck, or continuing a draft.
- **[collection-survey](.claude/skills/collection-survey/SKILL.md):** which decks the collection supports.
- **[commander-scout](.claude/skills/commander-scout/SKILL.md):** which commanders, owned or not, the collection feeds.
- **[deck-review](.claude/skills/deck-review/SKILL.md):** reviewing, tuning or finishing a deck.
- **[deck-upgrades](.claude/skills/deck-upgrades/SKILL.md):** suggesting and pricing purchases.
- **[physical-deck](.claude/skills/physical-deck/SKILL.md):** building, swapping or tearing down a deck's physical cards.
- **[deckbuilding-strategy](.claude/skills/deckbuilding-strategy/SKILL.md):** the frameworks for plans, role counts, land counts and brackets.

Every command documents its options with `mise run <task> -- --help`. Ask before adding infrastructure such as a database, server or frontend.

## Collection

- Every `.csv` (ManaBox export) or `.txt` (Moxfield, Archidekt or Arena list) under `collections/`, at any depth, supplies cards except protected collections (`MTG_PROTECTED_COLLECTIONS` in `.env`, path globs, default `collections/**/precons,collections/**/decks`). Mention useful protected copies, but never put them in a deck. `MTG_COLLECTIONS` (path globs such as `collections/conrad*`) can limit which collections are read at all. A deck's own `collection_source` field in `deck.yaml` overrides `MTG_COLLECTIONS` for that deck, and a built deck's `collection_destination` list is always available to that deck alone. Don't pass `--protect` or `--collections` unless the user asks.
- Never edit collection files by hand. The only exceptions are `deck:build -- <slug> --apply`, run only when the user says they're physically building that deck, `deck:teardown -- <slug> --to PATH --apply`, run only when they say they've taken a built deck apart, and `deck:swap -- <slug> --out NAME --in NAME --reason TEXT --to PATH --apply` on a built deck, run only when they say they've swapped those physical cards, each after showing them its dry run. Otherwise the user maintains them, from fresh ManaBox exports or by editing text lists. Text list lines match the card cache by set and collector number, so `collection:check` reports lines that aren't cached yet (`scryfall:refresh -- --missing`) and errors on lines whose name doesn't match their printing.
- Decks are independent until built. Don't reserve cards across decks, and don't claim several decks can be assembled at once. A built deck (one with `collection_destination`) has its cards in its own protected list, so other decks no longer count them.

## Brewing

- Before building, settle the format, the commander or theme, playgroup power level, budget, proxy policy and whether basics are unlimited. Ask only about what's missing; `MTG_UNLIMITED_BASICS` and `MTG_ALLOW_PROXIES` in `.env` answer the last two when set. The collections hold very few basic lands, so without that default ask whether the user has untracked basics (`unlimited_basics: true`) rather than letting every deck fail ownership.
- For open-ended requests, survey with `collection:search` (`--commanders`, `--count`, `--group-by`) and propose two or three directions the collection supports. If the user would buy a commander, rank them with `collection:commanders`. Let the user choose before running `deck:new` or writing a list.
- Explain the game plan, mana base, key inclusions and weaknesses. Use `deck:stats` to back up claims about curve and color sources.
- Choose cards from a shortlist built by searching for each role and each resource the deck's engine uses up and produces, never from one read of the whole pool. Give every card `deck:candidates` lists a place in the deck or a `considered` reason. EDHREC rank and price only flag cards for a second look.
- A deck is ready to hand off when `deck:verify` exits 0 and every NOTE it prints is explained.
- `deck.yaml` is the only decklist. Commanders go in `commanders`, not `mainboard`.
- Set `target_bracket` when creating a deck and change it only when the user asks. `lowest_legal_bracket` is written by `deck:files` from the cards; never edit it by hand. Judge `plays_like_bracket` yourself from the whole list whenever it's missing (`deck:files` removes it when the cards change), with the reasons in `power_notes`; don't ask the user to.
- Build from owned cards. Suggest purchases only as `upgrades` swaps with a reason, and don't apply them without approval. A card the user approved but hasn't bought is still unowned.
- Unowned cards have no card data until they're named in the deck and `scryfall:refresh -- --missing` runs, unless the cache came from `scryfall:refresh -- --bulk`, which holds every card (`deck:check` reports `not in card cache` otherwise). Ask before any refresh, since it uses the network, then price with `deck:upgrades`.
- Give mainboard entries a `role` from: `land`, `ramp`, `draw`, `removal`, `wipe`, `protection`, `wincon`, `synergy`.
- Never invent card text, legality, ownership, prices or test results. Use the cache via the CLI: `card:show NAME` reads any card, owned or not. If data is missing or stale, say so; `collection:check`'s first line gives the cache's age.
- After the user drops in a new collection export, run `collection:diff` to see what changed and which decks name those cards.
- Record games in `playtests` and list reviews or swaps in `history` (`deck:swap --reason` adds both a `considered` reason and a `history` entry). A few games don't make statistics.

## Commands

- Run `mise run deck:check -- <slug>` after every deck edit, and read every ERROR and INCOMPLETE line. Exit code 2 is not a pass. Then run `mise run deck:files -- <slug>` so the committed decklist files match `deck.yaml`.
- Read commands print text by default. Add `--json` (or set `MTG_OUTPUT=json`) when a script will consume the output: one line of `{ command, deck, outcome, data, warnings }`.
- Project defaults such as the export format live in `.env` (copied from `.env.example`). Don't pass `--format` unless the user asks for a different one.
- `scryfall:refresh` and `edhrec:refresh` are the only commands that use the network. Run `scryfall:refresh` when cards are missing (`-- --missing`) or prices are stale (a plain refresh, which keeps bulk data). `-- --bulk` downloads all of Scryfall's card data (about 105 MB), and `--prune` drops it, so run either only when the user asks. A second refresh stops while one is running. `edhrec:refresh` fetches EDHREC commander pages (one request a second) for `collection:commanders`; ask before running it, and keep `--top` to a shortlist.
- For code changes, run the relevant test file, then `mise run check`, which checks built decks only. Tests must stay offline and use only fixtures from `tests/fixtures.mjs`, never the real collection. Other people's unfinished decks may make the all-decks `decks:check` fail; say so rather than editing them.
- Run `mise run fix` before finishing a code change; `check` fails on lint errors or unformatted files. Don't silence a lint rule without a comment saying why.
- Use the existing CSV, YAML and schema libraries. Pin new dependencies through npm.

## Git

Don't commit, branch, push or buy anything without explicit permission. Keep `.cache/`, `node_modules/` and `mise.local.toml` out of Git. ManaBox collection CSVs contain purchase prices; don't publish them without permission.
