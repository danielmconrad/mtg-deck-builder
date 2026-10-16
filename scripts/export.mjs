import { roleLabels } from './deck.mjs';

// Paste-ready decklists. Each format receives the deck and printingOf(entry), which returns the
// cached printing to export for an entry, or null so the site picks its default printing. Optional
// deck.swapOut lists deck cards proposed for cutting, and deck.sideboard cards outside the deck.
// Arena-style lists have no section for swapOut, so Moxfield keeps those cards in Deck.

// Picks each entry's printing: its pinned scryfall_id, else the first owned non-proxy printing in
// the given collection rows, else any cached printing. Names with no printing are added to missing.
export function printingChooser(index, ownedRows, missing = new Set()) {
  const ownedPrintings = new Map();
  for (const row of ownedRows) {
    const card = row.isProxy ? null : index.byId.get(row.scryfallId);
    if (card && !ownedPrintings.has(card.oracleId)) ownedPrintings.set(card.oracleId, card);
  }
  return (entry) => {
    if (entry.scryfall_id) {
      const pinned = index.byId.get(entry.scryfall_id);
      if (!pinned) missing.add(entry.name);
      return pinned ?? null;
    }
    const { card } = index.lookup(entry);
    if (!card) missing.add(entry.name);
    return card ? (ownedPrintings.get(card.oracleId) ?? card) : null;
  };
}

const titleCase = (label) => label.replace(/\b\w/g, (letter) => letter.toUpperCase());

const printingSuffix = (card) => (card ? ` (${card.set.toUpperCase()}) ${card.collectorNumber}` : '');

function plainText(deck) {
  const render = (entries) => entries.map((entry) => `${entry.quantity} ${entry.name}`).join('\n');
  const commanderSection = deck.commanders.length ? `Commander\n${render(deck.commanders)}\n\n` : '';
  const section = (heading, entries) => (entries?.length ? `\n\n${heading}\n${render(entries)}` : '');
  const extraSections = section('Swap Out', deck.swapOut) + section('Sideboard', deck.sideboard);
  return `${commanderSection}${render(deck.mainboard)}${extraSections}\n`;
}

// MTG Arena's layout, which Moxfield accepts as a pasted list.
function moxfield(deck, printingOf) {
  const line = (entry) => `${entry.quantity} ${entry.name}${printingSuffix(printingOf(entry))}`;
  const section = (heading, entries) => [heading, ...entries.map(line)].join('\n');
  const sections = [
    ...(deck.commanders.length ? [section('Commander', deck.commanders)] : []),
    section('Deck', [...deck.mainboard, ...(deck.swapOut ?? [])]),
    ...(deck.sideboard?.length ? [section('Sideboard', deck.sideboard)] : []),
  ];
  return `${sections.join('\n\n')}\n`;
}

// Archidekt's line syntax: categories in brackets, with roles becoming Title Case categories
// ("ramp" becomes "Ramp"). {top} marks Commander as a premier category so Archidekt treats those
// cards as the commanders. Swap Out is a plain category, so those cards still count toward the
// deck. Sideboard is Archidekt's built-in category for cards outside the deck, so it stands alone.
function archidekt(deck, printingOf) {
  const line = (entry, categories) => {
    const tags = categories.length ? ` [${categories.join(',')}]` : '';
    return `${entry.quantity}x ${entry.name}${printingSuffix(printingOf(entry))}${tags}`;
  };
  const lines = [
    ...deck.commanders.map((entry) => line(entry, ['Commander{top}'])),
    ...deck.mainboard.map((entry) => line(entry, roleLabels(entry).map(titleCase))),
    ...(deck.swapOut ?? []).map((entry) => line(entry, ['Swap Out'])),
    ...(deck.sideboard ?? []).map((entry) => line(entry, ['Sideboard'])),
  ];
  return `${lines.join('\n')}\n`;
}

const EXPORT_FORMATS = { text: plainText, moxfield, archidekt };

export const EXPORT_FORMAT_NAMES = Object.keys(EXPORT_FORMATS);

export const PASTE_HINTS = {
  text: 'Plain list; most deck sites accept it, but commander handling varies.',
  moxfield: 'In Moxfield, create a deck and paste into Import, or replace an existing list with Bulk Edit.',
  archidekt: "In Archidekt, open a deck's Import menu, paste, and save.",
};

export function exportDeck(deck, { format = 'text', printingOf = () => null } = {}) {
  if (!Object.hasOwn(EXPORT_FORMATS, format)) {
    throw new Error(`--format must be one of: ${Object.keys(EXPORT_FORMATS).join(', ')}`);
  }
  return EXPORT_FORMATS[format](deck, printingOf);
}
