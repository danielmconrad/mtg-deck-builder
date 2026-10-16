import { roleLabels } from './deck.mjs';

// Paste-ready decklists. Each format receives the deck and printingOf(entry), which returns the
// cached card for an entry with a pinned scryfall_id, or null so the site picks its default printing.

const printingSuffix = (card) => (card ? ` (${card.set.toUpperCase()}) ${card.collectorNumber}` : '');

function plainText(deck) {
  const render = (entries) => entries.map((entry) => `${entry.quantity} ${entry.name}`).join('\n');
  const commanderSection = deck.commanders.length ? `Commander\n${render(deck.commanders)}\n\n` : '';
  return `${commanderSection}${render(deck.mainboard)}\n`;
}

// MTG Arena's layout, which Moxfield accepts as a pasted list.
function moxfield(deck, printingOf) {
  const line = (entry) => `${entry.quantity} ${entry.name}${printingSuffix(printingOf(entry))}`;
  const section = (heading, entries) => [heading, ...entries.map(line)].join('\n');
  const sections = deck.commanders.length ? [section('Commander', deck.commanders)] : [];
  return `${[...sections, section('Deck', deck.mainboard)].join('\n\n')}\n`;
}

// Archidekt's line syntax: categories in brackets, with roles becoming categories. {top} marks
// Commander as a premier category so Archidekt treats those cards as the commanders.
function archidekt(deck, printingOf) {
  const line = (entry, categories) => {
    const tags = categories.length ? ` [${categories.join(',')}]` : '';
    return `${entry.quantity}x ${entry.name}${printingSuffix(printingOf(entry))}${tags}`;
  };
  const lines = [
    ...deck.commanders.map((entry) => line(entry, ['Commander{top}'])),
    ...deck.mainboard.map((entry) => line(entry, roleLabels(entry))),
  ];
  return `${lines.join('\n')}\n`;
}

const EXPORT_FORMATS = { text: plainText, moxfield, archidekt };

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
