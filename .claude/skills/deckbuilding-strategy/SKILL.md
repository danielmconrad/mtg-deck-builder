---
name: deckbuilding-strategy
description: Established Magic deckbuilding frameworks (Commander Brackets, the Command Zone template, 8x8, Karsten's land math, the Rule of 9, "Who's the Beatdown?") and what each means for this repo's decks. Use when choosing a deck's plan or power level, setting role counts or role_targets, sizing a mana base, or judging a deck under review (the deck-review skill runs the review with the tools).
---

# Deckbuilding strategy

These are the frameworks experienced players lean on, with how to check each one here. They are starting points and conversation tools, not rules. When a deck departs from them, say why. When you cite a number, name the framework it comes from. Researched October 2026; the sources are at the end.

For format names and rules (what Moxfield calls each format, deck sizes, card pools and Scryfall legality keys), see [formats.md](formats.md).

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

## 1a. Map the engine, then find every card that feeds it

Theme words find the obvious cards. The ones that get missed feed the engine one step removed, so search by resource rather than by theme.

- **List the resources:** write down what the commander and the key engine cards use up and produce: life-gain events, Food, Treasure, Clues, any token, counters, spells cast, cards drawn, creatures dying. Note every owned card that turns one into another, e.g. "each token also makes a Food" or "each Food also makes a Treasure".
- **Search each resource both ways:** find its makers and its payoffs. A card that makes a converted resource feeds the whole chain, even when its text never mentions the theme. In a Food-and-life-gain deck where Food becomes Treasure and every token brings a Food, a card that makes Treasure belongs on the shortlist.
- **Artifact tokens are tokens:** Treasure, Food, Clue, Blood and Map tokens count for token doublers, "whenever you create a token" triggers and "for each artifact" payoffs.
- **Count triggers off other players:** "whenever an opponent…" fires up to three times as often as "whenever you…" in a four-player game.
- **Read every ability, and every target:** "two target players", "target player" and "each player" can include you. A symmetrical or group-hug effect is often a one-sided engine when you aim it at yourself, or when it hits opponents only off their turn. Weigh the help it gives opponents against what you get; don't skip it on reflex.

### Price and EDHREC rank

`collection:search --sort edhrec|price` and `deck:candidates` show each card's EDHREC rank (how often Commander decks play it; 1 is the most played) and cheapest USD price.

- **Use them to flag cards for a second look, not to judge fit.** A popular or pricey card the deck leaves out needs a one-line reason, recorded in `considered`.
- **Price is a noisy signal:** cEDH demand (fast tutors and free spells), collectors, foils and scarcity all inflate it. Rank is the better signal for Commander, but it's still popularity across all decks, not fit for this one.
- **Ignore rarity:** plenty of mythics are weak, so it adds little beyond price.

## 2. Agree on power level: Commander Brackets

Wizards' Commander Brackets (beta) exist to guide the pregame conversation with a playgroup. They aren't a matchmaking law. Set `target_bracket` in `deck.yaml` when the deck is created (`deck:new --target-bracket`), and change it only when the user asks.

| Bracket      | Game Changers                             | Mass land denial | Extra turns      | Two-card combos    | Games last about |
| ------------ | ----------------------------------------- | ---------------- | ---------------- | ------------------ | ---------------- |
| 1 Exhibition | None (thematic exceptions agreed pregame) | No               | No               | No                 | 9+ turns         |
| 2 Core       | None                                      | No               | Yes, no chaining | No                 | 8+ turns         |
| 3 Upgraded   | Up to 3                                   | No               | Yes, no chaining | None before turn 6 | 6+ turns         |
| 4 Optimized  | Any                                       | Yes              | Yes              | Yes                | 4+ turns         |
| 5 cEDH       | Any                                       | Yes              | Yes              | Yes                | Any turn         |

These definitions date from October 2025. Tutors are unrestricted in every bracket.

A deck carries three brackets:

- **`target_bracket`:** the bracket agreed with the playgroup, set at creation and changed only when the user asks.
- **`lowest_legal_bracket`:** the lowest bracket the cards allow. Game Changers (Scryfall's live `game_changer` flag) raise it to 3, or 4 with more than three; cards that take extra turns to 2; mass land denial found in rules text to 4. `deck:files` and `deck:swap --apply` write it, and `deck:verify` fails when it's out of date. A deck at 1 can still play like a 3.
- **`plays_like_bracket`:** how the deck actually plays, judged from the whole list. `deck:files` removes it whenever the cards change, and `deck:verify` fails until it's judged again. Weigh speed (how many turns to the win, by the bracket table), fast mana, tutors, how consistently the engine assembles, combos and near-combos, interaction and resilience, and explain the call in `power_notes`. A deck built from a thin pool usually plays below the bracket its cards allow; one with tight synergy and cheap interaction plays above.

`deck:check` fails a deck whose cards need a higher bracket than `target_bracket`, upgrade adds included, and a `plays_like_bracket` above `target_bracket` or below `lowest_legal_bracket`. Without a target, it notes the bracket the cards set.

- **Check the other bracket rules by reading the list.** No tool detects two-card combos, chained extra turns or land denial that the rules-text tests miss.
- **See what's owned:** `mise run collection:search -- --game-changers --include-protected` shows which Game Changers the user owns.

## 3. Fill the roles: pick one template as a checklist

Give every mainboard card a `role` (`land`, `ramp`, `draw`, `removal`, `wipe`, `protection`, `wincon`, `synergy`), then compare with `mise run deck:stats -- <slug>`. A card that does two jobs, like ramp that draws, gets both roles and counts toward both.

`deck:stats` compares the counts with the deck's `role_targets` (e.g. `ramp: { min: 10, max: 12 }`), or, for a Commander deck without them, with the Command Zone template below. Set `role_targets` when the plan departs from the template, and say why in `power_notes`.

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

## 5a. 60-card Commander (Custom Dollar Brawl)

No published template covers 60-card singleton decks with a commander, so there's nothing to cite.

- **A starting point:** scale the Command Zone counts by 59/99. That gives roughly 6–7 ramp, 6 draw, 6–7 removal and 2 wipes. Say it's arithmetic, not a framework, and record the numbers in `role_targets`.
- **Lands:** `deck:stats` applies Karsten's Commander adjustment to 60 cards, which is also an extrapolation rather than one of his fits.
- **Price cap:** every search for this format needs `--max-price 1`. `deck:candidates` already leaves out cards over the deck's cap.

## 6. Reviewing or tuning a deck

Go through these in order and report what you find. The `deck-review` skill runs them with the tools.

1. **Plan:** can the deck's plan be said in one sentence, and do the cards support it?
2. **Bracket:** judge `plays_like_bracket` again, and check it against `target_bracket`. `deck:check` compares the bracket the cards set (Game Changers, extra turns, mass land denial), upgrades included. Read the list and the upgrade adds for two-card combos and chained extra turns.
3. **Roles:** compare role counts with the targets. Name the weakest role.
4. **Mana:** compare lands with Karsten's suggestion, look at the curve shape, and compare color sources with pips.
5. **Win conditions:** are there enough, and are they owned? Can the deck still win if the commander is removed?
6. **Resilience:** protection for key pieces, recursion, and how the deck recovers after a wipe.
7. **Left-out cards:** every strong owned card the deck leaves out needs a place or a `considered` reason (`deck:candidates`, and `deck:verify` for the top 20). A strong left-out card means a weak inclusion should go.
8. **Cuts:** remove the cards that serve no role or the weakest role first. Use `upgrades` for purchases (`deck-upgrades`).

Base claims on `deck:stats` output and card text from the cache, never on memory. A few games or goldfishing don't establish win rates.

## Sources

- **Commander Brackets:** [Wizards, February 2026 brackets update](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026); bracket rules as summarized by [scrollvault.net](https://scrollvault.net/guides/commander-brackets.html) and [commanderbrackets.com](https://commanderbrackets.com/changelog).
- **Command Zone template:** [commanderdeckmaker.com](https://commanderdeckmaker.com/learn/deckbuilding/command-zone-template). For the reported 2025 numbers, [spellweave.app](https://spellweave.app/guides/commander-deck-building).
- **8x8:** [TappedOut, 8x8Theory](https://tappedout.net/users/8x8Theory/).
- **Karsten's land formula:** "How Many Lands Do You Need in Your Deck? An Updated Analysis" (ChannelFireball), as adapted by [Canadian Highlander](https://canadianhighlander.ca/2023/07/17/how-to-build-a-manabase-for-singleton-formats/) and [FreeMully](https://freemully.com/how-many-lands).
- **"Who's the Beatdown?":** Mike Flores, discussed at [Star City Games](https://articles.starcitygames.com/articles/eight-core-principles-of-whos-the-beatdown/).
- **Rule of 9:** [casualplaneswalker.com](https://casualplaneswalker.com/tag/casual-mtg/).
