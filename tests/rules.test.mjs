import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeck, worstOutcome } from '../scripts/rules.mjs';
import { DAY_MS, NOW, card, entry, forest, indexOf, leader, messages, row, spell } from './fixtures.mjs';

const owned = () => ({ available: [row(forest, 100), row(leader, 1), row(spell, 4)], protected: [] });
const commanderDeck = (fields = {}) => ({
  schema_version: 1,
  name: 'Fixture',
  format: 'commander',
  status: 'draft',
  allow_proxies: false,
  primer: 'Test',
  commanders: [entry(leader.name)],
  mainboard: [entry(forest.name, 99)],
  ...fields,
});
const casualDeck = (mainboard) => commanderDeck({ format: 'casual-60', commanders: [], mainboard });
const check = (deck, { collections = owned(), cards = [forest, leader, spell], now = NOW } = {}) =>
  checkDeck(deck, collections, indexOf(...cards), { now });

test('a legal, owned Commander deck passes', () => {
  const report = check(commanderDeck());
  assert.equal(report.outcome, 'pass');
  assert.equal(report.total, 100);
  assert.deepEqual(report.findings, []);
});

test('Commander deck size counts the commander', () => {
  assert.deepEqual(messages(check(commanderDeck({ mainboard: [entry(forest.name, 98)] })), 'error'), [
    'Commander requires 100 cards including commanders; found 99',
  ]);
});

test('60-card Commander needs exactly 60 cards and keeps Commander rules', () => {
  const sixty = (mainboard) => commanderDeck({ format: 'commander-60', mainboard });
  assert.equal(check(sixty([entry(forest.name, 59)])).outcome, 'pass');
  assert.deepEqual(messages(check(sixty([entry(forest.name, 60)])), 'error'), [
    '60-card Commander requires 60 cards including commanders; found 61',
  ]);
  const blue = { ...spell, colorIdentity: ['U'] };
  const report = check(sixty([entry(forest.name, 57), entry(spell.name, 2)]), { cards: [forest, leader, blue] });
  assert.deepEqual(messages(report, 'error'), [
    'Example Spell: 2 copies exceeds limit 1',
    'Example Spell: outside commander color identity',
  ]);
});

test('casual decks need at least 60 cards', () => {
  assert.equal(check(casualDeck([entry(forest.name, 60)])).outcome, 'pass');
  assert.deepEqual(messages(check(casualDeck([entry(forest.name, 59)])), 'error'), [
    'Casual requires at least 60 cards; found 59',
  ]);
});

test('cards outside the commander color identity fail', () => {
  const blue = { ...spell, colorIdentity: ['U'] };
  const report = check(commanderDeck({ mainboard: [entry(forest.name, 98), entry(spell.name)] }), {
    cards: [forest, leader, blue],
  });
  assert.deepEqual(messages(report, 'error'), ['Example Spell: outside commander color identity']);
});

test('cards banned in Commander fail', () => {
  const banned = { ...spell, legalities: { commander: 'banned' } };
  const report = check(commanderDeck({ mainboard: [entry(forest.name, 98), entry(spell.name)] }), {
    cards: [forest, leader, banned],
  });
  assert.deepEqual(messages(report, 'error'), ['Example Spell: banned in Commander']);
});

test('a commander that is not a legendary creature fails', () => {
  const plainCreature = { ...leader, typeLine: 'Creature — Elf', frontType: 'Creature — Elf' };
  assert.deepEqual(messages(check(commanderDeck(), { cards: [forest, plainCreature] }), 'error'), [
    'Example Leader: not an eligible commander',
  ]);
});

test('copy limits are one in Commander and four in casual, with basics exempt', () => {
  const twoSpells = commanderDeck({ mainboard: [entry(forest.name, 97), entry(spell.name, 2)] });
  assert.deepEqual(messages(check(twoSpells), 'error'), ['Example Spell: 2 copies exceeds limit 1']);
  assert.deepEqual(messages(check(casualDeck([entry(forest.name, 55), entry(spell.name, 5)])), 'error'), [
    'Example Spell: 5 copies exceeds limit 4',
    'Example Spell: need 5, 4 available (short 1)',
  ]);
});

test('printed copy-limit exceptions are honored', () => {
  const collections = { available: [row(forest, 60), row(spell, 20)], protected: [] };
  const deck = casualDeck([entry(forest.name, 51), entry(spell.name, 9)]);
  const nine = { ...spell, oracleText: 'A deck can have up to nine cards named Example Spell.' };
  const any = { ...spell, oracleText: 'A deck can have any number of cards named Example Spell.' };
  const unusual = { ...spell, oracleText: 'A deck can have only one card named Example Spell per opponent.' };
  assert.equal(check(deck, { collections, cards: [forest, nine] }).outcome, 'pass');
  assert.equal(check(deck, { collections, cards: [forest, any] }).outcome, 'pass');
  assert.deepEqual(messages(check(deck, { collections, cards: [forest, unusual] }), 'incomplete'), [
    'Example Spell: unusual copy-limit text; verify manually',
  ]);
});

test('shortfalls fail and mention protected copies by collection', () => {
  const collections = {
    available: [row(leader, 1)],
    protected: [row(forest, 90, { collection: 'Precons' }), row(forest, 9, { collection: 'Cube' })],
  };
  assert.deepEqual(messages(check(commanderDeck(), { collections }), 'error'), [
    'Forest: need 99, 0 available (short 99); 90 in Precons, 9 in Cube (protected)',
  ]);
});

test('proxy copies count only when the deck allows proxies', () => {
  const collections = { available: [row(leader, 1), row(forest, 99, { isProxy: true })], protected: [] };
  assert.equal(check(commanderDeck(), { collections }).outcome, 'fail');
  assert.equal(check(commanderDeck({ allow_proxies: true }), { collections }).outcome, 'pass');
});

test('unlimited_basics removes basic land shortfalls', () => {
  const collections = { available: [row(leader, 1)], protected: [] };
  assert.equal(check(commanderDeck({ unlimited_basics: true }), { collections }).outcome, 'pass');
});

test('unknown and ambiguous card names make the check incomplete', () => {
  assert.equal(
    check(commanderDeck({ mainboard: [entry(forest.name, 98), entry('Mystery Card')] })).outcome,
    'incomplete',
  );
  const otherLeader = { ...leader, id: 'other', oracleId: 'other' };
  assert.match(
    messages(check(commanderDeck(), { cards: [forest, leader, otherLeader] }), 'incomplete').join(),
    /ambiguous/,
  );
});

test('card data older than 30 days adds a note without changing the outcome', () => {
  const report = check(commanderDeck(), { now: NOW + 31 * DAY_MS });
  assert.equal(report.outcome, 'pass');
  assert.deepEqual(messages(report, 'note'), [
    'Card data is 31 days old; run cards:refresh to pick up recent bans and errata',
  ]);
});

test('failures outrank unknowns when combining outcomes', () => {
  assert.equal(worstOutcome(['pass', 'incomplete', 'fail', 'pass']), 'fail');
  assert.equal(worstOutcome(['pass', 'incomplete']), 'incomplete');
  assert.equal(worstOutcome([]), 'pass');
});

const second = card('Second Leader', { typeLine: 'Legendary Creature — Elf', colorIdentity: ['G'] });
const background = card('Some Background', { typeLine: 'Legendary Enchantment — Background', colorIdentity: ['G'] });
const doctor = {
  ...second,
  typeLine: 'Legendary Creature — Time Lord Doctor',
  frontType: 'Legendary Creature — Time Lord Doctor',
};

function checkPair(first, other) {
  const deck = commanderDeck({
    commanders: [entry(first.name), entry(other.name)],
    mainboard: [entry(forest.name, 98)],
  });
  const collections = { available: [row(forest, 98), row(first, 1), row(other, 1)], protected: [] };
  return check(deck, { collections, cards: [forest, first, other] }).outcome;
}

test('recognized commander pairings pass', () => {
  const pairs = {
    'two plain Partners': [
      { ...leader, oracleText: 'Partner' },
      { ...second, oracleText: 'Partner (You can have two commanders.)' },
    ],
    'Partner with each other': [
      { ...leader, oracleText: 'Partner with Second Leader' },
      { ...second, oracleText: 'Partner with Example Leader' },
    ],
    'Friends forever': [
      { ...leader, keywords: ['Friends forever'] },
      { ...second, keywords: ['Friends forever'] },
    ],
    'Choose a Background': [{ ...leader, keywords: ['Choose a Background'] }, background],
    "Doctor's companion": [{ ...leader, keywords: ["Doctor's companion"] }, doctor],
  };
  for (const [label, [first, other]] of Object.entries(pairs)) assert.equal(checkPair(first, other), 'pass', label);
});

test('unrecognized commander pairings need manual review', () => {
  const pairs = {
    'two plain legends': [leader, second],
    'Partner with someone else': [
      { ...leader, oracleText: 'Partner with Someone Else' },
      { ...second, oracleText: 'Partner' },
    ],
    'Background without Choose a Background': [leader, background],
  };
  for (const [label, [first, other]] of Object.entries(pairs)) {
    assert.equal(checkPair(first, other), 'incomplete', label);
  }
});

const gameChanger = (name) => card(name, { gameChanger: true, colorIdentity: ['G'] });
const changers = ['Changer One', 'Changer Two', 'Changer Three', 'Changer Four'].map(gameChanger);

function checkWithChangers(count, fields = {}) {
  const used = changers.slice(0, count);
  const deck = commanderDeck({
    mainboard: [entry(forest.name, 99 - count), ...used.map((value) => entry(value.name))],
    ...fields,
  });
  const collections = {
    available: [row(forest, 99), row(leader, 1), ...used.map((value) => row(value, 1))],
    protected: [],
  };
  return check(deck, { collections, cards: [forest, leader, ...used] });
}

test('Game Changers are listed as a note when the deck sets no bracket', () => {
  const report = checkWithChangers(2);
  assert.equal(report.outcome, 'pass');
  assert.match(messages(report, 'note').join(), /2 Game Changers: Changer One, Changer Two \(Brackets 1-2 allow none/);
});

test('a bracket enforces its Game Changer limit', () => {
  assert.equal(checkWithChangers(3, { bracket: 3 }).outcome, 'pass');
  assert.deepEqual(messages(checkWithChangers(4, { bracket: 3 }), 'error'), [
    '4 Game Changers: Changer One, Changer Two, Changer Three, Changer Four; Bracket 3 allows up to 3',
  ]);
  assert.match(messages(checkWithChangers(1, { bracket: 2 }), 'error').join(), /Bracket 2 allows none/);
  assert.equal(checkWithChangers(4, { bracket: 4 }).outcome, 'pass');
});

test('Bracket 1 Game Changers need a playgroup decision rather than failing', () => {
  const report = checkWithChangers(1, { bracket: 1 });
  assert.equal(report.outcome, 'incomplete');
  assert.match(messages(report, 'incomplete').join(), /thematic exception/);
});
