---
name: deck-review
description: Review, tune or finish a deck in this repo by looping through its checks, reading its cards, covering every strong left-out card and comparing roles and mana with the frameworks until deck:verify passes. Use when the user asks to review, critique, tune, cut or finish a deck, after new-deck builds a baseline, or when swapping cards in a draft.
---

# Reviewing a deck

The rules in AGENTS.md apply. The frameworks behind each judgment are in `deckbuilding-strategy`; this skill is how to apply them with the tools. Base claims on command output and cached card text, never memory, and say when data is missing.

## The loop

Repeat until `deck:verify` exits 0 and every NOTE it prints is explained:

1. **Verify:**

   ```sh
   mise run deck:verify -- <slug>     # deck:check, primer, stats, top-20 left-out cards, upgrades, decklist files
   ```

   Fix every ERROR. Resolve or explain every INCOMPLETE; exit code 2 is not a pass. A NOTE (lands more than one from Karsten's suggestion, a role outside its target) needs a reason, recorded in `power_notes` and given to the user, not necessarily a fix.

2. **Read the list itself:**

   ```sh
   mise run deck:show -- <slug> --oracle           # every card by role, with rules text
   mise run deck:show -- <slug> --role removal --oracle
   ```

   Check that each card does the job its `role` claims, and that every ability and target works the way the plan assumes. `mise run card:show -- "Card Name"` reads any single card, owned or not, with the decks that use it.

3. **Measure:**

   ```sh
   mise run deck:stats -- <slug>      # curve, color pips against land sources, role targets, opening-hand odds
   ```

4. **Cover the left-out cards:**

   ```sh
   mise run deck:candidates -- <slug> --oracle                  # the top 20 by EDHREC rank, then price
   mise run deck:candidates -- <slug> --role removal --oracle   # once for each weak role
   mise run deck:candidates -- <slug> --text treasure --oracle  # once for each engine resource in notes
   mise run deck:candidates -- <slug> --lands --type land       # the lands left out
   ```

   Every listed card gets a place in the deck or a `considered` reason; the summary line counts the shown ones without a reason. Rank and price only flag a card for a second look. They say it's popular or scarce, not that it fits. A strong left-out card means a weak inclusion should go. If every rank shows `?`, the cache predates EDHREC ranks; ask before refreshing.

5. **Run the checklist** in `deckbuilding-strategy` §6: plan, bracket, roles, mana, win conditions, resilience, cuts. Judge `plays_like_bracket` whenever it's missing or the list changed (`deck:files` removes it then), record it after `target_bracket`, and put the reasons in `power_notes`. For the bracket, read the list and the upgrade adds for two-card combos and chained extra turns, which no tool detects. `deck:check` compares the bracket the cards set (Game Changers, extra turns, mass land denial) with `target_bracket`, and covers color identity, legality and copy limits, upgrades included.

6. **Make the changes** (next section), then go back to step 1.

## Making changes

- **Draft decks:** edit `deck.yaml`, or swap with a recorded reason:

  ```sh
  mise run deck:swap -- <slug> --out "Old Card" --in "New Card" --reason "Why Old Card left."           # dry run
  mise run deck:swap -- <slug> --out "Old Card" --in "New Card" --reason "Why Old Card left." --apply
  ```

  `--reason` becomes the out card's `considered` reason and the notes of a new `history` entry. The in card leaves `considered`. Without `--reason`, the out card turns up in `deck:candidates` with no reason.

- **Built decks** (with `collection_destination`): swap only when the user says they've swapped the physical cards. See `physical-deck`.
- **Records:** reviews and swaps go in `history` (date, changes, notes); actual games go in `playtests`. A few games don't make statistics.
- **After every edit:** run `mise run deck:check -- <slug>`, then `mise run deck:files -- <slug>`.

## Reporting

Tell the user what changed and why, what `deck:verify` still notes and the reasons, the weakest role, and what no tool could check. Point to `deck:stats` when talking about curve or color sources.
