import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { parse, stringify } from 'yaml';
import { readCache, writeCache } from '../scripts/card-cache.mjs';
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
    await mkdir(join(root, 'builds', 'fixture'), { recursive: true });
    await writeFile(join(root, 'collections', 'Organized.csv'), CSV);
    await writeFile(join(root, 'collections', 'precons.csv'), CSV);
    await writeFile(join(root, 'builds', 'fixture', 'deck.yaml'), stringify(casualDeck()));
    await writeCache(join(root, '.cache', 'cards.json'), cacheOf(forest));
    // An empty env by default, so a developer's shell or .env cannot change test results.
    const cliWithEnv = (env, ...args) =>
      runCli(args, { root, env, write: (line) => stdout.push(line), warn: (line) => stderr.push(line) });
    const cli = (...args) => cliWithEnv({}, ...args);
    const writeDeck = (deck) => writeFile(join(root, 'builds', 'fixture', 'deck.yaml'), stringify(deck));
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
    assert.equal(await readFile(join(root, 'builds', 'fixture', 'deck.yaml'), 'utf8'), stringify(casualDeck()));
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
    await mkdir(join(root, 'builds', 'broken'));
    await writeFile(join(root, 'builds', 'broken', 'deck.yaml'), 'name: [unterminated');
    assert.equal(await cli('decks:check'), 1);
    assert.match(stdout.join('\n'), /FAIL: broken/);
    assert.match(stdout.join('\n'), /PASS: fixture/);
  }));

test('deck:new writes the chosen commander into a new draft', () =>
  inWorkspace(async ({ root, cli }) => {
    assert.equal(await cli('deck:new', 'green-value', '--commander', 'Example Leader'), 0);
    const text = await readFile(join(root, 'builds', 'green-value', 'deck.yaml'), 'utf8');
    assert.match(text, /^# yaml-language-server/);
    assert.match(text, /- name: Example Leader/);
  }));

test('decks nest under subfolders and are found by full path or a unique bare slug', () =>
  inWorkspace(async ({ root, cli, stdout }) => {
    const deckText = await readFile(join(root, 'builds', 'fixture', 'deck.yaml'), 'utf8');
    for (const folder of ['brad/elves', 'conrad/elves', 'brad/goblins']) {
      await mkdir(join(root, 'builds', folder), { recursive: true });
      await writeFile(join(root, 'builds', folder, 'deck.yaml'), deckText);
    }
    await mkdir(join(root, 'builds', 'brad', 'empty'));
    assert.equal(await cli('decks:check'), 1);
    assert.deepEqual(
      stdout.splice(0).map((line) => line.split(' (')[0]),
      [
        'PASS: brad/elves',
        'FAIL: brad/empty: ENOENT: no such file or directory, open '.concat(
          `'${join(root, 'builds', 'brad', 'empty', 'deck.yaml')}'`,
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
    assert.match(await readFile(join(root, 'builds', 'brad', 'goblins', 'decklist.moxfield.txt'), 'utf8'), /Forest/);

    assert.equal(await cli('deck:new', 'brad/green-value', '--commander', 'Example Leader'), 0);
    const text = await readFile(join(root, 'builds', 'brad', 'green-value', 'deck.yaml'), 'utf8');
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

test('collection:search --json prints machine-readable results in one envelope line', () =>
  inWorkspace(async ({ cli, stdout }) => {
    assert.equal(await cli('collection:search', '--type', 'land', '--json'), 0);
    assert.equal(stdout.length, 1);
    const { command, outcome, data, warnings } = JSON.parse(stdout[0]);
    assert.deepEqual([command, outcome, warnings], ['collection:search', 'pass', []]);
    assert.deepEqual(
      data.cards.map(({ name, available, protected: protectedCopies, protected_in: holdings }) => [
        name,
        available,
        protectedCopies,
        holdings,
      ]),
      [['Forest', 60, 60, [{ collection: 'precons', copies: 60 }]]],
    );
  }));

test('every read command prints JSON with --json or MTG_OUTPUT=json, warnings and errors included', () =>
  inWorkspace(async ({ cli, cliWithEnv, writeDeck, stdout, stderr }) => {
    const last = () => JSON.parse(stdout.pop());
    assert.equal(await cli('deck:check', 'fixture', '--json'), 0);
    assert.deepEqual(last(), {
      command: 'deck:check',
      deck: 'fixture',
      outcome: 'pass',
      data: { outcome: 'pass', total_cards: 60, findings: [] },
      warnings: [],
    });
    const json = { MTG_OUTPUT: 'json' };
    assert.equal(await cliWithEnv(json, 'deck:stats', 'fixture'), 0);
    assert.equal(last().data.land_sources.G, 60);
    assert.equal(await cliWithEnv(json, 'deck:stats', 'fixture', '--no-json'), 0);
    assert.match(stdout.join('\n'), /Lands: 60/);
    assert.equal(await cliWithEnv(json, 'collection:check'), 0);
    assert.deepEqual(
      last().data.collections.map(({ name, protected: isProtected }) => [name, isProtected]),
      [
        ['Organized', false],
        ['precons', true],
      ],
    );
    await writeDeck(casualDeck([{ name: 'Forest', quantity: 59 }]));
    assert.equal(await cliWithEnv(json, 'decks:check'), 1);
    assert.deepEqual(
      last().data.decks.map(({ deck, outcome }) => [deck, outcome]),
      [['fixture', 'fail']],
    );
    assert.equal(await cliWithEnv(json, 'deck:candidates', 'fixture', '--collections', 'collections/nothing*'), 0);
    assert.deepEqual(last().warnings, ['No collection matches collections/nothing* to read']);
    assert.equal(await cliWithEnv(json, 'deck:upgrades', 'fixture'), 1);
    assert.deepEqual(last(), {
      command: 'deck:upgrades',
      deck: 'fixture',
      outcome: 'fail',
      error: 'Set budget.amount and budget.currency before estimating upgrades',
      warnings: [],
    });
    assert.equal(stderr.length, 0);
    await assert.rejects(cliWithEnv({ MTG_OUTPUT: 'yaml' }, 'deck:check', 'fixture'), /MTG_OUTPUT must be one of/);
    assert.equal(await cliWithEnv({ MTG_OUTPUT: 'yaml' }, 'deck:export', 'fixture'), 0);
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

test('deck:export --upgrades split lists cuts under Swap Out and adds under Considering', () =>
  inWorkspace(async ({ cli, writeDeck, stdout }) => {
    const swap = { add: { name: 'Sol Ring', quantity: 1 }, cut: { name: 'Forest', quantity: 1 }, reason: 'Fixture' };
    await writeDeck({ ...casualDeck(), upgrades: [swap] });
    assert.equal(await cli('deck:export', 'fixture', '--upgrades', 'split'), 0);
    assert.deepEqual(stdout, ['59 Forest\n\nSwap Out\n1 Forest\n\nConsidering\n1 Sol Ring']);
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
    assert.equal(await cliWithEnv({ MTG_EXPORT_FORMAT: '' }, 'deck:export', 'fixture'), 0);
    assert.equal(stdout.pop(), '60 Forest');
    await assert.rejects(
      cliWithEnv({ MTG_EXPORT_FORMAT: 'tappedout' }, 'deck:export', 'fixture'),
      /MTG_EXPORT_FORMAT must be one of: text, moxfield, archidekt/,
    );
    await assert.rejects(cli('deck:export', 'fixture', '--format', 'nope'), /--format must be one of/);
  }));

test('deck:files writes Archidekt and Moxfield lists, plus upgraded ones only when the deck has upgrades', () =>
  inWorkspace(async ({ root, cli, writeDeck, stdout }) => {
    const folder = join(root, 'builds', 'fixture');
    const read = (file) => readFile(join(folder, file), 'utf8');
    const swap = { add: { name: 'Sol Ring', quantity: 1 }, cut: { name: 'Forest', quantity: 1 }, reason: 'Fixture' };
    await writeFile(join(folder, 'decklist.txt'), 'stale');
    await writeFile(join(folder, 'decklist-moxfield.txt'), 'stale');
    await writeDeck({ ...casualDeck(), upgrades: [swap] });
    assert.equal(await cli('deck:files', 'fixture'), 0);
    assert.equal(
      await read('decklist.archidekt.txt'),
      '59x Forest (TST) 1\n1x Forest (TST) 1 [Sideboard]\n1x Sol Ring [Maybeboard]\n',
    );
    assert.equal(
      await read('decklist.moxfield.txt'),
      'Deck\n59 Forest (TST) 1\n\nSideboard\n1 Forest (TST) 1\n\nConsidering\n1 Sol Ring\n',
    );
    assert.equal(await read('decklist-upgraded.archidekt.txt'), '59x Forest (TST) 1\n1x Sol Ring [Upgrade]\n');
    assert.equal(await read('decklist-upgraded.moxfield.txt'), 'Deck\n59 Forest (TST) 1\n1 Sol Ring\n');
    await assert.rejects(read('decklist.txt'), { code: 'ENOENT' });
    await assert.rejects(read('decklist-moxfield.txt'), { code: 'ENOENT' });
    assert.match(stdout.pop(), /Wrote builds\/fixture\/decklist.archidekt.txt, .*decklist-upgraded.moxfield.txt\.$/);

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
    const env = { MTG_PROTECTED_COLLECTIONS: 'collections/precons.csv, collections/Bulk*' };
    assert.equal(await cliWithEnv(env, 'collection:search', '--count'), 0);
    assert.equal(stdout.pop(), '1 cards, 60 copies in Organized');
    assert.equal(await cliWithEnv(env, 'collection:search', '--count', '--protect', ''), 0);
    assert.equal(stdout.pop(), '1 cards, 125 copies in Bulk Box, Organized, precons');
    assert.equal(await cliWithEnv(env, 'collection:search', '--protect', 'collections/Bulk Box,Binder'), 0);
    assert.match(stdout.pop(), /^1 cards$/);
    assert.match(stdout.pop(), /^120x Forest .*\(\+5 in Bulk Box, protected\)$/);
    assert.match(stderr.join(), /No collection matches Binder to protect/);
    assert.equal(await cliWithEnv(env, 'collection:check'), 0);
    assert.deepEqual(
      stdout.splice(-3).map((line) => line.split(':')[0]),
      ['Bulk Box (protected)', 'Organized', 'precons (protected)'],
    );
  }));

test('collections nest under subfolders, named by path and matched by folder or ** globs', () =>
  inWorkspace(async ({ root, cli, cliWithEnv, stdout }) => {
    await mkdir(join(root, 'collections', 'conrad', 'boxes'), { recursive: true });
    await mkdir(join(root, 'collections', 'other'));
    await writeFile(join(root, 'collections', 'conrad', 'boxes', 'Bulk.csv'), CSV.replace(',60,', ',5,'));
    await writeFile(join(root, 'collections', 'conrad', 'precons.csv'), CSV.replace(',60,', ',7,'));
    await writeFile(join(root, 'collections', 'other', 'Trades.csv'), CSV.replace(',60,', ',3,'));
    const env = { MTG_COLLECTIONS: 'collections/conrad*,collections/other*' };
    assert.equal(await cliWithEnv(env, 'collection:search', '--count'), 0);
    assert.equal(stdout.pop(), '1 cards, 8 copies in conrad/boxes/Bulk, other/Trades');
    assert.equal(await cli('collection:search', '--count', '--collections', 'collections/**/Bulk.csv'), 0);
    assert.equal(stdout.pop(), '1 cards, 5 copies in conrad/boxes/Bulk');
    assert.equal(await cli('collection:check'), 0);
    assert.deepEqual(
      stdout.splice(-5).map((line) => line.split(':')[0]),
      ['conrad/boxes/Bulk', 'conrad/precons (protected)', 'Organized', 'other/Trades', 'precons (protected)'],
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
    const both = 'collections/Organized, collections/precons.csv';
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

test("a deck's collection_source field scopes it, between --collections and MTG_COLLECTIONS", () =>
  inWorkspace(async ({ root, cli, cliWithEnv, writeDeck, stdout }) => {
    await mkdir(join(root, 'collections', 'brad'));
    await writeFile(join(root, 'collections', 'brad', 'Binder.csv'), CSV.replace(',60,', ',5,'));
    await writeDeck({ ...casualDeck(), collection_source: ['collections/brad/*'] });
    assert.equal(await cli('deck:check', 'fixture'), 1);
    assert.match(stdout.join('\n'), /Forest: need 60, 5 available/);
    assert.equal(await cli('deck:check', 'fixture', '--collections', 'collections/Organized.csv'), 0);
    const env = { MTG_COLLECTIONS: 'collections/Organized.csv' };
    assert.equal(await cliWithEnv(env, 'decks:check'), 1);
    assert.match(stdout.join('\n'), /FAIL: fixture[^\n]*\n {2}ERROR: Forest: need 60, 5 available/);
    await writeDeck(casualDeck());
    assert.equal(await cliWithEnv(env, 'decks:check'), 0);
  }));

test('deck:build moves a deck into its own protected collection only with --apply', () =>
  inWorkspace(async ({ root, cli, stdout, stderr }) => {
    const deckPath = join(root, 'builds', 'fixture', 'deck.yaml');
    const deck = (quantity) => ({ ...casualDeck([{ name: 'Forest', quantity }]), name: "Fixture's Forests/Mono-G" });
    const deckText = (quantity) => `# a comment\n${stringify(deck(quantity))}`;
    await writeFile(join(root, 'collections', 'Bulk Box.csv'), CSV.replace(',60,', ',5,'));
    await writeFile(deckPath, deckText(66));
    assert.equal(await cli('deck:build', 'fixture', '--apply'), 1);
    assert.match(stdout.join('\n'), /Forest: need 66, 65 available(.|\n)*Not built: fixture must pass deck:check/);
    await writeFile(deckPath, deckText(63));
    assert.equal(await cli('deck:build', 'fixture', '--protect', 'collections/**/precons'), 0);
    assert.match(stdout.join('\n'), /from collections\/Bulk Box.csv:\n {4}5 Forest \(TST\) 1\n/);
    assert.match(stdout.at(-1), /Nothing changed/);
    assert.match(stderr.join('\n'), /collections\/decks\/Fixture's Forests-Mono-G.txt isn't protected/);
    assert.equal(await readFile(join(root, 'collections', 'Organized.csv'), 'utf8'), CSV);
    assert.equal(await cli('deck:build', 'fixture', '--apply'), 0);
    assert.equal(await readFile(join(root, 'collections', 'Organized.csv'), 'utf8'), CSV.replace(',60,', ',2,'));
    await assert.rejects(readFile(join(root, 'collections', 'Bulk Box.csv')), /ENOENT/);
    assert.match(stdout.join('\n'), /Removed collections\/Bulk Box.csv/);
    assert.equal(
      await readFile(join(root, 'collections', 'decks', "Fixture's Forests-Mono-G.txt"), 'utf8'),
      "// Fixture's Forests/Mono-G: built from builds/fixture by deck:build\nDeck\n63 Forest (TST) 1\n",
    );
    const builtDeck = await readFile(deckPath, 'utf8');
    assert.match(
      builtDeck,
      /^# a comment\n(.|\n)*collection_destination: collections\/decks\/Fixture's Forests-Mono-G.txt/,
    );
    assert.match(builtDeck, /^status: built$/m);
    assert.equal(await cli('deck:check', 'fixture'), 0);
    assert.equal(await cli('deck:check', 'fixture', '--collections', 'collections/Organized.csv'), 0);
    await mkdir(join(root, 'builds', 'other'));
    await writeFile(join(root, 'builds', 'other', 'deck.yaml'), stringify(casualDeck()));
    assert.equal(await cli('deck:check', 'other'), 1);
    assert.match(
      stdout.join('\n'),
      /Forest: need 60, 2 available \(short 58\); 63 in decks\/Fixture's Forests-Mono-G, 60 in precons \(protected\)/,
    );
    await assert.rejects(
      cli('deck:build', 'fixture'),
      /already built into collections\/decks\/Fixture's Forests-Mono-G.txt/,
    );
  }));

test('MTG_BUILD_DESTINATION sets where deck:build writes a deck, from {owner} and {name}', () =>
  inWorkspace(async ({ cliWithEnv, stdout }) => {
    const env = { MTG_BUILD_DESTINATION: 'collections/{owner}/protected/custom/{name}.txt' };
    assert.equal(await cliWithEnv(env, 'deck:build', 'fixture', '--protect', 'collections/precons.csv'), 0);
    assert.match(stdout.join('\n'), /Would write collections\/protected\/custom\/Fixture.txt/);
    await assert.rejects(
      cliWithEnv({ MTG_BUILD_DESTINATION: 'collections/x.txt' }, 'deck:build', 'fixture'),
      /\{name\}/,
    );
  }));

test('deck:teardown returns a built deck to a text list only with --apply, and makes it a draft', () =>
  inWorkspace(async ({ root, cli, stdout, stderr }) => {
    const deckPath = join(root, 'builds', 'fixture', 'deck.yaml');
    const binder = join(root, 'collections', 'binders', 'Lands.txt');
    await writeFile(deckPath, `# a comment\n${stringify({ ...casualDeck(), unlimited_basics: true })}`);
    await assert.rejects(cli('deck:teardown', 'fixture', '--to', 'collections/binders/Lands.txt'), /isn't built/);
    assert.equal(await cli('deck:build', 'fixture', '--protect', 'collections/precons.csv', '--apply'), 0);
    const own = join(root, 'collections', 'decks', 'Fixture.txt');
    await writeFile(own, `${await readFile(own, 'utf8')}4 Forest\n`);
    await mkdir(join(root, 'collections', 'binders'));
    await writeFile(binder, '1 Forest (TST) 1\n');
    await assert.rejects(cli('deck:teardown', 'fixture'), /needs --to PATH/);
    await assert.rejects(cli('deck:teardown', 'fixture', '--to', 'collections/Organized.csv'), /must be a text list/);
    assert.equal(await cli('deck:teardown', 'fixture', '--to', 'collections/binders/Lands.txt'), 0);
    assert.match(
      stdout.join('\n'),
      /Would return:\n {2}to collections\/binders\/Lands.txt:\n {4}60 Forest \(TST\) 1\n {2}nowhere, as untracked basics \(unlimited_basics\):\n {4}4 Forest\n/,
    );
    assert.match(stdout.at(-1), /Nothing changed/);
    assert.equal(await readFile(binder, 'utf8'), '1 Forest (TST) 1\n');
    assert.equal(await cli('deck:teardown', 'fixture', '--to', 'collections/binders/Lands.txt', '--apply'), 0);
    assert.equal(await readFile(binder, 'utf8'), '61 Forest (TST) 1\n');
    await assert.rejects(readFile(own), /ENOENT/);
    const tornDown = await readFile(deckPath, 'utf8');
    assert.match(tornDown, /^# a comment\n(.|\n)*status: draft/);
    assert.doesNotMatch(tornDown, /collection_destination/);
    assert.ok(!stderr.some((line) => /is protected, so no deck/.test(line)));
    assert.equal(await cli('deck:check', 'fixture'), 0);
  }));

test("deck:swap edits a draft deck.yaml, and moves a built deck's cards only with --apply", () =>
  inWorkspace(async ({ root, cli, writeDeck, stdout, stderr }) => {
    const oldDraw = card('Old Draw', { collectorNumber: '2' });
    const newDraw = card('New Draw', { collectorNumber: '3' });
    const unowned = card('Unowned Card', { collectorNumber: '4' });
    await writeCache(join(root, '.cache', 'cards.json'), cacheOf(forest, oldDraw, newDraw, unowned));
    const deckPath = join(root, 'builds', 'fixture', 'deck.yaml');
    const binder = join(root, 'collections', 'binders', 'Binder.txt');
    const own = join(root, 'collections', 'decks', 'Fixture.txt');
    const mainboard = [
      { name: 'Forest', quantity: 59, role: 'land' },
      { name: 'Old Draw', quantity: 1, role: 'draw' },
    ];
    const upgrades = [{ add: { name: 'Forest', quantity: 1 }, cut: { name: 'Old Draw', quantity: 1 }, reason: 'x' }];
    await mkdir(join(root, 'collections', 'binders'));
    await mkdir(join(root, 'collections', 'decks'));
    await writeFile(binder, '1 Forest (TST) 1\n1 New Draw (TST) 3\n');

    await writeDeck({ ...casualDeck(mainboard), upgrades });
    await assert.rejects(cli('deck:swap', 'fixture', '--out', 'Old Draw'), /one --in NAME for each --out/);
    await assert.rejects(
      cli('deck:swap', 'fixture', '--out', 'Island', '--in', 'New Draw'),
      /Island: not in card cache/,
    );
    await assert.rejects(
      cli('deck:swap', 'fixture', '--out', 'Old Draw', '--in', 'New Draw', '--out', 'Old Draw', '--in', 'Forest'),
      /Old Draw: the mainboard has 1, fewer than the 2/,
    );
    assert.equal(await cli('deck:swap', 'fixture', '--out', 'old draw', '--in', 'New Draw', '--apply'), 0);
    assert.match(stdout.join('\n'), /Swapping in deck.yaml:\n {2}-1 Old Draw, \+1 New Draw\n/);
    assert.match(stderr.join('\n'), /upgrade adding Forest cuts Old Draw, which the swap takes out/);
    assert.match(await readFile(deckPath, 'utf8'), /- name: New Draw\n {4}quantity: 1\n {4}role: draw/);
    assert.equal(await readFile(binder, 'utf8'), '1 Forest (TST) 1\n1 New Draw (TST) 3\n');

    const ownText = 'Deck\n59 Forest (TST) 1\n1 Old Draw (TST) 2\n';
    await writeFile(own, ownText);
    await writeDeck({
      ...casualDeck(mainboard),
      status: 'built',
      collection_destination: 'collections/decks/Fixture.txt',
    });
    const swap = ['deck:swap', 'fixture', '--out', 'Old Draw', '--in', 'New Draw'];
    await assert.rejects(cli(...swap), /needs --to PATH for a built deck/);
    await assert.rejects(cli(...swap, '--to', 'collections/decks/Fixture.txt'), /the deck's own list/);
    assert.equal(await cli(...swap, '--to', 'collections/binders/Binder.txt'), 0);
    assert.match(
      stdout.join('\n'),
      /Would swap into collections\/decks\/Fixture.txt:\n {2}from collections\/binders\/Binder.txt:\n {4}1 New Draw \(TST\) 3\nWould swap out of it:\n {2}to collections\/binders\/Binder.txt:\n {4}1 Old Draw \(TST\) 2\n/,
    );
    assert.match(stdout.at(-1), /Nothing changed/);
    assert.equal(await readFile(own, 'utf8'), ownText);
    assert.equal(await cli(...swap, '--to', 'collections/binders/Binder.txt', '--apply'), 0);
    assert.equal(await readFile(own, 'utf8'), 'Deck\n59 Forest (TST) 1\n1 New Draw (TST) 3\n');
    assert.equal(await readFile(binder, 'utf8'), '1 Forest (TST) 1\n1 Old Draw (TST) 2\n');
    assert.match(await readFile(deckPath, 'utf8'), /- name: New Draw/);
    assert.equal(await cli('deck:check', 'fixture'), 0);
    assert.equal(await cli('deck:swap', 'fixture', '--out', 'New Draw', '--in', 'Unowned Card', '--apply'), 1);
    assert.match(stdout.at(-1), /Not swapped: fixture is built/);
    assert.equal(await readFile(own, 'utf8'), 'Deck\n59 Forest (TST) 1\n1 New Draw (TST) 3\n');
  }));

test('deck:swap --reason records the out card in considered and adds a history entry', () =>
  inWorkspace(async ({ root, writeDeck, stdout, stderr }) => {
    const oldDraw = card('Old Draw', { collectorNumber: '2' });
    const newDraw = card('New Draw', { collectorNumber: '3' });
    await writeCache(join(root, '.cache', 'cards.json'), cacheOf(forest, oldDraw, newDraw));
    const deckPath = join(root, 'builds', 'fixture', 'deck.yaml');
    const mainboard = [
      { name: 'Forest', quantity: 59, role: 'land' },
      { name: 'Old Draw', quantity: 1, role: 'draw' },
    ];
    await writeDeck({ ...casualDeck(mainboard), considered: [{ name: 'New Draw', reason: 'Was worse' }] });
    const now = Date.parse('2026-11-02T12:00:00');
    const cli = (...args) =>
      runCli(args, { root, env: {}, now, write: (line) => stdout.push(line), warn: (line) => stderr.push(line) });
    const swap = ['deck:swap', 'fixture', '--out', 'Old Draw', '--in', 'New Draw'];
    await assert.rejects(cli(...swap, '--reason', 'a', '--reason', 'b'), /one --reason for each --out/);
    assert.equal(await cli(...swap), 0);
    assert.match(stderr.join('\n'), /no --reason/);
    assert.doesNotMatch(await readFile(deckPath, 'utf8'), /history/);
    assert.equal(await cli(...swap, '--reason', 'Too slow.', '--apply'), 0);
    const swapped = parse(await readFile(deckPath, 'utf8'));
    assert.deepEqual(swapped.considered, [{ name: 'Old Draw', reason: 'Too slow.' }]);
    assert.deepEqual(swapped.history, [{ date: '2026-11-02', changes: '-Old Draw, +New Draw', notes: 'Too slow.' }]);
  }));

test('deck:verify passes only a finished deck: checked, explained, priced and with current decklist files', () =>
  inWorkspace(async ({ root, cli, writeDeck, stdout }) => {
    const spare = card('Spare Spell', { collectorNumber: '2' });
    await writeCache(join(root, '.cache', 'cards.json'), cacheOf(forest, spare));
    await writeFile(join(root, 'collections', 'Spells.txt'), '1 Spare Spell (TST) 2\n');
    await writeDeck({ ...casualDeck(), primer: 'Describe the game plan.' });
    assert.equal(await cli('deck:verify', 'fixture'), 1);
    const report = stdout.join('\n');
    assert.match(report, /ERROR: primer: still the placeholder/);
    assert.match(report, /ERROR: candidates: 1 of the top 20 left-out cards have no considered reason: Spare Spell/);
    assert.match(report, /ERROR: decklist files: decklist.archidekt.txt, decklist.moxfield.txt differ from deck.yaml/);
    await writeDeck({ ...casualDeck(), considered: [{ name: 'Spare Spell', reason: 'Off plan' }] });
    assert.equal(await cli('deck:files', 'fixture'), 0);
    stdout.length = 0;
    assert.equal(await cli('deck:verify', 'fixture'), 0);
    assert.deepEqual(stdout, ['PASS: fixture (60 cards)']);
    const swap = { add: { name: 'Spare Spell', quantity: 1 }, cut: { name: 'Forest', quantity: 1 }, reason: 'x' };
    await writeDeck({ ...casualDeck(), considered: [{ name: 'Spare Spell', reason: 'Off plan' }], upgrades: [swap] });
    assert.equal(await cli('deck:verify', 'fixture'), 1);
    assert.match(stdout.join('\n'), /ERROR: upgrades: set budget(.|\n)*decklist-upgraded.archidekt.txt/);
  }));

test('deck:files keeps lowest_legal_bracket current and drops plays_like_bracket when the cards change', () =>
  inWorkspace(async ({ root, cli, stdout }) => {
    const leader = card('Leader', { typeLine: 'Legendary Creature — Elf', colorIdentity: ['G'], collectorNumber: '2' });
    const changer = card('Changer', { gameChanger: true, collectorNumber: '3' });
    await writeCache(join(root, '.cache', 'cards.json'), cacheOf(forest, leader, changer));
    await writeFile(join(root, 'collections', 'Spells.txt'), '1 Leader (TST) 2\n1 Changer (TST) 3\n');
    const deckPath = join(root, 'builds', 'fixture', 'deck.yaml');
    const read = async () => parse(await readFile(deckPath, 'utf8'));
    const edit = async (from, to) => writeFile(deckPath, (await readFile(deckPath, 'utf8')).replace(from, to));
    const deck = {
      ...casualDeck([{ name: 'Forest', quantity: 99 }]),
      format: 'commander',
      target_bracket: 3,
      unlimited_basics: true,
      commanders: [{ name: 'Leader', quantity: 1 }],
      considered: [{ name: 'Changer', reason: 'Saved for later' }],
    };
    await writeFile(deckPath, `# kept\n${stringify(deck)}`);
    assert.equal(await cli('deck:files', 'fixture'), 0);
    assert.match(stdout.pop(), /moxfield.txt; set lowest_legal_bracket: 1\.$/);
    assert.match(await readFile(deckPath, 'utf8'), /^# kept\n(.|\n)*target_bracket: 3\nlowest_legal_bracket: 1\n/);
    assert.equal(await cli('deck:verify', 'fixture'), 1);
    assert.match(stdout.join('\n'), /ERROR: plays_like_bracket: not judged for this list/);

    await edit('target_bracket: 3\n', 'target_bracket: 3\nplays_like_bracket: 2\n');
    stdout.length = 0;
    assert.equal(await cli('deck:verify', 'fixture'), 0, stdout.join('\n'));
    assert.equal(await cli('deck:files', 'fixture'), 0);
    assert.equal((await read()).plays_like_bracket, 2, 'an unchanged list keeps its judgment');
    assert.equal(await cli('deck:stats', 'fixture'), 0);
    assert.ok(
      stdout.includes(
        'Brackets: lowest legal 1 (no Game Changers, extra turns or mass land denial); plays like 2; target 3',
      ),
    );

    await edit('quantity: 99', 'quantity: 98');
    await edit('mainboard:\n', 'mainboard:\n  - name: Changer\n    quantity: 1\n');
    assert.equal(await cli('deck:check', 'fixture'), 1);
    assert.match(stdout.join('\n'), /plays_like_bracket 2 is below lowest_legal_bracket 3/);
    assert.equal(await cli('deck:verify', 'fixture'), 1);
    assert.match(stdout.join('\n'), /ERROR: lowest_legal_bracket: is 1, but the cards set 3; run deck:files/);
    assert.equal(await cli('deck:files', 'fixture'), 0);
    assert.match(
      stdout.pop(),
      /set lowest_legal_bracket: 3 and removed plays_like_bracket because the card list changed/,
    );
    const changed = await read();
    assert.deepEqual([changed.lowest_legal_bracket, changed.plays_like_bracket], [3, undefined]);

    await edit('target_bracket: 3\n', 'target_bracket: 3\nplays_like_bracket: 4\n');
    assert.equal(await cli('deck:check', 'fixture'), 1);
    assert.match(stdout.join('\n'), /plays_like_bracket 4 is above target_bracket 3/);
  }));

test('deck:candidates lists left-out cards with their considered reasons, and collection:search sorts by value', () =>
  inWorkspace(async ({ root, cli, writeDeck, stdout }) => {
    const ranked = card('Ranked Spell', { collectorNumber: '2', edhrecRank: 7, prices: { usd: '3.00', eur: null } });
    const other = card('Other Spell', { collectorNumber: '3', prices: { usd: '9.00', eur: null } });
    await writeCache(join(root, '.cache', 'cards.json'), cacheOf(forest, ranked, other));
    await writeFile(join(root, 'collections', 'Spells.txt'), '1 Ranked Spell (TST) 2\n1 Other Spell (TST) 3\n');
    await writeDeck({ ...casualDeck(), considered: [{ name: 'Other Spell', reason: 'Off plan' }] });
    assert.equal(await cli('deck:candidates', 'fixture'), 0);
    assert.match(
      stdout.join('\n'),
      /1x Ranked Spell {2}— Sorcery \(EDHREC #7, \$3\.00\)\n {4}not in considered\n1x Other Spell {2}— Sorcery \(EDHREC \?, \$9\.00\)\n {4}considered: Off plan\n2 of 2 left-out cards shown; 1 of them without a considered reason \(1 in all\)/,
    );
    assert.equal(await cli('deck:candidates', 'fixture', '--sort', 'price', '--limit', '1'), 0);
    assert.match(stdout.at(-1), /^1 of 2 left-out cards shown; 0 of them without a considered reason \(1 in all\)/);
    assert.match(stdout.at(-3), /Other Spell/);
    await assert.rejects(cli('deck:candidates', 'fixture', '--limit', '0'), /--limit must be a positive integer/);
    stdout.length = 0;
    assert.equal(await cli('collection:search', '--nonland', '--sort', 'edhrec'), 0);
    assert.deepEqual(stdout.slice(0, 2), [
      '1x Ranked Spell  — Sorcery [C] (EDHREC #7, $3.00)',
      '1x Other Spell  — Sorcery [C] (EDHREC ?, $9.00)',
    ]);
  }));

test('scryfall:refresh covers every collection, whatever MTG_COLLECTIONS says', () =>
  inWorkspace(async ({ root, cliWithEnv }) => {
    const uncachedId = '00000000-0000-4000-8000-000000000002';
    await writeFile(join(root, 'collections', 'Bulk Box.csv'), CSV.replace(FOREST_ID, uncachedId));
    await assert.rejects(
      cliWithEnv({ MTG_COLLECTIONS: 'collections/Organized.csv' }, 'scryfall:refresh', '--missing'),
      /Unexpected network access/,
    );
  }));

test('scryfall:refresh --bulk caches bulk data, then fetches only what it lacks from the card API', () =>
  inWorkspace(async ({ root, cli, stdout }) => {
    const uncachedId = '00000000-0000-4000-8000-000000000002';
    await writeFile(join(root, 'collections', 'Bulk Box.csv'), CSV.replace(FOREST_ID, uncachedId));
    const scryfallCard = (id, name) => ({ id, oracle_id: `oracle-${name}`, name, type_line: 'Sorcery' });
    const requested = [];
    globalThis.fetch = async (url, { body } = {}) => {
      requested.push(body ? JSON.parse(body).identifiers : url);
      const bulkFile = url.match(/\/bulk-data\/(\w+)$/)?.[1];
      if (bulkFile) {
        return Response.json({ jsonl_download_uri: `https://data.example/${bulkFile}`, updated_at: '2026-10-15' });
      }
      if (url.startsWith('https://data.example/')) {
        return new Response(gzipSync(`${JSON.stringify(scryfallCard(FOREST_ID, 'Forest'))}\n`));
      }
      return Response.json({ data: [scryfallCard(uncachedId, 'Japanese Forest')] });
    };
    assert.equal(await cli('scryfall:refresh', '--bulk'), 0);
    assert.deepEqual(requested.at(-1), [{ id: uncachedId }]);
    assert.deepEqual(Object.keys((await readCache(join(root, '.cache', 'cards.json'))).cards).sort(), [
      FOREST_ID,
      uncachedId,
    ]);
    assert.match(stdout.at(-1), /Cached 2 printings \(1 fetched/);
    await assert.rejects(cli('scryfall:refresh', '--bulk', '--missing'), /not both/);
  }));

test('text lists are collections, matched to cached printings', () =>
  inWorkspace(async ({ root, cli, stdout, stderr }) => {
    await rm(join(root, 'collections', 'Organized.csv'));
    await mkdir(join(root, 'collections', 'conrad'));
    await writeFile(join(root, 'collections', 'conrad', 'Binder.txt'), 'Deck\n60 Forest (TST) 1\n');
    assert.equal(await cli('deck:check', 'fixture'), 0);
    assert.equal(await cli('collection:check'), 0);
    assert.match(stdout.join('\n'), /conrad\/Binder: 1 rows, 60 copies/);
    await writeFile(join(root, 'collections', 'conrad', 'Binder.txt'), '60 Forest (TST) 1\n1 Island (TST) 2\n');
    assert.equal(await cli('collection:check'), 2);
    assert.match(stderr.at(-1), /NOT CACHED: conrad\/Binder: line 2: Island/);
    await writeFile(join(root, 'collections', 'conrad', 'Binder.csv'), CSV);
    await assert.rejects(cli('collection:check'), /are both collection conrad\/Binder; keep one/);
  }));

test('scryfall:refresh fetches text list lines by set and collector number, even with no usable cache', () =>
  inWorkspace(async ({ root, cli }) => {
    await writeFile(join(root, '.cache', 'cards.json'), '{"version":1}');
    await writeFile(join(root, 'collections', 'Binder.txt'), '1 Island (TST) 2\n1 Plains\n');
    const requested = [];
    globalThis.fetch = async (url, { body }) => {
      const { identifiers } = JSON.parse(body);
      requested.push(...identifiers);
      return Response.json({ data: [], not_found: identifiers });
    };
    assert.equal(await cli('scryfall:refresh'), 2);
    assert.deepEqual(requested.slice(0, 2), [{ set: 'tst', collector_number: '2' }, { name: 'Plains' }]);
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
    assert.deepEqual(JSON.parse(stdout.pop()).data.groups, [{ key: 'G', cards: 1, copies: 60 }]);
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

test('deck:new fills header fields from options, and the ownership policies from .env by default', () =>
  inWorkspace(async ({ root, cli, cliWithEnv, stdout }) => {
    const env = { MTG_UNLIMITED_BASICS: 'true', MTG_ALLOW_PROXIES: '' };
    const args = ['deck:new', 'elves', '--commander', 'Example Leader', '--target-bracket', '3', '--budget', '30'];
    assert.equal(await cliWithEnv(env, ...args, '--collection-source', 'collections/brad/*, collections/x'), 0);
    const deck = parse(await readFile(join(root, 'builds', 'elves', 'deck.yaml'), 'utf8'));
    assert.deepEqual(
      [deck.target_bracket, deck.budget, deck.collection_source, deck.unlimited_basics, deck.allow_proxies],
      [3, { amount: 30, currency: 'USD' }, ['collections/brad/*', 'collections/x'], true, false],
    );
    assert.match(stdout.pop(), /unlimited_basics: true\). Fill in the primer and the mainboard next/);
    assert.equal(await cliWithEnv(env, 'deck:new', 'other', '--format', 'casual-60', '--no-unlimited-basics'), 0);
    assert.equal(parse(await readFile(join(root, 'builds', 'other', 'deck.yaml'), 'utf8')).unlimited_basics, false);
    await assert.rejects(
      cli('deck:new', 'bad', '--commander', 'X', '--target-bracket', '6'),
      /--target-bracket must be 1 to 5/,
    );
    await assert.rejects(cli('deck:new', 'bad', '--commander', 'X', '--budget', 'lots'), /--budget must be an amount/);
    await assert.rejects(
      cliWithEnv({ MTG_ALLOW_PROXIES: 'yes' }, 'deck:new', 'bad', '--format', 'casual-60'),
      /true or false/,
    );
  }));
