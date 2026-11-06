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

Load `artifact-design`, write the page in the scratchpad and publish it as an Artifact. People read it on a phone at the table, so keep it skimmable and offline-safe (no live data needed).

**Follow the structure of the reference sheet, [docs/prereleases/star-trek/index.html](../../../docs/prereleases/star-trek/index.html).** Read it before building a new one. Each set gets its own look; the structure stays the same:

- **Header:** an eyebrow line (`Cheat sheet · Sealed · Prerelease <dates>`, with the date range kept on one line), the title `<Set> Prerelease`, a one-sentence lede on how the night runs, and a readout of the set's distinct cards per rarity from `--group-by rarity`, captioned with the set code and total.
- **Sticky section nav:** one short label per section, fitting one row on desktop (Tonight, Build, Mechanics, Archetypes, Removal, Top picks, Tricks, Rares, Draft, Sources) and scrolling sideways on phones.
- **Numbered sections, in this order:**
  1. **Tonight at a glance:** label/value facts (Format, The pack, Your deck, Bring, Vibe), then an "Ask at check-in" box listing what the store decides (rounds, best-of-one or three, sideboarding between games, basics, prizes).
  2. **Build checklist:** the steps from [limited-basics.md](limited-basics.md) "Building in Sealed" (or "Building after a Draft"), quoting the set guide's own numbers. Then a "Mana curve target" bar chart, drawn to scale with its scale stated, and "Lands and splashing": the set's dual lands, its other land cycles, its fixing and its landcyclers.
  3. **Mechanics:** a term and a plain-words definition each, with a gotcha line for timing or rules people get wrong. End with "Also seen" for returning keywords and "Not in your packs" for Commander-deck-only mechanics.
  4. **Archetypes:** one block per color pair. Each block has the pair's symbols and name, the two signposts as linked chips with their costs, a line on the cards that support it, and the source's rating where one exists.
  5. **Removal by color:** grouped by color with a count per group, each card with its type and what it hits.
  6. **Top commons and uncommons:** the Sealed guide's picks per color, in its order, plus colorless, with a short note from the card text.
  7. **Play around these:** instants and flash cards at common and uncommon, by color, with what each does to combat.
  8. **Rares to know:** "Build around or answer" and "Think twice" (traps and cards the reviews warn about).
  9. **If it's a draft:** pack directions, pick order, signals and the playables target.
  10. **Sources:** links with dates, the date of the card data, what's still unknown, and a legend for the rarity tags and the collector-number readout.
- **Card rows:** the name linked to Scryfall, the cost in mana symbols, a rarity tag with its letter (C, U, R, M), the set code and collector number, and a one-line note underneath.

Mark every rating as the source's and every unknown as unknown. Don't fill gaps from memory. Before publishing, check the spacing at phone width (390px) and desktop width. Desktop Chrome won't make a window narrower than about 500px, so render the page inside a 390px-wide iframe and screenshot that.

On every card:

- **Link the name to Scryfall** by set and collector number: `https://scryfall.com/card/<set>/<collector_number>`. The `--json` output's `printing` field has both.
- **Draw mana costs with Scryfall's symbol images, not colored dots.** The user is colorblind, and the symbols carry the color in their shape. The page can't load images from another site, so download the symbols the page uses. `https://api.scryfall.com/symbology` gives each symbol's `svg_uri`; save the files to their own folder in the scratchpad. Embed each one once as a `<symbol id="ms-W">` in a hidden `<svg>` sprite at the top of the page, then reference it with `<svg class="ms" role="img" aria-label="white"><title>white</title><use href="#ms-W"/></svg>`. Strip the `id` attributes inside the files, since they all reuse the same ones, and refuse any file containing a script, an event handler or an `href`.

**Style every sheet after its set's world.** The structure above stays fixed; the look changes with each set. Take the palette, typefaces and framing devices from the set's setting, the way the Star Trek sheet borrows LCARS consoles: a gothic horror set might use aged paper, blackletter headings and wax-seal tabs, and a heist set might use blueprint grids and case-file labels. Decide the look from the set's art and story, which the Wizards guide and card names show. Don't reuse the LCARS styling for another set. The theme never overrides these:

- Body text stays easy to read at a game table.
- Mana costs use the real symbol images, and rarity tags keep their letters (the user is colorblind).
- The phone layout and spacing checks above still apply.
- Borrow the setting's look, never its owner's logos or trademarks.

The user shares these sheets with other players, so write for anyone going to the event. Leave out anything about the user's own experience level or plans.

Generate the page with a throwaway script in the scratchpad that reads `collection:search -- --all-cards --set CODE --json` and fails on any card name the set doesn't have. That way every cost and rarity on the sheet comes from the cache.

## 7. Save it to the repo

Keep a copy at `docs/prereleases/<set>/index.html`, where `<set>` is the set's name in lowercase with hyphens (`star-trek`, `edge-of-eternities`). A later sheet for the same set, such as a Draft night after the Prerelease, replaces it.

- **Make it a whole page.** The published Artifact is a fragment, and the viewer adds the document around it. The saved copy needs that itself: `<!doctype html>`, `<html lang="en">`, a `<head>` with `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, a small reset (`body { margin: 0 }`, the `:root` safe-area padding), then the fragment's title, links and style. The fragment's content goes in `<body>`. Without the viewport tag a phone shows the page zoomed out.
- **Format it:** `node_modules/.bin/prettier --write docs/prereleases/<set>/index.html`. `mise run check` fails on unformatted files.
- **Commit** only when the user asks.

## 8. Hand off

Give the link and the saved path, a few lines on what to focus on, and what's still unknown. Offer to help build the deck from photos or a typed list of the pool on the night, or to rate draft picks. After the event, offer to add what was learned (format speed, which archetypes worked, cards that over- or under-performed) to the sheet for the next event in that set.
