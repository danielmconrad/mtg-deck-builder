---
name: collection-survey
description: Survey the user's card collection in this repo to find which commanders and themes it supports, sizing each direction by role and engine depth before any deck exists, and propose two or three directions. Use when the user asks what decks their collection can build or wants commander ideas, and for the survey step of new-deck.
---

# Surveying the collection

The rules in AGENTS.md apply: only unprotected collections supply cards, and protected copies are only mentioned. Every command here is read-only and offline. Start with counts and groups, and list cards only once a query is narrow: unfiltered lists run to hundreds of lines.

## 1. Find commander candidates

```sh
# --group-by identity counts exact identities (WR means only red-white cards). --identity and --commander
# include every subset (WR also matches mono-W, mono-R and colorless), which is what a deck can play.
mise run collection:search -- --commanders --legal commander --group-by identity
mise run collection:search -- --commanders --legal commander --identity WR --sort edhrec
mise run collection:search -- --name '^(Thorin, King|Glóin the Mighty)' --oracle   # names are regexes; // joins two-faced names
```

Skip commanders that already lead a deck in `builds/` unless the user wants a second build: `grep -rh -A1 '^commanders:' builds --include=deck.yaml | grep name`.

## 2. Size each candidate

Run these once per candidate and compare the results in a table:

```sh
C="Thorin, King of Durin's Folk"
mise run collection:search -- --commander "$C" --nonland --count                 # depth of the playable pool
mise run collection:search -- --commander "$C" --nonland --group-by role         # ramp, draw, removal, wipe, protection, other
mise run collection:search -- --commander "$C" --group-by creature-type          # tribes
mise run collection:search -- --commander "$C" --type land --count               # nonbasic lands for the mana base
```

`--group-by role` uses the rough `--role` tests: draw also counts cards that make an opponent draw, and removal includes counterspells, which matters mostly in blue. Before quoting a role count, read the list with `--role <role> --oracle`.

For a comparison table across several commanders, add `--json` and collect `data.groups` with a throwaway script in the scratchpad. If the same analysis is needed twice, suggest a CLI option instead.

## 3. Sketch the engine

For the most promising candidates, search what the commander uses up and produces, not just its theme words (see "Map the engine" in `deckbuilding-strategy`):

```sh
mise run collection:search -- --commander "$C" --nonland --text 'create .*(treasure|food|clue|blood|map)'
mise run collection:search -- --commander "$C" --nonland --text 'whenever an opponent|each opponent|each player|target players?' --oracle
mise run collection:search -- --commander "$C" --nonland --text 'for each (food|treasure|artifact|token|creature)'
```

Add `--sort edhrec` or `--sort price` to see the most played or most valuable matches first.

## 4. Allow for the format

- **Custom Dollar Brawl:** add `--max-price 1` to every search. Cards over the cap can't be played, even ones already owned.
- **Casual-60:** there's no commander. Search by `--identity`, and use `--min-copies 4` to find cards owned as playsets for the Rule of 9.
- **Bracket:** `mise run collection:search -- --game-changers --include-protected` shows which Game Changers the user owns, and every list marks them `[Game Changer]`.

## 5. Note protected staples

Name staples that exist only in protected collections, so the user can choose to move a copy:

```sh
mise run collection:search -- --include-protected --name '^(Sol Ring|Arcane Signet|Command Tower|Swords to Plowshares|Path to Exile|Cultivate|Beast Within|Counterspell)$'
```

## 6. Propose two or three directions, then stop

For each direction give:

- **Commander and plan:** the commander, the game plan in two sentences, and how it wins.
- **Key owned cards:** the cards that make it work, with counts from the survey (e.g. "25 Dwarves, 36 ramp pieces").
- **Mana:** colors, how many sources it needs, and the lands and ramp available.
- **Gaps:** weak roles, and protected copies that would help.
- **Upgrades:** the rough upgrade need against the budget.

Then **wait for the user to choose.** Don't run `deck:new` or write a list before they pick.
