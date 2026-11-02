---
name: physical-deck
description: Move a deck's physical cards in and out of this repo's collection files with deck:build, deck:swap and deck:teardown. Use only when the user says they have physically sleeved up a deck, swapped cards in a built deck, or taken a built deck apart.
---

# Moving physical cards

These are the only commands that edit collection files (AGENTS.md). Run each **only when the user says it happened at the table**. Show its dry run first, and add `--apply` only after they confirm. Add `--json` to a dry run to read its plan as data.

## Building a finished deck

1. `mise run deck:verify -- <slug>`. A build needs `deck:check` to pass, and it should be the finished list. Upgrades aren't applied, so make any wanted swaps in `mainboard` first.
2. Dry run: `mise run deck:build -- <slug>`. It shows each card taken, from which file, and the destination. The destination comes from `MTG_BUILD_DESTINATION` in `.env` (`{owner}` and `{name}`), else `collections/<owner>/decks/<deck name>.txt`; `--to PATH` overrides it.
   - **Protection:** the tool warns if the destination isn't protected. Other decks would then count the built deck's cards.
   - **Foil-only copies:** point out any cards it can only take as foil.
   - **Basics:** with `unlimited_basics`, basics the collections lack are listed as untracked.
3. After the user confirms: `mise run deck:build -- <slug> --apply`. It writes the deck's own list, takes the cards out of the source files, and sets `collection_destination` and `status: built`.
4. Run `mise run deck:check -- <slug>` and `mise run deck:files -- <slug>`. Then run `mise run decks:check` and tell the user which other drafts now fail because they used these cards. Don't edit those decks.
5. **ManaBox:** if cards came from a ManaBox CSV, remind the user to move the same cards into a deck binder in ManaBox (or out of the app) before their next export, or they'll count twice.

## Swapping cards in a built deck

```sh
mise run deck:swap -- <slug> --out "Old Card" --in "New Card" --reason "Why it left." --to collections/<owner>/binders/<list>.txt          # dry run
mise run deck:swap -- <slug> --out "Old Card" --in "New Card" --reason "Why it left." --to collections/<owner>/binders/<list>.txt --apply
```

- **`--to`:** the text list the out cards go back to (`--lands-to` for lands). Ask which binder list if it isn't clear.
- **Checks:** the swapped deck must pass `deck:check`, and each in card must have a real copy in another available collection.
- **Records:** `--reason` records the out card in `considered` and adds a `history` entry.
- **Afterwards:** rerun `deck:files`. If an in card came from a ManaBox CSV, remind the user to move it in ManaBox too.

## Taking a deck apart

```sh
mise run deck:teardown -- <slug> --to collections/<owner>/binders/<list>.txt --lands-to collections/<owner>/binders/Lands.txt          # dry run
mise run deck:teardown -- <slug> --to collections/<owner>/binders/<list>.txt --lands-to collections/<owner>/binders/Lands.txt --apply
```

It returns every card in the deck's own list to the text lists named, deletes that list, removes `collection_destination` and sets `status` back to `draft`. The decklist in `deck.yaml` stays. Untracked basics aren't returned, since no collection held them.
