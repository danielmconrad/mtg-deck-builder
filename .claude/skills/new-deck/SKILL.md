---
name: new-deck
description: Step-by-step workflow for brewing a new Commander, Custom Dollar Brawl or casual-60 deck from the user's collection in this repo, from the brief through the plan, the decklist and the hand-off, or for picking up a draft where it was left. Use when the user wants to build, brew or start a new deck, or to continue a draft. To only see which decks the collection supports, use collection-survey.
---

# Brewing a new deck

The rules in AGENTS.md still apply: only unprotected collections supply cards, protected copies are only mentioned, and card data comes from the cache, never memory. This skill is the order of work. It hands parts of the job to other skills:

- **collection-survey:** step 2, finding the directions the collection supports.
- **deckbuilding-strategy:** the frameworks behind the plan, role counts, land count and bracket.
- **deck-review:** step 6, the check-and-fix loop.
- **deck-upgrades:** step 8, purchases.
- **physical-deck:** only when the user says they're physically building it.

`mise run <task> -- --help` documents every option. Every command is offline and read-only except `deck:new` and `deck:files` (they write deck files), `deck:swap --apply` (edits `deck.yaml`) and `scryfall:refresh` (network). Add `--json` to a read command when a script will consume its output; text is shorter to read.

## 0. Preflight

- **Defaults:** read `.env` and memory for the user's standing answers. `MTG_UNLIMITED_BASICS` and `MTG_ALLOW_PROXIES` fill `deck:new`'s ownership policies, `MTG_COLLECTIONS` and `MTG_PROTECTED_COLLECTIONS` decide which cards count, and `MTG_BUILD_DESTINATION` is where a built deck goes.
- **Existing decks:** `grep -rh -A1 '^commanders:' builds --include=deck.yaml | grep name` lists the commanders already used. Don't propose one that already has a deck unless the user wants a second build.
- **Card data:** `deck:check` notes data older than 30 days. `collection:search --unowned` (for upgrades) needs a bulk cache, and warns without one.
- **Continuing a draft:** read its `deck.yaml` (`primer`, the engine map in `notes`, `considered`, `history`), run `mise run deck:verify -- <slug>`, and resume at the step its state implies.

## 1. Settle the brief

Ask only about what the user hasn't said. A default from `.env` or memory counts as an answer: state it in one line instead of asking.

- **Format:** Commander, Custom Dollar Brawl (`custom-dollar-brawl`, a house format: exactly 60 cards, Commander-legal, none over $1) or casual-60.
- **Commander or theme:** or "open to anything from my collection".
- **Power level:** a Commander Bracket (1–5) or the playgroup's own terms; the table is in `deckbuilding-strategy`. It becomes `target_bracket`, which changes only when the user asks.
- **Table:** a four-player pod or 1v1. It changes what "whenever an opponent" triggers, symmetrical effects and wipes are worth.
- **Play style:** what the deck should feel like to play, and what to avoid (combos, stax, extra turns, long turns).
- **Must-includes and no-gos:** pet cards to build around, and cards or strategies the playgroup dislikes.
- **Budget:** amount and currency for optional upgrades, and any per-card price cap (`max_card_price`, which `deck:check` enforces).
- **Proxies:** allowed or not.
- **Collections:** whose cards to build from, if not every unprotected collection (e.g. a friend's deck from `collections/brad/*`), recorded in `collection_source`.
- **Basics:** if `MTG_UNLIMITED_BASICS` isn't set, run `mise run collection:search -- --type basic --count`. The collections hold few basics, so ask whether the user has untracked ones.

## 2. Survey, propose directions, then stop

Follow the `collection-survey` skill: it sizes each candidate by role and engine depth and proposes two or three directions. Then **wait for the user to choose.** Don't run `deck:new` or write a list before they pick.

## 3. Plan before choosing cards

```sh
mise run deck:new -- <slug> --commander "Name" --target-bracket 3 --budget 30 --primer "How it wins, in a sentence or two."
#   repeat --commander for partners; --format custom-dollar-brawl or casual-60; --max-card-price 1;
#   --collection-source 'collections/brad/*'; a nested slug such as brad/<slug> groups decks by owner
```

- **`primer`:** how the deck wins, in one or two sentences, on one line of YAML (`deckbuilding-strategy` §1).
- **Engine map in `notes`:** what the commander and key engine cards use up and produce (life-gain events, Food, Treasure, any token, counters, spells cast, cards drawn), and which owned cards turn one into another (§1a). It lives in `deck.yaml` so a later session sees why the list looks the way it does.
- **`role_targets`:** Commander decks are compared with the Command Zone template by default. Set `role_targets` when the plan departs from it (say, two wipes in a go-wide deck), and always for Custom Dollar Brawl and casual-60 (§3 and §5).
- **`power_notes`:** the bracket's limits that no tool checks (two-card combos, chained extra turns), and how the deck stays inside them. `lowest_legal_bracket` is written by `deck:files`; never edit it by hand.

## 4. Build a shortlist

Choose from a shortlist, never from one read of the whole pool: a 500-line dump can't be held in mind, and cards whose value is one step removed get lost.

- **Search each role and each engine resource, both makers and payoffs:**

  ```sh
  C="Commander Name"
  mise run collection:search -- --commander "$C" --nonland --role ramp --oracle      # also draw, removal, wipe, protection
  mise run collection:search -- --commander "$C" --nonland --text 'create .*(treasure|food|clue)' --oracle
  mise run collection:search -- --commander "$C" --nonland --text 'whenever an opponent|each player|target players?' --oracle
  ```

  `--role` is a rough rules-text test (draw also matches cards that make an opponent draw, removal includes counterspells). Read the cards before counting them. For Custom Dollar Brawl add `--max-price 1`; for casual-60 use `--identity` with `--min-copies 4` for playsets.

- **Read every match's full rules text**, including activated abilities and who each effect targets. A symmetrical effect aimed at yourself is often an engine.
- **Write the shortlist** to a scratchpad file: one line per card, grouped by role and engine resource, each with a one-line reason. For set operations across searches (cards that feed two resources, say), use `--json` and a throwaway script in the scratchpad.

## 5. Assemble the deck

In this order:

1. **Nonland cards to the role targets**, from the shortlist: the plan's enablers and payoffs first, then the role cards. Give each entry a `role` (`land`, `ramp`, `draw`, `removal`, `wipe`, `protection`, `wincon`, `synergy`; comma-separate several).
2. **Check the shape:** `mise run deck:stats -- <slug>` for the curve, role counts against targets, and color pips.
3. **Mana base:** take the land count from Karsten's suggestion in `deck:stats`, and explain any gap of more than a land in `power_notes`. Choose utility and dual lands with `collection:search -- --commander "$C" --type land --oracle`. Count the lands that enter tapped, give each color sources in proportion to its pips, then fill with basics.
4. **Size:** exactly 100 cards including commanders (60 for `custom-dollar-brawl`), or at least 60 for casual.
5. **`considered`:** record the close calls with a one-line reason as you go.

`deck.yaml` is the only decklist, and commanders go in `commanders`, not `mainboard`. Run `mise run deck:check -- <slug>` after each round of edits.

## 6. Review until it passes

Follow the `deck-review` skill: check, read the list, cover the left-out cards, compare with the frameworks, fix, and repeat until `mise run deck:verify -- <slug>` exits 0.

## 7. Explain and hand off

Explain the deck to the user: the game plan, the mana base (point to `deck:stats`), key inclusions, hard cuts, known weaknesses, and which bracket it plays like against `target_bracket` (`deck:stats` shows all three brackets).

The deck is done when:

- **`deck:verify` exits 0.** It fails on any `deck:check` error, a placeholder primer, a top-20 left-out card without a `considered` reason, upgrades over budget, or decklist files that don't match `deck.yaml`. Explain every NOTE it prints (land gaps, role counts outside their targets).
- **`deck:files` ran after the last edit,** which `deck:verify` confirms.
- **`plays_like_bracket` is judged for the final list,** with the reasons in `power_notes`. `deck:files` removes it whenever the cards change, so judge it last (`deckbuilding-strategy` §2).
- **The summary names what's still unknown:** unknown prices, uncached cards, and checks no tool makes.

If the user wants to paste the deck into a site, run `mise run deck:export -- <slug> --copy` (add `--upgrades apply` for a playtest list) and say where to paste it. Don't commit unless asked.

## 8. Upgrades (optional)

Follow the `deck-upgrades` skill.

## 9. Physical build (only when asked)

When the user says they're sleeving it up, follow the `physical-deck` skill.
