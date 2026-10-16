import { CACHE_VERSION, cardIndex } from '../scripts/cards.mjs';

export const NOW = Date.parse('2026-10-15T12:00:00Z');

// A slim cached card; IDs are derived from the name unless overridden.
export function card(name, fields = {}) {
  const slug = name.toLowerCase().replace(/\W+/g, '-');
  const typeLine = fields.type_line ?? 'Sorcery';
  return {
    id: `${slug}-print`,
    oracle_id: slug,
    name,
    front_name: name,
    set: 'tst',
    collector_number: '1',
    mana_cost: '',
    cmc: 0,
    type_line: typeLine,
    front_type: typeLine,
    oracle_text: '',
    keywords: [],
    color_identity: [],
    produced_mana: [],
    legalities: { commander: 'legal' },
    prices: { usd: '1.00', eur: null },
    fetched_at: new Date(NOW).toISOString(),
    ...fields,
  };
}

export const forest = card('Forest', { type_line: 'Basic Land — Forest', color_identity: ['G'], produced_mana: ['G'], prices: { usd: '0.20', eur: null } });
export const leader = card('Example Leader', { type_line: 'Legendary Creature — Elf', mana_cost: '{2}{G}', cmc: 3, color_identity: ['G'] });
export const spell = card('Example Spell', { mana_cost: '{1}{G}', cmc: 2, color_identity: ['G'], prices: { usd: '2.50', eur: null } });

export const cacheOf = (...cards) => ({ version: CACHE_VERSION, cards: Object.fromEntries(cards.map((value) => [value.id, value])) });
export const indexOf = (...cards) => cardIndex(cacheOf(...cards));
export const row = (value, quantity, proxy = false) => ({ name: value.name, quantity, scryfallId: value.id, proxy });
export const entry = (name, quantity = 1, extra = {}) => ({ name, quantity, ...extra });
