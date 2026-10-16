---
name: new-deck
description: Step-by-step workflow for brewing a new Commander or casual-60 deck from the user's collection in this repo, from the opening questions through commander directions, the decklist, checks, upgrades and export. Use when the user wants to build, brew or start a new deck, or asks which decks their collection supports.
---

# Brewing a new deck

The rules in AGENTS.md still apply: Organized only, Precons protected, never invent card data. This skill is the order of work. Every command here is read-only and offline except `deck:new` (writes one file) and `cards:refresh` (network). `mise run <task> -- --help` documents every option.

## 1. Settle the brief

Ask only about what the user hasn't already said. Don't fill gaps with defaults.

- **Format:** Commander or casual-60.
- **Commander or theme:** or "open to anything from my collection".
- **Power level:** what the playgroup expects (casual, mid, high).
- **Budget:** amount and currency for optional upgrades.
- **Proxies:** allowed or not.
- **Basic lands:** run `mise run collection:search -- --type basic --count`. Organized usually holds very few basics, so every deck fails ownership unless the user has untracked basics. Ask, and set `unlimited_basics: true` if they do.

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

Add `--count` to any of these for a quick depth check.

Check staples that may exist only in Precons, so you can name them as protected alternatives:

```sh
mise run collection:search -- --precons --name '^(Sol Ring|Arcane Signet|Command Tower|Swords to Plowshares|Path to Exile|Cultivate|Beast Within|Counterspell)$'
```

Writing a throwaway script over `--json` output is acceptable for one-off analysis in the scratchpad. If you need the same analysis twice, suggest a CLI option instead.

## 3. Propose two or three directions, then stop

For each direction give:

- **Commander and plan:** the commander, the game plan in two sentences, and how it wins.
- **Key owned cards:** the cards that make it work, with counts from the survey (e.g. "25 Dwarves, 36 ramp pieces").
- **Mana:** colors, how many sources it needs, and the ramp available.
- **Gaps:** weak roles, and protected Precons copies that would help.
- **Upgrades:** the rough upgrade need against the budget.

Then **wait for the user to choose.** Don't run `deck:new` or write a list before they pick.

## 4. Build the baseline

```sh
mise run deck:new -- <slug> --commander "Name"     # repeat --commander for partners
```

- **Header fields:** fill `strategy`, `power_notes`, `budget`, `allow_proxies` and `unlimited_basics` in `decks/<slug>/deck.yaml`.
- **Mainboard:** owned cards only. Give each entry a `role` from the vocabulary below.
- **Size:** reach exactly 100 cards including commanders, or at least 60 for casual.

Role vocabulary (comma-separate several): `land`, `ramp`, `draw`, `removal`, `wipe`, `protection`, `wincon`, `synergy`. `deck:stats` counts them, and the Archidekt export turns them into categories.

Starting targets for Commander. These are community rules of thumb, not rules; adjust for the commander and the curve:

| Role       | Count | Note                                          |
| ---------- | ----- | --------------------------------------------- |
| land       | 35–38 | fewer with heavy ramp or a low curve          |
| ramp       | 8–12  | mostly 2–3 mana value                         |
| draw       | 8–12  | repeatable sources count most                 |
| removal    | 6–10  | include answers to artifacts and enchantments |
| wipe       | 2–4   | fewer in go-wide creature decks               |
| protection | 2–5   | for commander-dependent decks                 |

For casual-60, aim for 22–26 lands and four copies of key cards.

## 5. Check and critique

```sh
mise run deck:check -- <slug>    # fix every ERROR; explain every INCOMPLETE. Exit 2 is not a pass.
mise run deck:stats -- <slug>    # compare curve, color sources and roles against the targets
```

Then explain the deck to the user: the game plan, the mana base, key inclusions, hard cuts and known weaknesses. Point to the stats when you talk about curve or color sources.

## 6. Upgrades (optional)

1. Add paired swaps under `upgrades` (`add`, `cut`, `reason`). Never edit the baseline to apply them.
2. Unowned cards have no card data yet. **Ask before** running `mise run cards:refresh -- --missing`, since it uses the network.
3. Run `mise run deck:upgrades -- <slug>` and report the total against the budget. Unknown prices stay unknown, never zero.

## 7. Hand off

- **Summary:** what's in the deck, what failed or is still unknown, and the upgrade total.
- **Viewing online:** if the user wants to see the deck on a site, run `mise run deck:export -- <slug> --format moxfield --copy` (or `archidekt`) and tell them where to paste it.
- **Git:** don't commit unless asked.
