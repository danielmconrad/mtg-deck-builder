---
name: deck-upgrades
description: Suggest and price purchases for a deck in this repo as paired upgrade swaps that keep it inside its budget, bracket and color identity. Use when the user asks for upgrades, what to buy for a deck, or how to spend a budget on one.
---

# Upgrading a deck

Upgrades are suggestions. They live under `upgrades` as paired swaps and are never applied to the baseline without approval. A card the user approved but hasn't bought is still unowned.

## 1. Before suggesting anything

- **Budget:** the deck needs `budget` (amount and currency). Ask for one if it's missing.
- **Baseline:** the deck should pass `deck:verify` first (see `deck-review`), so each upgrade replaces a known weak card.

## 2. Find candidates from data, not memory

Search the whole card cache for cards with no available copy:

```sh
C="Commander Name"
mise run collection:search -- --commander "$C" --unowned --nonland --role removal --sort edhrec --max-price 5 --oracle
mise run collection:search -- --commander "$C" --unowned --text 'whenever you gain life' --sort edhrec --oracle
```

- **Bulk cache:** `--unowned` finds every card only after `scryfall:refresh -- --bulk` (about 105 MB). It warns when the cache holds only collection and deck cards. Ask before that refresh. Otherwise name candidates in `upgrades`, ask, then run `scryfall:refresh -- --missing` and read their text before keeping them.
- **Protected copies:** results note copies the user owns in protected collections ("1 in conrad/protected/precons/..."). Mention them, since moving a copy may be cheaper than buying one.
- **Never cite card text, legality or prices from memory.** Read them from the cache.

## 3. Pair each add with a cut

- **The cut:** the weakest card in the same role, or the one the add makes redundant.
- **The reason:** name both cards and what the deck gains.
- **The order:** most impact first, so buying from the top down makes sense if the budget runs short.

## 4. Keep the upgraded deck legal

- **Checks:** `deck:check` judges the upgraded list too. It fails adds that raise the bracket above `target_bracket` (Game Changers, extra turns, mass land denial), adds outside the color identity, cards not legal in the format, and second copies in a singleton deck.
- **What no tool sees:** read the adds for two-card combos (Heliod, Sun-Crowned with Walking Ballista, for instance) and chained extra turns, against `target_bracket`. `plays_like_bracket` judges the baseline, so say in `power_notes` which bracket the upgraded deck would play like, and warn or drop the add if that's above the target.

## 5. Price and record

1. **Ask before** `mise run scryfall:refresh -- --missing` if any add isn't cached; it uses the network.
2. `mise run deck:upgrades -- <slug>`: report the total against the budget. Unknown prices stay unknown, never zero.
3. `mise run deck:check -- <slug>`, then `mise run deck:files -- <slug>` right away. That writes `decklist-upgraded.archidekt.txt` and `decklist-upgraded.moxfield.txt` with every swap made, and the plain decklists carry the adds under Considering (Maybeboard in Archidekt) for buying.
4. Describe the upgraded deck from the tools: `mise run deck:stats -- <slug> --upgrades apply` and `mise run deck:show -- <slug> --upgrades apply --oracle`.

## 6. After the user buys cards

Once the bought cards are in the collection files (the user updates those), make each swap with `deck:swap -- <slug> --out CUT --in ADD --reason "..." --apply` and remove its entry from `upgrades`. `deck:swap` warns about upgrades the swap left stale. For a built deck, follow `physical-deck`.
