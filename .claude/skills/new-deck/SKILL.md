---
name: new-deck
description: Step-by-step workflow for brewing a new Commander or casual-60 deck from the user's collection in this repo, from the opening questions through commander directions, the decklist, checks, upgrades and export. Use when the user wants to build, brew or start a new deck, or asks which decks their collection supports.
---

# Brewing a new deck

The rules in AGENTS.md still apply: only unprotected collections supply cards, protected copies are only mentioned, never invent card data. This skill is the order of work. Every command here is read-only and offline except `deck:new` (writes one file) and `scryfall:refresh` (network). `mise run <task> -- --help` documents every option.

## 1. Settle the brief

Ask only about what the user hasn't already said. Don't fill gaps with defaults.

- **Format:** Commander, Custom Dollar Brawl (`custom-dollar-brawl`, a house format: exactly 60 cards, Commander-legal cards, none over $1) or casual-60.
- **Commander or theme:** or "open to anything from my collection".
- **Power level:** a Commander Bracket (1–5) or the playgroup's own terms. The bracket table is in the `deckbuilding-strategy` skill.
- **Budget:** amount and currency for optional upgrades, and any per-card price cap (set `max_card_price` so `deck:check` enforces it).
- **Proxies:** allowed or not.
- **Collections:** whose cards to build from, if not every unprotected collection (e.g. a friend's deck from `collections/brad/*`). Record the patterns in the deck's `collection_source` field so every command reads the right cards without flags.
- **Basic lands:** run `mise run collection:search -- --type basic --count`. The collections usually hold very few basics, so every deck fails ownership unless the user has untracked basics. Ask, and set `unlimited_basics: true` if they do.

## 2. Survey the collection

Start with counts and groups, and list cards only once a query is narrow. Unfiltered lists run to hundreds of lines.

```sh
# Commander candidates per exact identity, then names within one identity, then rules text for a few.
# --group-by identity counts exact identities (WR means only red-white cards). --identity and --commander
# include every subset (WR also matches mono-W, mono-R and colorless), which is what a deck can play.
mise run collection:search -- --commanders --legal commander --group-by identity
mise run collection:search -- --commanders --legal commander --identity WR
mise run collection:search -- --name '^(Thorin, King|Glóin the Mighty)' --oracle   # names are regexes; // joins two-faced names

# Depth behind a candidate: every card it can play, its tribes, and the card types the deck needs.
# To compare candidates, run the --count line once per commander.
mise run collection:search -- --commander "Thorin, King of Durin's Folk" --nonland --count
mise run collection:search -- --commander "Thorin, King of Durin's Folk" --group-by creature-type
```

Recipes per role. They're rough: read the list before quoting a count. Draw overcounts (it also matches cards that make an opponent or each player draw), and removal includes counterspells, which matters mostly in blue:

```sh
C="Thorin, King of Durin's Folk"
mise run collection:search -- --commander "$C" --nonland --text 'add \{|search your library for .*land|create .*treasure'  # ramp
mise run collection:search -- --commander "$C" --nonland --text 'draw (a|two|three|four|x|that many) cards?'                 # draw
mise run collection:search -- --commander "$C" --nonland --text 'destroy target|exile target|counter target|deals? (\d+|x) damage to (any target|target creature)'  # removal
mise run collection:search -- --commander "$C" --nonland --text '(destroy|exile) all|deals? (\d+|x) damage to each (creature|other creature)'  # wipe
```

Add `--count` to any of these for a quick depth check. Add `--sort edhrec` or `--sort price` to see the most played or most valuable matches first, with both numbers on each line.

Engine searches. Once a direction is chosen, search for whatever the deck's engine uses up and produces, not just its theme words (see "Map the engine" in `deckbuilding-strategy`). These catch cards whose value is one step removed:

```sh
mise run collection:search -- --commander "$C" --nonland --text 'create .*(treasure|food|clue|blood|map)'                 # artifact tokens, which token doublers and "whenever you create a token" cards also count
mise run collection:search -- --commander "$C" --nonland --text 'whenever an opponent|each opponent|each player|target players?' --oracle  # triggers off other players; symmetrical effects you may aim at yourself
mise run collection:search -- --commander "$C" --nonland --text 'for each (food|treasure|artifact|token|creature)'         # payoffs that count a resource
```

Check staples that may exist only in protected collections, so you can name them as protected alternatives:

```sh
mise run collection:search -- --include-protected --name '^(Sol Ring|Arcane Signet|Command Tower|Swords to Plowshares|Path to Exile|Cultivate|Beast Within|Counterspell)$'
```

Writing a throwaway script over `--json` output is acceptable for one-off analysis in the scratchpad. If you need the same analysis twice, suggest a CLI option instead. Don't choose the mainboard from one read of the whole pool, though: a 500-line dump can't be held in mind, and cards whose value is indirect get lost. Use the searches above to build a shortlist (step 4).

## 3. Propose two or three directions, then stop

For each direction give:

- **Commander and plan:** the commander, the game plan in two sentences, and how it wins.
- **Key owned cards:** the cards that make it work, with counts from the survey (e.g. "25 Dwarves, 36 ramp pieces").
- **Mana:** colors, how many sources it needs, and the ramp available.
- **Gaps:** weak roles, and protected copies that would help.
- **Upgrades:** the rough upgrade need against the budget.

Then **wait for the user to choose.** Don't run `deck:new` or write a list before they pick.

## 4. Build the baseline

```sh
mise run deck:new -- <slug> --commander "Name"     # repeat --commander for partners; add --format custom-dollar-brawl for Custom Dollar Brawl
```

- **Header fields:** fill `primer` (the game plan, one line of YAML with no manual line breaks), `collection_source` (if the brief limits them), `power_notes`, `bracket`, `budget`, `allow_proxies` and `unlimited_basics` in the new `deck.yaml` (pass a nested slug such as `brad/<slug>` to `deck:new` to group decks by owner).
- **Engine map first:** before choosing cards, write down in the scratchpad what the commander and the key engine cards use up and produce (life-gain events, Food, Treasure, any token, counters, spells cast, cards drawn), and which owned cards convert one into another. Run an engine search (step 2) for each resource, both its makers and its payoffs.
- **Shortlist, then choose:** write a candidate file in the scratchpad with one line per plausible card, grouped by role and engine resource, each with a one-line reason. Read every match's full rules text, including activated abilities. Then choose the mainboard from the shortlist, never straight from memory of the pool.
- **Mainboard:** owned cards only. Give each entry a `role` from the vocabulary below.
- **Considered:** record the strongest cards you left out in `considered` (`name` and `reason`), especially close calls and anything with a high EDHREC rank or price. Step 5 checks this list.
- **Size:** reach exactly 100 cards including commanders (exactly 60 for `custom-dollar-brawl`), or at least 60 for casual.

Role vocabulary (comma-separate several): `land`, `ramp`, `draw`, `removal`, `wipe`, `protection`, `wincon`, `synergy`. `deck:stats` counts them, and the Archidekt export turns them into categories.

Use the `deckbuilding-strategy` skill for the plan, role counts, land count and bracket fit. It has the Command Zone template, 8x8, Karsten's land math and the Rule of 9 for casual-60.

## 5. Check and critique

```sh
mise run deck:check -- <slug>    # fix every ERROR; explain every INCOMPLETE. Exit 2 is not a pass.
mise run deck:stats -- <slug>    # curve, roles, color sources and Karsten's suggested land count
mise run deck:candidates -- <slug>    # the most played and most valuable owned cards the deck leaves out
```

Read the top 20 of `deck:candidates` with `--oracle`. Every card on it needs a place in the deck or a `considered` reason, and the summary line counts those without one. Its ranking only flags cards for a second look: a high EDHREC rank or price says the card is popular or scarce, not that it fits this deck. Rerun it with `--text` for each engine resource (e.g. `--text treasure`). If every rank shows `?`, the cache predates EDHREC ranks; ask before refreshing.

Then review it with the checklist in `deckbuilding-strategy`, and explain the deck to the user: the game plan, the mana base, key inclusions, hard cuts and known weaknesses. Point to the stats when you talk about curve or color sources.

## 6. Upgrades (optional)

1. Add paired swaps under `upgrades` (`add`, `cut`, `reason`). Never edit the baseline to apply them.
2. Unowned cards have no card data yet. **Ask before** running `mise run scryfall:refresh -- --missing`, since it uses the network.
3. Run `mise run deck:upgrades -- <slug>` and report the total against the budget. Unknown prices stay unknown, never zero.
4. Run `mise run deck:check -- <slug>`, then `mise run deck:files -- <slug>` right away, so `decklist-upgraded.archidekt.txt` and `decklist-upgraded.moxfield.txt` exist with every swap made (the added cards in their own Upgrade category in Archidekt, and only in the Sideboard section in Moxfield, not in Deck). Do this whenever upgrades are added or changed, not only at hand-off.

## 7. Hand off

- **Summary:** what's in the deck, what failed or is still unknown, and the upgrade total.
- **Decklist files:** run `mise run deck:files -- <slug>` after the final `deck:check`. It writes `decklist.archidekt.txt` and `decklist.moxfield.txt` and, when the deck has upgrades, `decklist-upgraded.archidekt.txt` and `decklist-upgraded.moxfield.txt` beside `deck.yaml`. Rerun it after every later deck edit so the files never go stale.
- **Viewing online:** if the user wants to paste the deck into a site, run `mise run deck:export -- <slug> --copy` (add `--upgrades apply` for a playtest list) and tell them where to paste it.
- **Git:** don't commit unless asked.

## 8. Physically build it (only when asked)

When the user says they're physically assembling the deck, run `mise run deck:build -- <slug>` and show them what it would take from which collection file. Only after they confirm, run it again with `--apply`. That takes the cards out of the source collections (lowering or removing their rows), writes the deck's own list (default `collections/<owner>/decks/<deck name>.txt`) and sets `collection_destination` in `deck.yaml`. Then run `deck:check` and `deck:files`, and mention that other decks now count those cards as protected, so `decks:check` may newly fail for decks sharing them. If the source is a ManaBox export, remind the user to move the same cards into a deck binder in ManaBox (or out of the app) before their next export, or the cards will be counted twice.
