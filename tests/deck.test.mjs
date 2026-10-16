import test from 'node:test';
import assert from 'node:assert/strict';
import { stringify } from 'yaml';
import { DAY_MS } from '../scripts/cards.mjs';
import { checkDeck, exportDeck, parseDeck, upgradeReport } from '../scripts/deck.mjs';
import { NOW, card, entry, forest, indexOf, leader, row, spell } from './fixtures.mjs';

const owned = () => ({ organized: [row(forest, 100), row(leader, 1), row(spell, 4)], precons: [] });
const deck = (fields = {}) => ({
  schema_version: 1, name: 'Fixture', format: 'commander', status: 'draft', allow_proxies: false, strategy: 'Test',
  commanders: [entry(leader.name)], mainboard: [entry(forest.name, 99)], ...fields,
});
const check = (value, inventory = owned(), cards = [forest, leader, spell], now = NOW) => checkDeck(value, inventory, indexOf(...cards), { now });
const clean = (report) => ({ errors: report.errors, incomplete: report.incomplete });

test('schema rejects unknown keys, duplicate keys, bad quantities and malformed commander sections', () => {
  assert.equal(parseDeck(stringify(deck())).name, 'Fixture');
  assert.equal(parseDeck(stringify(deck({ mainboard: [] }))).mainboard.length, 0);
  for (const invalid of [
    deck({ typo: true }),
    deck({ commanders: [] }),
    deck({ commanders: [entry(leader.name, 2)] }),
    deck({ mainboard: [entry('Forest', 0)] }),
    deck({ allow_proxies: 'false' }),
    deck({ format: 'casual-60' }),
  ]) assert.throws(() => parseDeck(stringify(invalid)), /deck:/);
  assert.throws(() => parseDeck('name: First\nname: Second'), /unique/i);
});

test('a legal, owned Commander deck passes and the size counts the commander', () => {
  assert.deepEqual(clean(check(deck())), { errors: [], incomplete: [] });
  assert.match(check(deck({ mainboard: [entry(forest.name, 98)] })).errors.join(), /100 cards/);
});

test('precons are protected, proxies follow the deck policy and basics can be declared unlimited', () => {
  const inventory = { organized: [row(leader, 1)], precons: [row(forest, 99)] };
  assert.match(check(deck(), inventory).errors.join(), /Forest: need 99, Organized has 0 \(short 99\); 99 in Precons/);
  inventory.organized.push(row(forest, 99, true));
  assert.match(check(deck(), inventory).errors.join(), /short 99/);
  assert.deepEqual(check(deck({ allow_proxies: true }), inventory).errors, []);
  assert.deepEqual(check(deck({ unlimited_basics: true }), { organized: [row(leader, 1)], precons: [] }).errors, []);
});

test('Commander color identity, bans, eligibility and singleton violations are errors', () => {
  const blue = { ...spell, color_identity: ['U'], legalities: { commander: 'banned' } };
  const report = check(deck({ mainboard: [entry(forest.name, 97), entry(spell.name, 2)] }), owned(), [forest, leader, blue]);
  assert.match(report.errors.join(), /outside commander color/);
  assert.match(report.errors.join(), /banned in Commander/);
  assert.match(report.errors.join(), /limit 1/);
  const ineligible = { ...leader, type_line: 'Creature — Elf', front_type: 'Creature — Elf' };
  assert.match(check(deck(), owned(), [forest, ineligible]).errors.join(), /not an eligible commander/);
});

test('casual minimum and four-copy limit allow basics and printed exceptions', () => {
  const value = deck({ format: 'casual-60', commanders: [], mainboard: [entry(forest.name, 55), entry(spell.name, 5)] });
  assert.match(check(value).errors.join(), /limit 4/);
  value.mainboard = [entry(forest.name, 59)];
  assert.match(check(value).errors.join(), /at least 60/);
  const inventory = owned();
  inventory.organized[2].quantity = 20;
  value.mainboard = [entry(forest.name, 51), entry(spell.name, 9)];
  const nine = { ...spell, oracle_text: 'A deck can have up to nine cards named Example Spell.' };
  assert.deepEqual(check(value, inventory, [forest, leader, nine]).errors, []);
  const any = { ...spell, oracle_text: 'A deck can have any number of cards named Example Spell.' };
  assert.deepEqual(check(value, inventory, [forest, leader, any]).errors, []);
});

test('missing and ambiguous cards are incomplete; old card data is only a note', () => {
  assert.match(check(deck(), owned(), []).incomplete.join(), /not in card cache/);
  const ambiguous = { ...leader, id: 'other', oracle_id: 'other' };
  assert.match(check(deck(), owned(), [forest, leader, ambiguous]).incomplete.join(), /ambiguous/);
  const old = check(deck(), owned(), [forest, leader, spell], NOW + 31 * DAY_MS);
  assert.deepEqual(clean(old), { errors: [], incomplete: [] });
  assert.match(old.warnings.join(), /31 days old/);
});

test('recognized commander pairings pass; anything else needs manual review', () => {
  const second = card('Second Leader', { type_line: 'Legendary Creature — Elf', color_identity: ['G'] });
  const pair = (first, other) => {
    const value = deck({ commanders: [entry(first.name), entry(other.name)], mainboard: [entry(forest.name, 98)] });
    const inventory = { organized: [row(forest, 98), row(first, 1), row(other, 1)], precons: [] };
    return clean(check(value, inventory, [forest, first, other]));
  };
  const passing = { errors: [], incomplete: [] };
  assert.match(pair(leader, second).incomplete.join(), /pairing not recognized/);
  assert.deepEqual(pair({ ...leader, oracle_text: 'Partner' }, { ...second, oracle_text: 'Partner (You can have two commanders.)' }), passing);
  assert.deepEqual(pair({ ...leader, oracle_text: 'Partner with Second Leader' }, { ...second, oracle_text: 'Partner with Example Leader' }), passing);
  assert.match(pair({ ...leader, oracle_text: 'Partner with Someone Else' }, { ...second, oracle_text: 'Partner' }).incomplete.join(), /pairing/);
  assert.deepEqual(pair({ ...leader, keywords: ['Friends forever'] }, { ...second, keywords: ['Friends forever'] }), passing);
  const background = card('Some Background', { type_line: 'Legendary Enchantment — Background', color_identity: ['G'] });
  assert.deepEqual(pair({ ...leader, keywords: ['Choose a Background'] }, background), passing);
  assert.match(pair(leader, background).incomplete.join(), /pairing/);
  const doctor = { ...second, type_line: 'Legendary Creature — Time Lord Doctor', front_type: 'Legendary Creature — Time Lord Doctor' };
  assert.deepEqual(pair({ ...leader, keywords: ["Doctor's companion"] }, doctor), passing);
});

test('upgrades use owned spares first, price only what is missing and never mutate the baseline', () => {
  const value = deck({ budget: { amount: 3, currency: 'USD' }, upgrades: [{ add: entry(spell.name), cut: entry(forest.name), reason: 'Interaction' }] });
  const original = structuredClone(value);
  const index = indexOf(forest, leader, spell);
  assert.equal(upgradeReport(value, owned(), index, { now: NOW }).totalCents, 0);
  const noSpell = { organized: [row(forest, 100), row(leader, 1)], precons: [] };
  const report = upgradeReport(value, noSpell, index, { now: NOW });
  assert.equal(report.totalCents, 250);
  assert.equal(report.withinBudget, true);
  assert.equal(upgradeReport({ ...value, budget: { amount: 2, currency: 'USD' } }, noSpell, index, { now: NOW }).withinBudget, false);
  assert.deepEqual(value, original);
  assert.equal(exportDeck(value), 'Commander\n1 Example Leader\n\n99 Forest\n');
});

test('basic shortfalls are free with unlimited basics and stale or missing quotes stay unknown', () => {
  const index = indexOf(forest, leader, spell);
  const fewBasics = { organized: [row(forest, 10), row(leader, 1)], precons: [] };
  const value = deck({ budget: { amount: 30, currency: 'USD' } });
  assert.equal(upgradeReport(value, fewBasics, index, { now: NOW }).totalCents, 89 * 20);
  assert.equal(upgradeReport({ ...value, unlimited_basics: true }, fewBasics, index, { now: NOW }).totalCents, 0);
  const stale = upgradeReport(value, fewBasics, index, { now: NOW + 8 * DAY_MS });
  assert.equal(stale.complete, false);
  assert.match(stale.lines.join(), /price unknown \(price data older than 7 days/);
  assert.equal(upgradeReport({ ...value, budget: { amount: 30, currency: 'EUR' } }, fewBasics, index, { now: NOW }).complete, false);
});

test('upgrade packages with mismatched quantities or overcuts are rejected', () => {
  const index = indexOf(forest, leader, spell);
  const swap = (add, cut) => deck({ budget: { amount: 30, currency: 'USD' }, upgrades: [{ add, cut, reason: 'Test' }] });
  assert.throws(() => upgradeReport(swap(entry(spell.name, 2), entry(forest.name, 1)), owned(), index, { now: NOW }), /quantities must match/);
  assert.throws(() => upgradeReport(swap(entry(spell.name, 100), entry(forest.name, 100)), owned(), index, { now: NOW }), /cuts exceed/);
  assert.throws(() => upgradeReport(swap(entry(spell.name), entry(leader.name)), owned(), index, { now: NOW }), /cuts exceed/);
});
