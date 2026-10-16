import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { runCli } from '../scripts/cli.mjs';
import { saveCache } from '../scripts/cards.mjs';
import { cacheOf, card } from './fixtures.mjs';

const FOREST_ID = '00000000-0000-4000-8000-000000000001';
const forest = card('Forest', { id: FOREST_ID, type_line: 'Basic Land — Forest', color_identity: ['G'], produced_mana: ['G'] });
const csv = `Name,Quantity,Scryfall ID,Set code,Collector number,Foil,Proxy\nForest,60,${FOREST_ID},TST,001,normal,false\n`;
const casual = { schema_version: 1, name: 'Fixture', format: 'casual-60', status: 'draft', allow_proxies: false, strategy: 'Fixture', commanders: [], mainboard: [{ name: 'Forest', quantity: 60 }] };

// A synthetic workspace; the network is stubbed to fail so any fetch is a test failure.
async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'mtg-cli-'));
  const originalFetch = globalThis.fetch;
  const out = [];
  const err = [];
  globalThis.fetch = () => { throw new Error('Unexpected network access'); };
  try {
    await mkdir(`${root}/collections`);
    await mkdir(`${root}/decks/fixture`, { recursive: true });
    await writeFile(`${root}/collections/Organized.csv`, csv);
    await writeFile(`${root}/collections/Precons.csv`, csv);
    await writeFile(`${root}/decks/fixture/deck.yaml`, stringify(casual));
    await saveCache(root, cacheOf(forest));
    const cli = (...args) => runCli(args, { root, write: (line) => out.push(line), warn: (line) => err.push(line) });
    await run({ root, cli, out, err });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
}

test('checks return 0 pass, 1 fail and 2 incomplete without changing inputs', () => workspace(async ({ root, cli }) => {
  const deckFile = `${root}/decks/fixture/deck.yaml`;
  assert.equal(await cli('deck:check', 'fixture'), 0);
  assert.equal(await cli('decks:check'), 0);
  assert.equal(await readFile(`${root}/collections/Organized.csv`, 'utf8'), csv);
  assert.equal(await readFile(deckFile, 'utf8'), stringify(casual));
  await writeFile(deckFile, stringify({ ...casual, mainboard: [{ name: 'Forest', quantity: 59 }] }));
  assert.equal(await cli('deck:check', 'fixture'), 1);
  await writeFile(deckFile, stringify({ ...casual, mainboard: [{ name: 'Forest', quantity: 58 }, { name: 'Missing Card', quantity: 1 }] }));
  assert.equal(await cli('deck:check', 'fixture'), 1);
  await writeFile(deckFile, stringify({ ...casual, mainboard: [{ name: 'Forest', quantity: 60 }, { name: 'Missing Card', quantity: 1 }] }));
  assert.equal(await cli('deck:check', 'fixture'), 2);
}));

test('decks:check reports a broken deck file and still checks the others', () => workspace(async ({ root, cli, out }) => {
  await mkdir(`${root}/decks/broken`);
  await writeFile(`${root}/decks/broken/deck.yaml`, 'name: [unterminated');
  assert.equal(await cli('decks:check'), 1);
  assert.match(out.join('\n'), /FAIL: broken/);
  assert.match(out.join('\n'), /PASS: fixture/);
}));

test('deck:new writes a schema-valid draft with the chosen commander and never overwrites', () => workspace(async ({ root, cli }) => {
  await assert.rejects(cli('deck:new', 'green-value'), /--commander/);
  assert.equal(await cli('deck:new', 'green-value', '--commander', 'Example Leader'), 0);
  const text = await readFile(`${root}/decks/green-value/deck.yaml`, 'utf8');
  assert.match(text, /name: Green Value/);
  assert.match(text, /- name: Example Leader/);
  assert.match(text, /mainboard: \[\]/);
  await assert.rejects(cli('deck:new', 'green-value', '--commander', 'Example Leader'), /EEXIST/);
  assert.equal(await cli('deck:new', 'mono-g', '--format', 'casual-60'), 0);
}));

test('search, stats and export write results to stdout and notes to stderr', () => workspace(async ({ cli, out, err }) => {
  assert.equal(await cli('collection:search', '--type', 'land', '--json'), 0);
  assert.deepEqual(JSON.parse(out.pop()).map(({ name, organized }) => [name, organized]), [['Forest', 60]]);
  assert.equal(await cli('deck:stats', 'fixture'), 0);
  assert.match(out.join('\n'), /Lands: 60/);
  assert.equal(await cli('deck:export', 'fixture'), 0);
  assert.equal(out.at(-1), '60 Forest');
  assert.match(err.join(), /does not validate/);
}));

test('CLI rejects unknown commands, unknown flags, path traversal and wrong argument counts', () => workspace(async ({ cli }) => {
  for (const args of [[], ['nope'], ['deck:check'], ['deck:check', '../collections'], ['deck:check', 'a', 'b'], ['collection:check', 'extra'], ['collection:search', '--bogus']]) {
    await assert.rejects(cli(...args), /Usage|slug/);
  }
  await assert.rejects(cli('collection:search', '--identity', 'G', '--commander', 'Forest'), /not both/);
}));
