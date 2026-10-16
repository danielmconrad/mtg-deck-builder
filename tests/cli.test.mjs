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
  primer: 'Fixture',
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
    // An empty env by default, so a developer's shell or .env cannot change test results.
    const cliWithEnv = (env, ...args) =>
      runCli(args, { root, env, write: (line) => stdout.push(line), warn: (line) => stderr.push(line) });
    const cli = (...args) => cliWithEnv({}, ...args);
    const writeDeck = (deck) => writeFile(join(root, 'decks', 'fixture', 'deck.yaml'), stringify(deck));
    await run({ root, cli, cliWithEnv, writeDeck, stdout, stderr });
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

test('decks nest under subfolders and are found by full path or a unique bare slug', () =>
  inWorkspace(async ({ root, cli, stdout }) => {
    const deckText = await readFile(join(root, 'decks', 'fixture', 'deck.yaml'), 'utf8');
    for (const folder of ['brad/elves', 'conrad/elves', 'brad/goblins']) {
      await mkdir(join(root, 'decks', folder), { recursive: true });
      await writeFile(join(root, 'decks', folder, 'deck.yaml'), deckText);
    }
    await mkdir(join(root, 'decks', 'brad', 'empty'));
    assert.equal(await cli('decks:check'), 1);
    assert.deepEqual(
      stdout.splice(0).map((line) => line.split(' (')[0]),
      [
        'PASS: brad/elves',
        'FAIL: brad/empty: ENOENT: no such file or directory, open '.concat(
          `'${join(root, 'decks', 'brad', 'empty', 'deck.yaml')}'`,
        ),
        'PASS: brad/goblins',
        'PASS: conrad/elves',
        'PASS: fixture',
      ],
    );
    assert.equal(await cli('deck:check', 'goblins'), 0);
    assert.equal(await cli('deck:check', 'conrad/elves'), 0);
    await assert.rejects(cli('deck:check', 'elves'), /matches brad\/elves, conrad\/elves; give the full path/);
    assert.equal(await cli('deck:files', 'goblins'), 0);
    assert.match(await readFile(join(root, 'decks', 'brad', 'goblins', 'decklist.moxfield.txt'), 'utf8'), /Forest/);

    assert.equal(await cli('deck:new', 'brad/green-value', '--commander', 'Example Leader'), 0);
    const text = await readFile(join(root, 'decks', 'brad', 'green-value', 'deck.yaml'), 'utf8');
    assert.match(
      text,
      /^# yaml-language-server: \$schema=\.\.\/\.\.\/\.\.\/schemas\/deck\.schema\.json\nschema_version/,
    );
    assert.match(text, /name: Green Value/);
    await assert.rejects(cli('deck:new', 'goblins', '--format', 'casual-60'), /EEXIST: a deck named goblins/);
  }));

test('deck:new never overwrites an existing deck', () =>
  inWorkspace(async ({ cli }) => {
    await assert.rejects(cli('deck:new', 'fixture', '--format', 'casual-60'), /EEXIST/);
  }));

test('collection:search --json prints machine-readable results', () =>
  inWorkspace(async ({ cli, stdout }) => {
    assert.equal(await cli('collection:search', '--type', 'land', '--json'), 0);
    assert.deepEqual(
      JSON.parse(stdout.at(-1)).map(({ name, available, protected: protectedCopies }) => [
        name,
        available,
        protectedCopies,
      ]),
      [['Forest', 60, 60]],
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
    assert.equal(await runCli(args, { root, env: {}, write: (line) => stdout.push(line), warn() {}, copyText }), 0);
    assert.deepEqual(copied, ['Deck\n60 Forest (TST) 1\n']);
    assert.match(stdout.join(), /Copied fixture in moxfield format to the clipboard/);
  }));

test('deck:export warns when a pinned printing is not cached', () =>
  inWorkspace(async ({ cli, writeDeck, stdout, stderr }) => {
    await writeDeck(
      casualDeck([{ name: 'Forest', quantity: 60, scryfall_id: '00000000-0000-4000-8000-000000000099' }]),
    );
    assert.equal(await cli('deck:export', 'fixture', '--format', 'moxfield'), 0);
    assert.deepEqual(stdout, ['Deck\n60 Forest']);
    assert.match(stderr.join(), /Printings not cached, exported by name only: Forest/);
  }));

test('deck:export --upgrades apply exports the deck with every swap made', () =>
  inWorkspace(async ({ cli, writeDeck, stdout, stderr }) => {
    const swap = {
      add: { name: 'Sol Ring', quantity: 1, role: 'ramp' },
      cut: { name: 'Forest', quantity: 1 },
      reason: 'Fixture',
    };
    await writeDeck({ ...casualDeck(), upgrades: [swap] });
    assert.equal(await cli('deck:export', 'fixture', '--format', 'archidekt', '--upgrades', 'apply'), 0);
    assert.deepEqual(stdout, ['59x Forest (TST) 1\n1x Sol Ring [Upgrade,Ramp]']);
    assert.match(stderr.join(), /Applied 1 upgrade swaps(.|\n)*exported by name only: Sol Ring/);
  }));

test('deck:export --upgrades split lists cuts under Swap Out and adds in the sideboard', () =>
  inWorkspace(async ({ cli, writeDeck, stdout }) => {
    const swap = { add: { name: 'Sol Ring', quantity: 1 }, cut: { name: 'Forest', quantity: 1 }, reason: 'Fixture' };
    await writeDeck({ ...casualDeck(), upgrades: [swap] });
    assert.equal(await cli('deck:export', 'fixture', '--upgrades', 'split'), 0);
    assert.deepEqual(stdout, ['59 Forest\n\nSwap Out\n1 Forest\n\nSideboard\n1 Sol Ring']);
    await assert.rejects(
      cli('deck:export', 'fixture', '--upgrades', 'maybe'),
      /--upgrades must be one of: apply, split/,
    );
  }));

test('MTG_EXPORT_FORMAT sets the default export format, and --format overrides it', () =>
  inWorkspace(async ({ cli, cliWithEnv, stdout }) => {
    const env = { MTG_EXPORT_FORMAT: 'archidekt' };
    assert.equal(await cliWithEnv(env, 'deck:export', 'fixture'), 0);
    assert.equal(stdout.pop(), '60x Forest (TST) 1');
    assert.equal(await cliWithEnv(env, 'deck:export', 'fixture', '--format', 'text'), 0);
    assert.equal(stdout.pop(), '60 Forest');
    await assert.rejects(
      cliWithEnv({ MTG_EXPORT_FORMAT: 'tappedout' }, 'deck:export', 'fixture'),
      /MTG_EXPORT_FORMAT must be one of: text, moxfield, archidekt/,
    );
    await assert.rejects(cli('deck:export', 'fixture', '--format', 'nope'), /--format must be one of/);
  }));

test('deck:files writes Archidekt and Moxfield lists, plus upgraded ones only when the deck has upgrades', () =>
  inWorkspace(async ({ root, cli, writeDeck, stdout }) => {
    const folder = join(root, 'decks', 'fixture');
    const read = (file) => readFile(join(folder, file), 'utf8');
    const swap = { add: { name: 'Sol Ring', quantity: 1 }, cut: { name: 'Forest', quantity: 1 }, reason: 'Fixture' };
    await writeFile(join(folder, 'decklist.txt'), 'stale');
    await writeFile(join(folder, 'decklist-moxfield.txt'), 'stale');
    await writeDeck({ ...casualDeck(), upgrades: [swap] });
    assert.equal(await cli('deck:files', 'fixture'), 0);
    assert.equal(
      await read('decklist.archidekt.txt'),
      '59x Forest (TST) 1\n1x Forest (TST) 1 [Swap Out]\n1x Sol Ring [Sideboard]\n',
    );
    assert.equal(
      await read('decklist.moxfield.txt'),
      'Deck\n59 Forest (TST) 1\n1 Forest (TST) 1\n\nSideboard\n1 Sol Ring\n',
    );
    assert.equal(await read('decklist-upgraded.archidekt.txt'), '59x Forest (TST) 1\n1x Sol Ring [Upgrade]\n');
    assert.equal(await read('decklist-upgraded.moxfield.txt'), 'Deck\n59 Forest (TST) 1\n\nSideboard\n1 Sol Ring\n');
    await assert.rejects(read('decklist.txt'), { code: 'ENOENT' });
    await assert.rejects(read('decklist-moxfield.txt'), { code: 'ENOENT' });
    assert.match(stdout.pop(), /Wrote decks\/fixture\/decklist.archidekt.txt, .*decklist-upgraded.moxfield.txt\.$/);

    await writeDeck(casualDeck());
    assert.equal(await cli('deck:files', 'fixture'), 0);
    assert.equal(await read('decklist.moxfield.txt'), 'Deck\n60 Forest (TST) 1\n');
    await assert.rejects(read('decklist-upgraded.archidekt.txt'), { code: 'ENOENT' });
    await assert.rejects(read('decklist-upgraded.moxfield.txt'), { code: 'ENOENT' });
  }));

test('every collection counts unless a --protect or MTG_PROTECTED_COLLECTIONS pattern matches it', () =>
  inWorkspace(async ({ root, cli, cliWithEnv, stdout, stderr }) => {
    await writeFile(join(root, 'collections', 'Bulk Box.csv'), CSV.replace(',60,', ',5,'));
    assert.equal(await cli('collection:search', '--count'), 0);
    assert.equal(stdout.pop(), '1 cards, 65 copies in Bulk Box, Organized');
    const env = { MTG_PROTECTED_COLLECTIONS: 'collections/Precons.csv, collections/Bulk*' };
    assert.equal(await cliWithEnv(env, 'collection:search', '--count'), 0);
    assert.equal(stdout.pop(), '1 cards, 60 copies in Organized');
    assert.equal(await cliWithEnv(env, 'collection:search', '--count', '--protect', ''), 0);
    assert.equal(stdout.pop(), '1 cards, 125 copies in Bulk Box, Organized, Precons');
    assert.equal(await cliWithEnv(env, 'collection:search', '--protect', 'collections/Bulk Box,Binder'), 0);
    assert.match(stdout.pop(), /^1 cards$/);
    assert.match(stdout.pop(), /^120x Forest .*\(\+5 in Bulk Box, protected\)$/);
    assert.match(stderr.join(), /No collection matches Binder to protect/);
    assert.equal(await cliWithEnv(env, 'collection:check'), 0);
    assert.deepEqual(
      stdout.splice(-3).map((line) => line.split(':')[0]),
      ['Bulk Box (protected)', 'Organized', 'Precons (protected)'],
    );
  }));

test('collections nest under subfolders, named by path and matched by folder or ** globs', () =>
  inWorkspace(async ({ root, cli, cliWithEnv, stdout }) => {
    await mkdir(join(root, 'collections', 'conrad', 'boxes'), { recursive: true });
    await mkdir(join(root, 'collections', 'other'));
    await writeFile(join(root, 'collections', 'conrad', 'boxes', 'Bulk.csv'), CSV.replace(',60,', ',5,'));
    await writeFile(join(root, 'collections', 'conrad', 'Precons.csv'), CSV.replace(',60,', ',7,'));
    await writeFile(join(root, 'collections', 'other', 'Trades.csv'), CSV.replace(',60,', ',3,'));
    const env = { MTG_COLLECTIONS: 'collections/conrad*,collections/other*' };
    assert.equal(await cliWithEnv(env, 'collection:search', '--count'), 0);
    assert.equal(stdout.pop(), '1 cards, 8 copies in conrad/boxes/Bulk, other/Trades');
    assert.equal(await cli('collection:search', '--count', '--collections', 'collections/**/Bulk.csv'), 0);
    assert.equal(stdout.pop(), '1 cards, 5 copies in conrad/boxes/Bulk');
    assert.equal(await cli('collection:check'), 0);
    assert.deepEqual(
      stdout.splice(-5).map((line) => line.split(':')[0]),
      ['conrad/boxes/Bulk', 'conrad/Precons (protected)', 'Organized', 'other/Trades', 'Precons (protected)'],
    );
  }));

test("cards named in a binder export's deck binders are held back like protected copies", () =>
  inWorkspace(async ({ root, cli, stdout }) => {
    const binderCsv =
      `Binder Name,Binder Type,Name,Quantity,Scryfall ID,Set code,Collector number,Foil\n` +
      `beholder,deck,Forest,1,${FOREST_ID},TST,001,normal\nall cards,binder,Forest,4,${FOREST_ID},TST,001,normal\n`;
    await writeFile(join(root, 'collections', 'Brad.csv'), binderCsv);
    assert.equal(await cli('collection:search', '--collections', 'collections/Brad.csv', '--count'), 0);
    assert.equal(stdout.pop(), '0 cards, 0 copies in Brad');
    assert.equal(await cli('collection:search', '--collections', 'collections/Brad*', '--include-protected'), 0);
    assert.match(stdout.join('\n'), /Forest .*5 in Brad decks, protected/);
  }));

test('--collections or MTG_COLLECTIONS limits which collections are read', () =>
  inWorkspace(async ({ root, cli, cliWithEnv, stdout, stderr }) => {
    await writeFile(join(root, 'collections', 'Bulk Box.csv'), CSV.replace(',60,', ',5,'));
    assert.equal(await cliWithEnv({ MTG_COLLECTIONS: './collections/Bulk*' }, 'collection:search', '--count'), 0);
    assert.equal(stdout.pop(), '1 cards, 5 copies in Bulk Box');
    const env = { MTG_COLLECTIONS: 'collections/Bulk Box' };
    const both = 'collections/Organized, collections/Precons.csv';
    assert.equal(await cliWithEnv(env, 'collection:search', '--count', '--collections', both), 0);
    assert.equal(stdout.pop(), '1 cards, 60 copies in Organized');
    assert.equal(await cliWithEnv(env, 'collection:search', '--count', '--collections', ''), 0);
    assert.equal(stdout.pop(), '1 cards, 65 copies in Bulk Box, Organized');
    assert.equal(await cli('collection:check', '--collections', 'collections/Organized.csv,Organized'), 0);
    assert.deepEqual(
      stdout.splice(-1).map((line) => line.split(':')[0]),
      ['Organized'],
    );
    assert.match(stderr.join(), /No collection matches Organized to read/);
  }));

test("a deck's collections field scopes it, between --collections and MTG_COLLECTIONS", () =>
  inWorkspace(async ({ root, cli, cliWithEnv, writeDeck, stdout }) => {
    await mkdir(join(root, 'collections', 'brad'));
    await writeFile(join(root, 'collections', 'brad', 'Binder.csv'), CSV.replace(',60,', ',5,'));
    await writeDeck({ ...casualDeck(), collections: ['collections/brad/*'] });
    assert.equal(await cli('deck:check', 'fixture'), 1);
    assert.match(stdout.join('\n'), /Forest: need 60, 5 available/);
    assert.equal(await cli('deck:check', 'fixture', '--collections', 'collections/Organized.csv'), 0);
    const env = { MTG_COLLECTIONS: 'collections/Organized.csv' };
    assert.equal(await cliWithEnv(env, 'decks:check'), 1);
    assert.match(stdout.join('\n'), /FAIL: fixture[^\n]*\n {2}ERROR: Forest: need 60, 5 available/);
    await writeDeck(casualDeck());
    assert.equal(await cliWithEnv(env, 'decks:check'), 0);
  }));

test('cards:refresh covers every collection, whatever MTG_COLLECTIONS says', () =>
  inWorkspace(async ({ root, cliWithEnv }) => {
    const uncachedId = '00000000-0000-4000-8000-000000000002';
    await writeFile(join(root, 'collections', 'Bulk Box.csv'), CSV.replace(FOREST_ID, uncachedId));
    await assert.rejects(
      cliWithEnv({ MTG_COLLECTIONS: 'collections/Organized.csv' }, 'cards:refresh', '--missing'),
      /Unexpected network access/,
    );
  }));

test('--help prints the command overview, and with a command, its options', () =>
  inWorkspace(async ({ cli, stdout }) => {
    for (const args of [[], ['--help'], ['help']]) {
      assert.equal(await cli(...args), 0);
      assert.match(stdout.pop(), /Commands:\n(.|\n)*deck:export +Print a paste-ready decklist/);
    }
    assert.equal(await cli('deck:export', '--help'), 0);
    assert.match(
      stdout.pop(),
      /--format FORMAT +text, moxfield, archidekt; defaults to MTG_EXPORT_FORMAT in \.env, else text/,
    );
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
      ['deck:check', 'brad/../../collections'],
      ['deck:check', '/brad'],
      ['deck:check', 'a', 'b'],
      ['collection:check', 'extra'],
      ['collection:search', '--bogus'],
    ];
    for (const args of invalid) await assert.rejects(cli(...args), /Usage|slug/, args.join(' '));
  }));
