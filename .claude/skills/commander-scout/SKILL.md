---
name: commander-scout
description: Find commanders, especially ones the user doesn't own yet, whose themes the user's collection in this repo already feeds. Ranks every commander with collection:commanders, checks the best against EDHREC with edhrec:refresh, reads their cards and proposes two or three to buy and build. Use when the user asks which commanders suit their collection, which commander to buy, or wants new-deck to start from a commander they don't own.
---

# Scouting commanders

The rules in AGENTS.md apply: only unprotected collections supply cards, protected copies are only mentioned, and card text, prices and legality come from the cache, never memory. Every command here is offline and read-only except `edhrec:refresh`, which uses the network. **Ask before running it.** It sends one request a second, so 20 commanders take about 20 seconds.

`collection-survey` sizes commanders the user already owns. This skill searches every commander in the cache, owned or not, and ranks them by how much of the collection feeds them.

## 0. Preflight

- **Bulk cache:** `mise run collection:check` starts with the cache's size. Unowned commanders are only there after `scryfall:refresh -- --bulk`, and `collection:commanders` warns without it. Ask before that refresh (about 105 MB).
- **The brief:** format, budget for the commander and upgrades, and any colors, themes or commanders the user wants or wants to avoid. Ask only about what's missing. `new-deck` step 1 lists the rest.
- **Existing decks:** each result says which decks the commander already leads (`leads conrad/...`). Skip those unless the user wants a second build. A built deck's cards sit in its own protected list, so they don't count toward any other commander.

## 1. Rank every commander

```sh
mise run collection:commanders -- --unowned                          # the best unowned commanders, by lift
mise run collection:commanders -- --unowned --sort cards             # the deepest on-theme pools
mise run collection:commanders -- --unowned --identity BG --limit 10 # within some colors (subsets included)
mise run collection:commanders -- --unowned --theme 'food|Halfling'  # one theme or creature type
mise run collection:commanders -- --unowned --max-price 5 --oracle   # cheap commanders, with their rules text
```

For each commander's rules text, the command finds the themes it cares about (tokens, Food, +1/+1 counters, spells and so on) and the creature types it names. It then counts the available nonland cards in its color identity that feed them. Reading a result:

- **On-theme cards:** owned cards that feed at least one theme. That's the pool's depth, and 30 (`--min-cards`, the default floor) is about a third of a Commander deck's spells.
- **Lift:** on-theme cards divided by how many an average collection your size would hold in those colors. Lift is what makes a commander right for _this_ collection: 4x Dwarves means the user is unusually deep in Dwarves. Broad themes often sit around 1.5x, because collections lean toward recent, Commander-friendly cards, so look for 2x and up.
- **Per theme:** each theme's own count and lift. A high lift only matters on the theme that is the commander's plan. A commander whose text mentions Treasure once still "cares" about Treasure here.
- **Pool:** owned spells in the identity. Five-color commanders get the biggest pools, so lift, not size, is the default sort, and the mana base needs checking separately.
- **Value:** EDHREC rank (popularity) and the cheapest cached price. Prices over 7 days old are stale.

The tests are rough rules-text patterns. Tribe counts include cards that only name the type, and themes overlap. They find leads; they don't judge fit. Run a few sorts and filters, then shortlist 10 to 20 commanders whose main theme carries the lift.

## 2. Check the shortlist against EDHREC

EDHREC's commander pages list the cards real decks play with each commander. Ask, then fetch the shortlist:

```sh
mise run edhrec:refresh -- --top 15 --unowned                        # the top of the same ranking
mise run edhrec:refresh -- --commander "Name One" --commander "Name Two"
mise run collection:commanders -- --unowned --sort edhrec --limit 15 # rerank by EDHREC synergy owned
```

Pages are cached in `.cache/edhrec.json` for 30 days (`--max-age`, `--force`). Each commander with a page then shows:

- **Listed cards owned:** how many of the 200 to 300 cards on its page are available.
- **Share of its synergy:** the owned share of EDHREC's positive synergy, which is how much more often a card is played with this commander than with others of its colors. This is the best single measure of owning its signature cards.
- **Share of an average deck:** weighted by how often decks play each card, so staples count. A high deck share with a low synergy share means a generic pile of good cards.
- **Most synergy owned:** the owned cards EDHREC ties most closely to it. Read them; they're the engine you already have.

When the two views disagree, find out why. High lift with low synergy share means the theme tests matched cards those decks don't play, so read the on-theme cards. Low lift with high synergy share means a plan the tests don't recognize. A page built from fewer than about 100 decks is thin evidence. EDHREC's JSON is undocumented: if `edhrec:refresh` fails on the response's shape, say so rather than guessing.

## 3. Read the best few

For the four or five strongest, size the pool as `collection-survey` step 2 does (role counts, tribes, lands), then read the engine:

```sh
C="Commander Name"
mise run card:show -- "$C"                                              # rules text, price, legality, protected copies
mise run collection:search -- --commander "$C" --nonland --group-by role
mise run collection:search -- --commander "$C" --nonland --text 'REGEX FOR ITS THEME' --sort edhrec --oracle
mise run collection:search -- --commander "$C" --unowned --text 'REGEX FOR ITS THEME' --sort edhrec --max-price 2  # cheap missing pieces
```

- **The plan:** does the commander use what the on-theme cards produce? Map it as in `deckbuilding-strategy` §1a.
- **Gaps:** weak roles, and EDHREC's top-synergy cards the user lacks (`card:show` each before naming it).
- **Format:** for Custom Dollar Brawl, add `--max-price 1` to the searches. `collection:commanders` counts every owned card whatever its price, so check the cards a deck could actually play.
- **Protected copies:** a commander owned only in a precon shows as unowned with "(+1 in ..., protected)". Moving that copy is an option the user decides on.

## 4. Propose two or three, then stop

For each:

- **Commander and price:** the cheapest cached printing and its age, or a protected copy to move.
- **Plan:** the game plan in two sentences, and how it wins.
- **Evidence:** on-theme cards and lift for its main theme, plus EDHREC's synergy and deck shares when a page is cached, e.g. "39 Villains, 6x an average collection; 49% of its EDHREC synergy owned".
- **Key owned cards:** the engine pieces from steps 2 and 3.
- **Gaps and extra purchases:** weak roles, and cheap missing pieces with prices from `card:show`.
- **Overlap:** drafts or decks already using the same cards. Drafts don't reserve cards, but the user should know.

Then **wait for the user to choose.** Don't buy anything, and don't run `deck:new` until they pick. If they want to build it, continue with `new-deck` step 3. An unowned commander stays unowned until the user adds it to a collection, and `deck:check` reports it until then.
