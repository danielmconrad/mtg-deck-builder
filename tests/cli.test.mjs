import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { writeCache } from '../scripts/card-cache.mjs';
import { runCli } from '../scripts/cli.mjs';
import { cacheOf, card } from './fixtures.mjs';

const FOREST_ID = '00000000-0000-4000-8000-000000000001';
const forest = card('Forest', {
  id: FOREST_ID,
  typeLine: 'Basic Land — Forest',
  colorIdentity: ['G'],
  producedMana: ['G'],
});
const CSV = `Name,Quantity,Scryfall ID,Set code,Collector number,Foil,Proxy\nForest,60,${FOREST_ID},TST,001,normal,false\n`;
const casualDeck = (mainboard = [{ name: 'Forest', quantity: 60 }]) => ({
  schema_version: 1,
  name: 'Fixture',
  format: 'casual-60',
  status: 'draft',
  allow_proxies: false,
  strategy: 'Fixture',
  commanders: [],
  mainboard,
});

// Runs a test in a synthetic workspace. The network is stubbed to throw, so any fetch fails the test.
async function inWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'mtg-cli-'));
  const originalFetch = globalThis.fetch;
  const stdout = [];
  const stderr = [];
  globalThis.fetch = () => {
    throw new Error('Unexpected network access');
  };
  try {
    await mkdir(join(root, 'collections'));
    await mkdir(join(root, 'decks', 'fixture'), { recursive: true });
    await writeFile(join(root, 'collections', 'Organized.csv'), CSV);
    await writeFile(join(root, 'collections', 'Precons.csv'), CSV);
    await writeFile(join(root, 'decks', 'fixture', 'deck.yaml'), stringify(casualDeck()));
    await writeCache(join(root, '.cache', 'cards.json'), cacheOf(forest));
    const cli = (...args) =>
      runCli(args, { root, write: (line) => stdout.push(line), warn: (line) => stderr.push(line) });
    const writeDeck = (deck) => writeFile(join(root, 'decks', 'fixture', 'deck.yaml'), stringify(deck));
    await run({ root, cli, writeDeck, stdout, stderr });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
}

test('a passing deck check exits 0 and leaves inputs untouched', () =>
  inWorkspace(async ({ root, cli }) => {
    assert.equal(await cli('deck:check', 'fixture'), 0);
    assert.equal(await cli('decks:check'), 0);
    assert.equal(await readFile(join(root, 'collections', 'Organized.csv'), 'utf8'), CSV);
    assert.equal(await readFile(join(root, 'decks', 'fixture', 'deck.yaml'), 'utf8'), stringify(casualDeck()));
  }));

test('deck check exits 1 on failure, 2 when only incomplete, and 1 when both', () =>
  inWorkspace(async ({ cli, writeDeck }) => {
    await writeDeck(casualDeck([{ name: 'Forest', quantity: 59 }]));
    assert.equal(await cli('deck:check', 'fixture'), 1);
    await writeDeck(
      casualDeck([
        { name: 'Forest', quantity: 60 },
        { name: 'Missing Card', quantity: 1 },
      ]),
    );
    assert.equal(await cli('deck:check', 'fixture'), 2);
    await writeDeck(
      casualDeck([
        { name: 'Forest', quantity: 58 },
        { name: 'Missing Card', quantity: 1 },
      ]),
    );
    assert.equal(await cli('deck:check', 'fixture'), 1);
  }));

test('decks:check reports a broken deck file and still checks the others', () =>
  inWorkspace(async ({ root, cli, stdout }) => {
    await mkdir(join(root, 'decks', 'broken'));
    await writeFile(join(root, 'decks', 'broken', 'deck.yaml'), 'name: [unterminated');
    assert.equal(await cli('decks:check'), 1);
    assert.match(stdout.join('\n'), /FAIL: broken/);
    assert.match(stdout.join('\n'), /PASS: fixture/);
  }));

test('deck:new writes the chosen commander into a new draft', () =>
  inWorkspace(async ({ root, cli }) => {
    assert.equal(await cli('deck:new', 'green-value', '--commander', 'Example Leader'), 0);
    const text = await readFile(join(root, 'decks', 'green-value', 'deck.yaml'), 'utf8');
    assert.match(text, /^# yaml-language-server/);
    assert.match(text, /- name: Example Leader/);
  }));

test('deck:new never overwrites an existing deck', () =>
  inWorkspace(async ({ cli }) => {
    await assert.rejects(cli('deck:new', 'fixture', '--format', 'casual-60'), /EEXIST/);
  }));

test('collection:search --json prints machine-readable results', () =>
  inWorkspace(async ({ cli, stdout }) => {
    assert.equal(await cli('collection:search', '--type', 'land', '--json'), 0);
    assert.deepEqual(
      JSON.parse(stdout.at(-1)).map(({ name, organized }) => [name, organized]),
      [['Forest', 60]],
    );
  }));

test('deck:stats prints the mainboard summary', () =>
  inWorkspace(async ({ cli, stdout }) => {
    assert.equal(await cli('deck:stats', 'fixture'), 0);
    assert.ok(stdout.includes('Lands: 60; nonland average mana value: n/a'));
  }));

test('deck:export prints the list to stdout and its caveat to stderr', () =>
  inWorkspace(async ({ cli, stdout, stderr }) => {
    assert.equal(await cli('deck:export', 'fixture'), 0);
    assert.deepEqual(stdout, ['60 Forest']);
    assert.match(stderr.join(), /does not validate/);
  }));

test('deck:export --copy sends the formatted list to the clipboard instead of stdout', () =>
  inWorkspace(async ({ root, stdout }) => {
    const copied = [];
    const copyText = async (text) => copied.push(text);
    const args = ['deck:export', 'fixture', '--format', 'moxfield', '--copy'];
    assert.equal(await runCli(args, { root, write: (line) => stdout.push(line), warn() {}, copyText }), 0);
    assert.deepEqual(copied, ['Deck\n60 Forest\n']);
    assert.match(stdout.join(), /Copied fixture in moxfield format to the clipboard/);
  }));

test('deck:export warns when a pinned printing is not cached', () =>
  inWorkspace(async ({ cli, writeDeck, stdout, stderr }) => {
    await writeDeck(
      casualDeck([{ name: 'Forest', quantity: 60, scryfall_id: '00000000-0000-4000-8000-000000000099' }]),
    );
    assert.equal(await cli('deck:export', 'fixture', '--format', 'moxfield'), 0);
    assert.deepEqual(stdout, ['Deck\n60 Forest']);
    assert.match(stderr.join(), /exported by name only: Forest/);
  }));

test('--help prints the command overview, and with a command, its options', () =>
  inWorkspace(async ({ cli, stdout }) => {
    for (const args of [[], ['--help'], ['help']]) {
      assert.equal(await cli(...args), 0);
      assert.match(stdout.pop(), /Commands:\n(.|\n)*deck:export +Print a paste-ready decklist/);
    }
    assert.equal(await cli('deck:export', '--help'), 0);
    assert.match(stdout.pop(), /--format FORMAT +text \(default\), moxfield or archidekt/);
    assert.equal(await cli('collection:search', '-h'), 0);
    assert.match(stdout.pop(), /--type REGEX \(repeatable\)/);
  }));

test('usage errors include the help for that command', () =>
  inWorkspace(async ({ cli }) => {
    await assert.rejects(
      cli('deck:export'),
      /deck:export needs exactly one <deck-slug>\n\nUsage: mise run deck:export/,
    );
    await assert.rejects(cli('deck:export', 'fixture', '--bogus'), /Unknown option '--bogus'(.|\n)*--copy/);
    await assert.rejects(cli('nope'), /Unknown command "nope"(.|\n)*Commands:/);
  }));

test('collection:search can print a count or groups instead of the list', () =>
  inWorkspace(async ({ cli, stdout }) => {
    assert.equal(await cli('collection:search', '--count'), 0);
    assert.equal(stdout.pop(), '1 cards, 60 copies in Organized');
    assert.equal(await cli('collection:search', '--group-by', 'identity', '--json'), 0);
    assert.deepEqual(JSON.parse(stdout.pop()), [{ key: 'G', cards: 1, copies: 60 }]);
    await assert.rejects(cli('collection:search', '--count', '--group-by', 'identity'), /not both/);
  }));

test('the CLI rejects unknown commands, unknown flags, bad slugs and wrong argument counts', () =>
  inWorkspace(async ({ cli }) => {
    const invalid = [
      ['nope'],
      ['deck:check'],
      ['deck:check', '../collections'],
      ['deck:check', 'a', 'b'],
      ['collection:check', 'extra'],
      ['collection:search', '--bogus'],
    ];
    for (const args of invalid) await assert.rejects(cli(...args), /Usage|slug/, args.join(' '));
  }));
