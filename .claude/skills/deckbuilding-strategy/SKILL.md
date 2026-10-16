---
name: deckbuilding-strategy
description: Established Magic deckbuilding frameworks (Commander Brackets, the Command Zone template, 8x8, Karsten's land math, the Rule of 9, "Who's the Beatdown?") and how to apply them with this repo's tools. Use when choosing a deck's plan or power level, setting role counts, sizing a mana base, or reviewing, tuning or cutting an existing deck.
---

# Deckbuilding strategy

These are the frameworks experienced players lean on, with how to check each one here. They are starting points and conversation tools, not rules. When a deck departs from them, say why. When you cite a number, name the framework it comes from. Researched October 2026; the sources are at the end.

## 1. Start from the plan, not the card pool

- **Say how the deck wins in one sentence** before picking cards. Record it in `primer`.
- **Split the strategy cards** using the Command Zone's 2025 framework, roughly 40% enablers, 35% payoffs and 25% enhancers, adjusted to the deck:
  - **Enablers** make the plan work, e.g. sacrifice outlets in Aristocrats.
  - **Payoffs** reward it, e.g. Blood Artist.
  - **Enhancers** improve it but aren't required, e.g. a tribal lord.
- **Know your role in each game** ("Who's the Beatdown?", Mike Flores):
  - Being the aggressor or the controller depends on the matchup and the table, not on a fixed label.
  - Decide which you are early, and play to it.
  - Combo decks still need a backup plan.

## 2. Agree on power level: Commander Brackets

Wizards' Commander Brackets (beta) exist to guide the pregame conversation with a playgroup. They aren't a matchmaking law. Set `bracket` in `deck.yaml` once the user picks one.

| Bracket      | Game Changers                             | Mass land denial | Extra turns      | Two-card combos    | Games last about |
| ------------ | ----------------------------------------- | ---------------- | ---------------- | ------------------ | ---------------- |
| 1 Exhibition | None (thematic exceptions agreed pregame) | No               | No               | No                 | 9+ turns         |
| 2 Core       | None                                      | No               | Yes, no chaining | No                 | 8+ turns         |
| 3 Upgraded   | Up to 3                                   | No               | Yes, no chaining | None before turn 6 | 6+ turns         |
| 4 Optimized  | Any                                       | Yes              | Yes              | Yes                | 4+ turns         |
| 5 cEDH       | Any                                       | Yes              | Yes              | Yes                | Any turn         |

These definitions date from October 2025. Tutors are unrestricted in every bracket.

- **`deck:check` enforces Game Changers** from Scryfall's live `game_changer` flag. With a `bracket` set it fails over the limit; without one it lists them.
- **The Game Changers list changes.** It had 53 cards after February 2026, and Wizards had an announcement due October 12, 2026. Refresh card data before relying on the count.
- **Check the other bracket rules by reading the list.** No tool detects mass land denial, extra-turn chaining or two-card combos.
- **See what's owned:** `mise run collection:search -- --game-changers --include-protected` shows which Game Changers the user owns.

## 3. Fill the roles: pick one template as a checklist

Give every mainboard card a `role` (`land`, `ramp`, `draw`, `removal`, `wipe`, `protection`, `wincon`, `synergy`), then compare with `mise run deck:stats -- <slug>`. A card that does two jobs, like ramp that draws, gets both roles and counts toward both.

**Command Zone template, updated version (episode 379)** for Commander:

| Role     | Count | Notes                                              |
| -------- | ----- | -------------------------------------------------- |
| land     | 36–38 | check against Karsten (section 4)                  |
| ramp     | 10–12 | mostly mana value 2–3                              |
| draw     | 10    | repeatable sources count most                      |
| removal  | 10–12 | targeted; include artifact and enchantment answers |
| wipe     | 3–4   | fewer in go-wide creature decks                    |
| strategy | rest  | enablers, payoffs and enhancers (section 1)        |

Secondary sources report that the 2025 update (episode 658) raised these to about 38 lands, 12 card advantage and 12 removal, citing faster modern games. I couldn't confirm that against the episode, so present it as reported.

**8x8 alternative:** 35 lands plus the commander, then 8 effects of 8 cards each. Ramp, draw and removal are usually the first three; the other five suit the deck's theme. It's useful when a theme has several distinct pieces, e.g. tokens, sacrifice outlets and recursion.

## 4. Size the mana base: Karsten's math

Frank Karsten fit land counts to tens of thousands of winning decklists. `deck:stats` prints his suggestion using:

- **Commander:** `(99/60) × (19.59 + 1.90 × avg MV + 0.27) − 0.28 × cheap − 1.35`, which works out to about `31.42 + 3.13 × avg MV − 0.28 × cheap`.
- **60-card:** `19.59 + 1.90 × avg MV − 0.28 × cheap`.

Here `avg MV` is the average mana value of nonland mainboard cards. `cheap` counts nonland cards with role `ramp` or `draw` at mana value 2 or less; some summaries use 3, which moves the result by about a land. Each cheap ramp or draw spell is worth about a quarter of a land.

- **Explain any gap of more than a land** between the deck and the suggestion. Low curves and heavy cheap ramp justify fewer lands.
- **Balance color sources:** compare `Land color sources` with `Color pips` in `deck:stats`, and give each color sources roughly in proportion to its pips.
- **Source counts for single-pip early spells:** secondary summaries of Karsten's 99-card tables suggest roughly 18–20 sources of a color, and more for double pips. Treat that as a guide, and say so when quoting it.

## 5. Casual 60-card decks: the Rule of 9

- **Skeleton:** pick 9 cards to build around and run 4 copies of each (36 spells), plus 24 lands. Then check with Karsten's 60-card formula in `deck:stats`.
- **Land count by curve:** low-curve aggressive decks often run 20–22 lands; decks full of 4–5 drops want 24 or more.
- **Copies:** fewer than 4 copies is fine for legendary cards, situational answers, or expensive finishers.

## 6. Reviewing or tuning a deck

Go through these in order and report what you find:

1. **Plan:** can the deck's plan be said in one sentence, and do the cards support it?
2. **Bracket:** does it fit the agreed bracket? Run `deck:check`, then read the list for mass land denial, extra turns and combos.
3. **Roles:** compare role counts with the chosen template. Name the weakest role.
4. **Mana:** compare lands with Karsten's suggestion, look at the curve shape, and compare color sources with pips.
5. **Win conditions:** are there enough, and are they owned? Can the deck still win if the commander is removed?
6. **Resilience:** protection for key pieces, recursion, and how the deck recovers after a wipe.
7. **Cuts:** remove the cards that serve no role or the weakest role first. Use `upgrades` for purchases.

Base claims on `deck:stats` output and card text from the cache, never on memory. A few games or goldfishing don't establish win rates.

## Sources

- **Commander Brackets:** [Wizards, February 2026 brackets update](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026); bracket rules as summarized by [scrollvault.net](https://scrollvault.net/guides/commander-brackets.html) and [commanderbrackets.com](https://commanderbrackets.com/changelog).
- **Command Zone template:** [commanderdeckmaker.com](https://commanderdeckmaker.com/learn/deckbuilding/command-zone-template). For the reported 2025 numbers, [spellweave.app](https://spellweave.app/guides/commander-deck-building).
- **8x8:** [TappedOut, 8x8Theory](https://tappedout.net/users/8x8Theory/).
- **Karsten's land formula:** "How Many Lands Do You Need in Your Deck? An Updated Analysis" (ChannelFireball), as adapted by [Canadian Highlander](https://canadianhighlander.ca/2023/07/17/how-to-build-a-manabase-for-singleton-formats/) and [FreeMully](https://freemully.com/how-many-lands).
- **"Who's the Beatdown?":** Mike Flores, discussed at [Star City Games](https://articles.starcitygames.com/articles/eight-core-principles-of-whos-the-beatdown/).
- **Rule of 9:** [casualplaneswalker.com](https://casualplaneswalker.com/tag/casual-mtg/).
