---
name: limited-prep
description: Prepare the user for a Limited event (a Prerelease, which is Sealed, or a Booster Draft night) for one set, by researching the set online, checking every card against the cache and publishing a phone-friendly cheat sheet with the format basics, mechanics, archetypes, removal, tricks to play around and a build checklist. Use when the user is going to a Prerelease, Sealed or Draft event, asks how one works, or wants a strategy or cheat sheet for a set's Limited format.
---

# Preparing for a Limited event

Limited means building a deck from cards opened at the event, not from the collection, so the collection rules in AGENTS.md don't come into play here. The rules on card data still apply: card names, text and types come from the cache via `card:show`, never memory, and everything else comes from a cited source. [limited-basics.md](limited-basics.md) has the set-independent fundamentals: how Sealed and Draft run, the 40-card template, pick orders and how to read open mana.

## 1. Settle the event

Ask only about what's missing:

- **Set:** name or code. Scryfall's set list gives the code, release date and related sets (Commander decks, tokens): `curl -sS -H 'User-Agent: mtg-deck-builder' https://api.scryfall.com/sets` into the scratchpad. Commander-deck sets (`set_type: commander`) aren't in Play Boosters, so their mechanics won't show up at the event.
- **Format:** a **Prerelease is Sealed**: each player opens a Prerelease Pack (six Play Boosters and a foil promo, though check the set) and builds from it alone. A **Draft** is a pick-and-pass pod of three boosters each. People often say "draft" for both, so confirm which one it is.
- **Experience:** a first-timer needs the event flow and the build checklist up front, while a regular wants the archetypes and card quality.
- **Store details** the user can find out (rounds, best-of-one or best-of-three, start time, entry fee, whether the store has basics). Put whatever's still unknown in a "Ask at check-in" box instead of guessing.

## 2. Refresh the cache

New sets reach Scryfall's bulk data before release. Check that the cache has the set:

```sh
mise run collection:check    # first line: cache size and age
mise run card:show -- "<a card from the set>"
```

If its cards are missing, ask before running `mise run scryfall:refresh -- --bulk` (about 105 MB). Then compare each related set's `card_count` from the set list with `mise run collection:search -- --all-cards --set CODE --count` (which counts cards, not printings, so variants make it smaller), and check that `--group-by rarity` shows no `unknown`, which means the cache predates rarity and needs a refresh.

## 3. Research the set

Use WebSearch, and the web-fetch agent for pages worth reading in full. Run independent fetches in parallel. Sources, in order of trust:

1. **Wizards:** the `<set>-prerelease-guide` (Prerelease Pack contents, archetypes, signpost uncommons, curve advice) and the `<set>-release-notes` (exact mechanic rules) on magic.wizards.com/en/news/feature/.
2. **Limited reviews:** Draftsim's set review and Sealed guide, LSV's set reviews on Channel Fireball, and Limited Resources. Before release these are opinions, so attribute every rating.
3. **17lands:** win-rate data. It appears only after the set has been on Arena for a few days, so it's usually missing for a Prerelease.

Collect:

- Every mechanic and keyword that can appear in Play Boosters, and which ones are Commander-deck only.
- The ten two-color archetypes and their signposts (the gold and hybrid uncommons that spell out each pair's plan), with what each archetype wants (for example "attack with total power 8").
- The best commons and uncommons per color, with **removal** split out, plus colorless cards that fit any deck.
- Bombs worth recognizing: rares that win the game alone or demand an answer.
- Which colors or archetypes the sources rate deep or shallow, and anything they say about format speed or land counts.
- Combat tricks, flash creatures, counterspells and instant-speed removal at common and uncommon, by color and mana value. These are the cards to play around.

Sources disagree, and early reviews guess at format speed. Note disagreements instead of picking a side silently.

## 4. Survey the set from the cache

`--all-cards --set CODE` lists every card in the set, owned or not, and `--rarity` narrows it to a rarity in that set. Commons are what both players see most, so the sheet leans on them. Lists of commons and uncommons stay short enough to read in full:

```sh
S=trk
mise run collection:search -- --all-cards --set $S --group-by rarity                 # set size per rarity
mise run collection:search -- --all-cards --set $S --nonland --rarity common --rarity uncommon --group-by identity
mise run collection:search -- --all-cards --set $S --rarity common --rarity uncommon --role removal --oracle
mise run collection:search -- --all-cards --set $S --rarity common --rarity uncommon --type instant --oracle
mise run collection:search -- --all-cards --set $S --rarity common --rarity uncommon --text '\bflash\b' --oracle
mise run collection:search -- --all-cards --set $S --rarity rare --rarity mythic --nonland --oracle   # bombs to recognize
```

- **Removal:** read every `--role removal` match, since the pattern also catches counterspells and bounce. Then add the removal it misses: auras that stop a creature attacking or blocking, fight effects, and -X/-X effects worded differently.
- **Tricks:** the instants and flash cards, split by color and mana value, give the "Play around these" table.
- **Checks on the sources:** a review's "best common" that isn't common here, or a removal spell the reviews skipped, is worth a note on the sheet.
- **Owned copies:** without `--all-cards`, `--set` lists the set's cards the user already owns. Basics are usually the only ones before release.

## 5. Check every card

Run `card:show` on every card name the sheet will use, in batches:

```sh
mise run card:show -- "He's Dead, Jim" "Kirk, Commanding Officer" "Eject the Warp Core"
```

- A name the cache doesn't find is misspelled or wrong. Use the suggestion, or drop the card.
- Take mana costs, types and the short text summaries on the sheet from this output, not from the review.
- Mechanic reminder text comes from a card's cached text or the release notes.

## 6. Build the cheat sheet

Load `artifact-design`, write the page in the scratchpad and publish it as an Artifact. The user reads it on a phone at the table, so put each section on one screen and keep it skimmable, scannable and offline-safe (no live data needed). Sections, in this order:

1. **Tonight at a glance:** format, what's in the pack, the deck rules (40+ cards, any number of basics, the rest is sideboard) and the "Ask at check-in" box.
2. **Build checklist:** the steps from [limited-basics.md](limited-basics.md) "Building in Sealed" (or "Building after a Draft"), with the set's own numbers where the guides give them.
3. **Mechanics:** one line each, in plain words, with any timing gotcha.
4. **Archetypes:** a table of the ten pairs: colors, plan, signposts and a "good if your pool has" hint. Mark the ones sources rate highest.
5. **Removal by color:** name, cost and what it hits. This is the first thing to pull from a Sealed pool.
6. **Top commons and uncommons by color:** a short list each, so the user knows what's strong when they see it.
7. **Play around these:** tricks and instant-speed effects by color and mana value, so open mana means something.
8. **Draft only:** the pick order, signals and pack-direction reminder from [limited-basics.md](limited-basics.md).
9. **Sources:** links, with dates.

Mark every rating as the source's and every unknown as unknown. Don't fill gaps from memory.

Generate the page with a throwaway script in the scratchpad that reads `collection:search -- --all-cards --set CODE --json` and fails on any card name the set doesn't have. That way every cost and rarity on the sheet comes from the cache.

## 7. Save it to the repo

Keep a copy at `docs/prereleases/<set>/index.html`, where `<set>` is the set's name in lowercase with hyphens (`star-trek`, `edge-of-eternities`). A later sheet for the same set, such as a Draft night after the Prerelease, replaces it.

- **Make it a whole page.** The published Artifact is a fragment, and the viewer adds the document around it. The saved copy needs that itself: `<!doctype html>`, `<html lang="en">`, a `<head>` with `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, a small reset (`body { margin: 0 }`, the `:root` safe-area padding), then the fragment's title, links and style. The fragment's content goes in `<body>`. Without the viewport tag a phone shows the page zoomed out.
- **Format it:** `node_modules/.bin/prettier --write docs/prereleases/<set>/index.html`. `mise run check` fails on unformatted files.
- **Commit** only when the user asks.

## 8. Hand off

Give the link and the saved path, a few lines on what to focus on, and what's still unknown. Offer to help build the deck from photos or a typed list of the pool on the night, or to rate draft picks. After the event, offer to add what was learned (format speed, which archetypes worked, cards that over- or under-performed) to the sheet for the next event in that set.
