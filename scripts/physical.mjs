// The commands that move physical cards between collection files: deck:build, deck:teardown and
// deck:swap.
import {
  addTextCopies,
  deckCollectionText,
  nameLine,
  planBuild,
  planSwapOut,
  printingLine,
  removeCsvCopies,
  removeTextCopies,
} from './build.mjs';
import { isLand } from './card.mjs';
import { parseTextCollection, resolveTextRows } from './collection.mjs';
import { resolveEntries, withDeckChanges, withDeckField, withMainboardSwaps } from './deck.mjs';
import { checkLines, printAll } from './format.mjs';
import { checkJson, returnsJson, takesJson } from './json.mjs';
import { baselineOutcome, checkDeck } from './rules.mjs';
import { bracketNote, withBrackets } from './deck-commands.mjs';

// The cards deck:build takes, grouped by the collection file they come from.
function buildLines(plan, takenFrom, verb) {
  const lines = [`${verb}:`];
  for (const [path, takes] of takenFrom) {
    lines.push(`  from ${path}:`);
    for (const { row, card, quantity } of takes) lines.push(`    ${printingLine(quantity, card, row.finish)}`);
  }
  if (plan.untracked.length) {
    lines.push('  from untracked basics (unlimited_basics):');
    for (const { card, quantity } of plan.untracked) lines.push(`    ${nameLine(quantity, card)}`);
  }
  return lines;
}

// The files a command changes, edited in memory so a later edit to a file sees the earlier ones (a swap
// can take an in card from the binder it returns an out card to), then written together by commitFiles.
function changeSet(workspace) {
  const changes = new Map();
  const readIfExists = (path) =>
    workspace.readCollectionFile(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  return {
    read: async (path) => (changes.has(path) ? changes.get(path).text : readIfExists(path)),
    put(path, text, { create = false } = {}) {
      changes.set(path, { path, text, create: changes.get(path)?.create ?? create });
    },
    removed: () => [...changes.values()].filter(({ text }) => text === null).map(({ path }) => path),
    commit: () => workspace.commitFiles([...changes.values()]),
  };
}

// Takes each file's copies out of it, removing a file left with no cards.
async function takeCopies(files, takenFrom) {
  for (const [path, takes] of takenFrom) {
    const taken = new Map();
    for (const { row, quantity } of takes) taken.set(row.position, (taken.get(row.position) ?? 0) + quantity);
    const remove = path.endsWith('.csv') ? removeCsvCopies : removeTextCopies;
    files.put(path, remove(await files.read(path), taken));
  }
}

const reportRemoved = (files, write) => {
  for (const path of files.removed()) write(`Removed ${path}: every card in it went into the deck.`);
};

// The deck's copies to take, or null after printing why it can't be built: it must pass deck:check,
// and every card must have real copies to take.
async function buildPlan(workspace, deckId, deck, { write, emit }) {
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const report = checkDeck(deck, collections, index);
  if (baselineOutcome(report) !== 'pass') {
    emit({ applied: false, check: checkJson(report) });
    printAll(write, [...checkLines(deckId, report), `Not built: ${deckId} must pass deck:check first.`]);
    return { outcome: baselineOutcome(report) };
  }
  const plan = planBuild(deck, collections, index);
  if (plan.problems.length) {
    emit({ applied: false, problems: plan.problems });
    printAll(write, [
      ...plan.problems.map((problem) => `ERROR: ${problem}`),
      `Not built: ${deckId} needs these cards owned as real copies first.`,
    ]);
    return { outcome: 'fail' };
  }
  const pathOf = new Map(collections.sources.map((source) => [source.name, source.path]));
  return { plan, takenFrom: Map.groupBy(plan.takes, ({ row }) => pathOf.get(row.collection)) };
}

// Moves a finished deck's cards out of the collections they're counted in and into a text list of
// its own, then points the deck's collection_destination at that list. Without --apply it only
// prints what it would take.
// Other drafts that play a card this build takes, from a collection they read too, so they may come up
// short once it's built: [{ deck, cards }].
async function affectedDrafts(workspace, deckId, plan, index) {
  const taken = new Map(
    plan.takes.map(({ card, row }) => [card.oracleId, { name: card.name, collection: row.collection }]),
  );
  const drafts = (await workspace.loadAllDecks()).filter(
    ({ slug, deck }) => deck && slug !== deckId && deck.status === 'draft',
  );
  const affected = [];
  for (const { slug, deck } of drafts) {
    const { availableNames } = await workspace.loadCollections(deck);
    const cards = resolveEntries([...deck.commanders, ...deck.mainboard], index)
      .tallies.values()
      .map(({ card }) => taken.get(card.oracleId))
      .filter((use) => use && availableNames.includes(use.collection))
      .map(({ name }) => name)
      .toArray();
    if (cards.length) affected.push({ deck: slug, cards });
  }
  return affected;
}

export async function deckBuild({ workspace, slug, options, env, write, warn, emit }) {
  const deckId = await workspace.resolveDeckId(slug);
  const deck = await workspace.loadDeck(deckId);
  if (deck.collection_destination) throw new Error(`${deckId} is already built into ${deck.collection_destination}`);
  const template = env.MTG_BUILD_DESTINATION || undefined;
  const destination = options.to ?? workspace.defaultDeckCollection(deckId, deck.name, template);
  await workspace.checkNewCollection(destination);
  const { plan, takenFrom, outcome } = await buildPlan(workspace, deckId, deck, { write, emit });
  if (!plan) return outcome;
  const affected = await affectedDrafts(workspace, deckId, plan, await workspace.loadCardIndex());
  emit({ applied: Boolean(options.apply), destination, ...takesJson(plan, takenFrom), affected_drafts: affected });
  printAll(write, buildLines(plan, takenFrom, options.apply ? 'Taking' : 'Would take'));
  if (affected.length) {
    write('Drafts that also play cards this takes, which may come up short afterwards:');
    for (const { deck: other, cards } of affected) write(`  ${other}: ${cards.join(', ')}`);
  }
  if (!workspace.protects(destination)) {
    warn(`${destination} isn't protected, so other decks could count its cards; see MTG_PROTECTED_COLLECTIONS`);
  }
  if (!options.apply) {
    write(`Would write ${destination} and set collection_destination and status: built in builds/${deckId}/deck.yaml.`);
    write('Nothing changed; rerun with --apply to build it.');
    return 'pass';
  }
  const heading = `${deck.name}: built from builds/${deckId} by deck:build`;
  const files = changeSet(workspace);
  files.put(destination, deckCollectionText(plan, heading), { create: true });
  await takeCopies(files, takenFrom);
  const { path, text } = await workspace.readDeckText(deckId);
  const placed = withDeckField(text, 'collection_destination', destination, {
    after: 'collection_source',
    source: path,
  });
  files.put(path, withDeckChanges(placed, { status: 'built' }, { source: path }));
  await files.commit();
  reportRemoved(files, write);
  const sources = [...takenFrom.keys()].join(', ') || 'no collection';
  write(`Wrote ${destination}, took the cards out of ${sources}, and set collection_destination and status: built.`);
  return 'pass';
}

// The copies in a built deck's own list, grouped by the text list each goes back to: lands to
// --lands-to when it's given, everything else to --to. Lines without a printing are the untracked basics
// deck:build lists under unlimited_basics, which no collection held, so they go nowhere.
async function teardownPlan(workspace, deck, options) {
  const own = deck.collection_destination;
  const rows = resolveTextRows(
    parseTextCollection(await workspace.readCollectionFile(own), own),
    await workspace.loadCardIndex(),
  );
  const uncached = rows.filter((row) => row.set && !row.scryfallId);
  if (uncached.length) {
    const names = uncached.map((row) => row.name).join(', ');
    throw new Error(`${own} has lines not in the card cache (${names}); run scryfall:refresh -- --missing`);
  }
  const index = await workspace.loadCardIndex();
  const returns = new Map();
  const untracked = [];
  for (const row of rows) {
    if (!row.set) {
      untracked.push(row);
      continue;
    }
    const card = index.byId.get(row.scryfallId);
    const path = options['lands-to'] && isLand(card) ? options['lands-to'] : options.to;
    returns.set(path, [...(returns.get(path) ?? []), { card, finish: row.finish, quantity: row.quantity }]);
  }
  return { returns, untracked };
}

function teardownLines({ returns, untracked }, verb) {
  const lines = [`${verb}:`];
  for (const [path, copies] of returns) {
    lines.push(`  to ${path}:`);
    for (const { card, finish, quantity } of copies) lines.push(`    ${printingLine(quantity, card, finish)}`);
  }
  if (untracked.length) {
    lines.push('  nowhere, as untracked basics (unlimited_basics):');
    for (const { name, quantity } of untracked) lines.push(`    ${quantity} ${name}`);
  }
  return lines;
}

// --to and --lands-to must name text lists under collections/ other than the deck's own.
function checkReturnPaths(workspace, options, own, warn) {
  for (const path of [options.to, options['lands-to']].filter(Boolean)) {
    if (!/^collections\/(?:[^/\\]+\/)*[^/\\]+\.txt$/.test(path) || path.split('/').includes('..')) {
      throw new Error(`${path} must be a text list (.txt) under collections/`);
    }
    if (path === own) throw new Error(`${path} is the deck's own list`);
    if (workspace.protects(path)) warn(`${path} is protected, so no deck will count the returned cards`);
  }
}

// Adds each list's copies to it, creating a list that doesn't exist yet.
async function returnCopies(workspace, files, returns) {
  for (const [path, copies] of returns) {
    const existing = await files.read(path);
    if (existing === null) {
      await workspace.checkNewCollection(path);
      const lines = copies.map(({ card, finish, quantity }) => printingLine(quantity, card, finish));
      files.put(path, `${lines.join('\n')}\n`, { create: true });
    } else {
      files.put(path, addTextCopies(existing, copies));
    }
  }
}

// The reverse of deck:build: returns a built deck's cards from its own list to the text lists named,
// deletes that list, and makes the deck a draft again. Without --apply it only prints the plan.
export async function deckTeardown({ workspace, slug, options, write, warn, emit }) {
  const deckId = await workspace.resolveDeckId(slug);
  const deck = await workspace.loadDeck(deckId);
  const own = deck.collection_destination;
  if (!own) throw new Error(`${deckId} isn't built: it has no collection_destination`);
  if (!options.to) throw new Error('deck:teardown needs --to PATH, the text list to return the cards to');
  checkReturnPaths(workspace, options, own, warn);
  const plan = await teardownPlan(workspace, deck, options);
  emit({ applied: Boolean(options.apply), deleted: own, ...returnsJson(plan) });
  printAll(write, teardownLines(plan, options.apply ? 'Returning' : 'Would return'));
  const deckChanges = { collection_destination: undefined, ...(deck.status === 'built' ? { status: 'draft' } : {}) };
  const changed = Object.keys(deckChanges).join(' and ');
  if (!options.apply) {
    write(`Would delete ${own} and change ${changed} in builds/${deckId}/deck.yaml.`);
    write('Nothing changed; rerun with --apply to tear it down.');
    return 'pass';
  }
  const files = changeSet(workspace);
  await returnCopies(workspace, files, plan.returns);
  files.put(own, null);
  const { path, text } = await workspace.readDeckText(deckId);
  files.put(path, withDeckChanges(text, deckChanges, { source: path }));
  await files.commit();
  write(`Returned the cards to ${[...plan.returns.keys()].join(', ')}, deleted ${own}, and changed ${changed}.`);
  return 'pass';
}

// The copies each out card loses, by oracle ID, refusing more than the mainboard has.
function swapCuts(deck, pairs, index) {
  const mainboard = resolveEntries(deck.mainboard, index).tallies;
  const cuts = new Map();
  for (const pair of pairs) {
    if (pair.out.oracleId === pair.in.oracleId) throw new Error(`${pair.out.name} can't be swapped for itself`);
    const { quantity: has = 0, printingId } = mainboard.get(pair.out.oracleId) ?? {};
    const cut = cuts.get(pair.out.oracleId) ?? { card: pair.out, quantity: 0, printingId };
    cut.quantity += 1;
    if (cut.quantity > has) {
      throw new Error(`${pair.out.name}: the mainboard has ${has}, fewer than the ${cut.quantity} to swap out`);
    }
    cuts.set(pair.out.oracleId, cut);
  }
  return cuts;
}

// Pairs each --out with the --in at the same place, as cached cards. The out card must be in the
// mainboard with a copy for every swap, and every card must be cached.
function swapPairs(deck, options, index) {
  const outs = options.out ?? [];
  const ins = options.in ?? [];
  if (!outs.length || outs.length !== ins.length) {
    throw new Error('deck:swap needs one --in NAME for each --out NAME');
  }
  const lookup = (name) => {
    const { card, problem } = index.lookup({ name });
    if (problem) throw new Error(problem);
    return card;
  };
  const pairs = outs.map((out, position) => ({ out: lookup(out), in: lookup(ins[position]) }));
  return { pairs, cuts: swapCuts(deck, pairs, index) };
}

// Upgrades the swap leaves stale: ones cutting more copies of an out card than the deck now has, and
// ones adding a card the swap already put in.
function staleUpgrades(swapped, pairs, index) {
  const mainboard = resolveEntries(swapped.mainboard, index).tallies;
  const outs = new Set(pairs.map((pair) => pair.out.oracleId));
  const ins = new Set(pairs.map((pair) => pair.in.oracleId));
  return (swapped.upgrades ?? []).flatMap(({ add, cut }) => {
    const [added, removed] = [add, cut].map((entry) => index.lookup(entry).card);
    const stale = [];
    if (removed && outs.has(removed.oracleId) && (mainboard.get(removed.oracleId)?.quantity ?? 0) < cut.quantity) {
      stale.push(`the upgrade adding ${add.name} cuts ${cut.name}, which the swap takes out; give it another cut`);
    }
    if (added && ins.has(added.oracleId)) stale.push(`the upgrade adding ${add.name} is done by the swap; remove it`);
    return stale;
  });
}

// Copies a built deck's swap moves: the in cards from the other available collections into the deck's
// own list, and the out cards from that list back to --to (lands to --lands-to).
function swapMoves(deck, collections, cuts, pairs, options, index) {
  const own = collections.sources.find((source) => source.path === deck.collection_destination);
  const outPlan = planSwapOut(own.rows, cuts, index);
  const elsewhere = { available: collections.available.filter((row) => row.collection !== own.name) };
  const ins = pairs.map((pair) => ({ name: pair.in.name, quantity: 1 }));
  const inPlan = planBuild({ ...deck, commanders: [], mainboard: ins }, elsewhere, index);
  const pathOf = new Map(collections.sources.map((source) => [source.name, source.path]));
  const returns = new Map();
  for (const { row, card, quantity } of outPlan.takes) {
    const path = options['lands-to'] && isLand(card) ? options['lands-to'] : options.to;
    returns.set(path, [...(returns.get(path) ?? []), { card, finish: row.finish, quantity }]);
  }
  return {
    own,
    outPlan,
    inPlan,
    takenFrom: Map.groupBy(inPlan.takes, ({ row }) => pathOf.get(row.collection)),
    returns,
    problems: [...outPlan.problems, ...inPlan.problems],
  };
}

// The deck's own list with the out copies taken out and the in copies added, at the end of the list
// unless a line of the same printing and finish is already there.
function swappedOwnList(text, moves) {
  const taken = new Map();
  for (const { row, quantity } of [...moves.outPlan.takes, ...moves.outPlan.untracked]) {
    taken.set(row.position, (taken.get(row.position) ?? 0) + quantity);
  }
  const copies = moves.inPlan.takes.map(({ row, card, quantity }) => ({ card, finish: row.finish, quantity }));
  const basics = moves.inPlan.untracked.map(({ card, quantity }) => nameLine(quantity, card));
  const kept = removeTextCopies(text, taken);
  // Swapping out every card leaves no line for addTextCopies to place copies by, so they're appended.
  const base = kept === null ? text.replace(/^\s*\d+x?\s.*(?:\r?\n|$)/gm, '') : addTextCopies(kept, copies);
  const appended = [
    ...(kept === null ? copies.map(({ card, finish, quantity }) => printingLine(quantity, card, finish)) : []),
    ...basics,
  ];
  if (!appended.length) return base;
  return `${base}${base && !base.endsWith('\n') ? '\n' : ''}${appended.join('\n')}\n`;
}

function swapLines(pairs, moves, verb) {
  const lines = [`${verb} in deck.yaml:`, ...pairs.map((pair) => `  -1 ${pair.out.name}, +1 ${pair.in.name}`)];
  if (!moves) return lines;
  lines.push(...buildLines(moves.inPlan, moves.takenFrom, `${verb} into ${moves.own.path}`));
  lines.push(...teardownLines({ returns: moves.returns, untracked: moves.outPlan.untracked }, `${verb} out of it`));
  return lines;
}

// A built deck's moves, or the outcome after printing why it can't be swapped: the swapped deck must
// pass deck:check, and every card must have real copies to move.
function builtSwapPlan({ workspace, deckId, deck, collections, index, report, swap, options, write, warn, emit }) {
  if (baselineOutcome(report) !== 'pass') {
    emit({ check: checkJson(report) });
    printAll(write, [
      ...checkLines(deckId, report),
      `Not swapped: ${deckId} is built, so the swapped deck must pass deck:check.`,
    ]);
    return { outcome: baselineOutcome(report) };
  }
  checkReturnPaths(workspace, options, deck.collection_destination, warn);
  const moves = swapMoves(deck, collections, swap.cuts, swap.pairs, options, index);
  if (moves.problems.length) {
    emit({ problems: moves.problems });
    printAll(write, [...moves.problems.map((problem) => `ERROR: ${problem}`), 'Not swapped.']);
    return { outcome: 'fail' };
  }
  if (moves.returns.size && !options.to) {
    throw new Error('deck:swap needs --to PATH for a built deck, the text list the swapped-out cards go back to');
  }
  return { moves };
}

// One --reason per swap, or none, which leaves the swapped-out cards without a considered reason.
function swapReasons(options, swapCount, warn) {
  const reasons = options.reason ?? [];
  if (reasons.length && reasons.length !== swapCount) throw new Error('Give one --reason for each --out, or none');
  if (!reasons.length) {
    warn('WARNING: no --reason, so the cards swapped out get no considered reason and deck:candidates will list them');
  }
  return reasons;
}

// Swaps mainboard cards for others. A built deck's physical cards move too: each in card comes out of
// the available collections into the deck's own list, and each out card goes from that list back to
// --to. Without --apply it only prints the plan.
// What deck:swap changes, for --json: the swaps, and for a built deck the copies it moves.
const swapJson = (swaps, reasons, moves) => ({
  swaps: swaps.map((swap, at) => ({ ...swap, reason: reasons[at] ?? null })),
  ...(moves && {
    into: takesJson(moves.inPlan, moves.takenFrom),
    out_of: returnsJson({ returns: moves.returns, untracked: moves.outPlan.untracked }),
  }),
});

export async function deckSwap({ workspace, slug, options, today, write, warn, emit }) {
  const deckId = await workspace.resolveDeckId(slug);
  const deck = await workspace.loadDeck(deckId);
  const [collections, index] = await Promise.all([workspace.loadCollections(deck), workspace.loadCardIndex()]);
  const swap = swapPairs(deck, options, index);
  const swaps = swap.pairs.map((pair) => ({ out: pair.out.name, in: pair.in.name }));
  const record = { date: today, reasons: swapReasons(options, swaps.length, warn) };
  const swapped = await workspace.swapDeckCards(deckId, swaps, record);
  const report = checkDeck(swapped, collections, index);
  const own = deck.collection_destination;
  emit({ applied: false, ...swapJson(swaps, record.reasons) });
  let moves;
  if (own) {
    const context = { workspace, deckId, deck, collections, index, report, swap, options, write, warn, emit };
    const plan = builtSwapPlan(context);
    if (!plan.moves) return plan.outcome;
    ({ moves } = plan);
  } else if (options.to || options['lands-to']) {
    warn(`${deckId} isn't built, so only deck.yaml changes and --to is ignored`);
  }
  emit({ applied: Boolean(options.apply), ...swapJson(swaps, record.reasons, moves), check: checkJson(report) });
  printAll(write, swapLines(swap.pairs, moves, options.apply ? 'Swapping' : 'Would swap'));
  for (const stale of staleUpgrades(swapped, swap.pairs, index)) warn(`WARNING: ${stale}`);
  // A draft may be unfinished, so its check is shown rather than required.
  if (!own) printAll(write, checkLines(deckId, report));
  if (!options.apply) {
    write('Nothing changed; rerun with --apply to swap.');
    return 'pass';
  }
  const files = changeSet(workspace);
  if (moves) {
    files.put(own, swappedOwnList(await files.read(own), moves));
    await takeCopies(files, moves.takenFrom);
    await returnCopies(workspace, files, moves.returns);
  }
  const { path, text } = await workspace.readDeckText(deckId);
  const swappedText = withMainboardSwaps(text, swaps, { source: path, ...record }).text;
  const brackets = withBrackets(swappedText, swapped, index, { listChanged: true, source: path });
  files.put(path, brackets.text);
  await files.commit();
  reportRemoved(files, write);
  write(
    `Swapped ${swaps.length} card${swaps.length === 1 ? '' : 's'}, added a history entry${bracketNote(brackets)}; rerun deck:files.`,
  );
  return 'pass';
}
