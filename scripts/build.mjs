import { parse } from 'csv-parse/sync';
import { isBasic } from './card.mjs';
import { parseTextCollection } from './collection.mjs';
import { deckEntries, resolveEntries } from './deck.mjs';

// Physically building a deck moves its cards out of the collections they were counted in and into
// one text list of its own. planBuild chooses the copies, removeCsvCopies and removeTextCopies take
// them out of their source files, and deckCollectionText writes the deck's own list.

// Available non-proxy rows per oracle ID, and the copies available of each printing.
function rowsByCard(collections, index) {
  const rows = new Map();
  const copiesById = new Map();
  for (const row of collections.available) {
    const card = !row.isProxy && index.byId.get(row.scryfallId);
    if (!card) continue;
    rows.set(card.oracleId, [...(rows.get(card.oracleId) ?? []), row]);
    copiesById.set(row.scryfallId, (copiesById.get(row.scryfallId) ?? 0) + row.quantity);
  }
  return { rows, copiesById };
}

// The pinned printing first, then the printing with the most copies; the sort is stable, so ties keep
// collection order.
const takeOrder = (rows, printingId, copiesById) =>
  rows.toSorted(
    (first, second) =>
      Number(second.scryfallId === printingId) - Number(first.scryfallId === printingId) ||
      copiesById.get(second.scryfallId) - copiesById.get(first.scryfallId),
  );

// Chooses which collection rows supply every card in the deck, commanders included. Upgrades are not
// applied, since their adds may not be owned. A card's pinned printing is taken first, then the
// printing with the most available copies, as exports choose it, then the rest in collection order.
// Proxies are never taken: a text list can't mark them. With unlimited_basics, basics the collections
// lack come from untracked basics instead. Returns takes ({ row, card, quantity, isCommander }),
// untracked ({ card, quantity }), and problems, which mean nothing should be built.
export function planBuild(deck, collections, index) {
  const { tallies, problems } = resolveEntries(deckEntries(deck), index);
  const commanders = resolveEntries(deck.commanders, index).tallies;
  const { rows, copiesById } = rowsByCard(collections, index);
  const takes = [];
  const untracked = [];
  for (const { card, quantity, printingId } of tallies.values()) {
    let needed = quantity;
    for (const row of takeOrder(rows.get(card.oracleId) ?? [], printingId, copiesById)) {
      if (!needed) break;
      const taken = Math.min(needed, row.quantity);
      const isCommander = commanders.has(card.oracleId);
      takes.push({ row, card: index.byId.get(row.scryfallId), quantity: taken, isCommander });
      needed -= taken;
    }
    if (!needed) continue;
    if (deck.unlimited_basics && isBasic(card)) {
      untracked.push({ card: index.byId.get(printingId) ?? card, quantity: needed });
    } else {
      problems.push(`${card.name}: need ${quantity}, ${quantity - needed} non-proxy copies available`);
    }
  }
  return { takes, untracked, problems };
}

const TEXT_FINISHES = { foil: ' *F*', etched: ' *E*' };

// A text list line naming the printing and finish, which parseTextCollection reads back. Untracked
// basics have no known printing, so they're listed by name.
export const printingLine = (quantity, card, finish = 'normal') =>
  `${quantity} ${card.name} (${card.set.toUpperCase()}) ${card.collectorNumber}${TEXT_FINISHES[finish] ?? ''}`;
export const nameLine = (quantity, card) => `${quantity} ${card.name}`;

// The deck's own text list: commanders, then the rest, with copies of one printing and finish merged.
export function deckCollectionText({ takes, untracked }, heading) {
  const sections = { Commander: new Map(), Deck: new Map() };
  const add = (card, finish, quantity, isCommander = false) => {
    const lines = isCommander ? sections.Commander : sections.Deck;
    const key = `${finish ? card.id : card.name}|${finish}`;
    const line = lines.get(key) ?? { card, finish, quantity: 0 };
    line.quantity += quantity;
    lines.set(key, line);
  };
  for (const { row, card, quantity, isCommander } of takes) add(card, row.finish, quantity, isCommander);
  for (const { card, quantity } of untracked) add(card, null, quantity);
  const blocks = Object.entries(sections)
    .filter(([, lines]) => lines.size)
    .map(([title, lines]) =>
      [
        title,
        ...[...lines.values()].map(({ card, finish, quantity }) =>
          finish ? printingLine(quantity, card, finish) : nameLine(quantity, card),
        ),
      ].join('\n'),
    );
  return `// ${heading}\n${blocks.join('\n\n')}\n`;
}

// The CSV field as written, quoted only when it has to be.
const csvField = (field) => (/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);
// A record's leading blank lines and trailing line break, which a rewritten record keeps.
const RECORD_EDGES = /^((?:\r?\n)*)[^]*?((?:\r?\n)?)$/;

// Takes copies out of a ManaBox CSV: taken maps a row's position to the copies taken. Untouched
// records keep their exact text; a record with copies left is rewritten with its new quantity, and an
// emptied record is dropped. Returns null when no record is left, since an export needs one.
export function removeCsvCopies(text, taken) {
  // csv-parse's raw text drops the \n of a \r\n line break, so records are cut from the original by
  // their end offsets, which count bytes and include line breaks and skipped blank lines.
  const bytes = Buffer.from(text);
  const [header, ...records] = parse(bytes, { bom: true, skip_empty_lines: true, info: true });
  const quantityColumn = header.record.indexOf('Quantity');
  const kept = records.flatMap(({ record }, position) => {
    const segment = bytes.subarray(
      records[position - 1]?.info.bytes ?? header.info.bytes,
      records[position].info.bytes,
    );
    const left = Number(record[quantityColumn]) - (taken.get(position) ?? 0);
    if (left === Number(record[quantityColumn])) return [segment.toString()];
    if (left < 0) throw new Error(`record ${position + 2}: cannot take more copies than its ${record[quantityColumn]}`);
    if (!left) return [];
    const [, before, after] = segment.toString().match(RECORD_EDGES);
    return [`${before}${record.with(quantityColumn, String(left)).map(csvField).join(',')}${after}`];
  });
  const head = bytes.subarray(0, header.info.bytes).toString();
  const tail = bytes.subarray(records.at(-1).info.bytes).toString();
  return kept.length ? `${head}${kept.join('')}${tail}` : null;
}

const LINE_QUANTITY = /^(\s*)(\d+)/;

// Takes copies out of a text list, by line position like removeCsvCopies. Headings and comments stay.
// Returns null when no card line is left, since a list needs one.
export function removeTextCopies(text, taken) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const cardLines = parseTextCollection(text).map((row) => row.position);
  const lines = text.slice(bom.length).split(/(?<=\n)/);
  const kept = lines.flatMap((line, position) => {
    const take = taken.get(position) ?? 0;
    if (!take) return [line];
    const [, indent, quantity] = line.match(LINE_QUANTITY);
    const left = Number(quantity) - take;
    if (left < 0) throw new Error(`line ${position + 1}: cannot take more copies than its ${quantity}`);
    return left ? [line.replace(LINE_QUANTITY, `${indent}${left}`)] : [];
  });
  const emptied = cardLines.every(
    (position) => Number(lines[position].match(LINE_QUANTITY)[2]) === taken.get(position),
  );
  return emptied ? null : `${bom}${kept.join('')}`;
}
