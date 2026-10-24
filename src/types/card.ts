/**
 * Card model used across table, decks, and local Scryfall cache.
 * Synced cards map from Scryfall default_cards (trimmed; one art per oracle_id).
 */
export interface CardRef {
  /** Scryfall `id` (UUID) or local placeholder id. */
  id: string
  /** Scryfall `oracle_id` when known. */
  oracleId?: string
  /** Display name (Scryfall `name`). */
  name: string
  /** Set code, e.g. "MH3". */
  set?: string
  collectorNumber?: string
  manaCost?: string
  /** Converted / mana value. */
  cmc?: number
  typeLine?: string
  oracleText?: string
  colors?: string[]
  colorIdentity?: string[]
  keywords?: string[]
  /** Scryfall legality string for Commander, e.g. "legal" | "banned" | "not_legal". */
  commanderLegality?: string
  imageSmall?: string
  imageNormal?: string
  /** Scryfall large art when available. */
  imageLarge?: string
  isCommander?: boolean
  /** Deck-list quantity (basics may be > 1). */
  quantity?: number
  power?: string
  toughness?: string
  layout?: string
}

/** A concrete instance on the table (tokenized card). */
export interface CardInstance {
  instanceId: string
  card: CardRef
  /** Battlefield tapped state (untap step clears). */
  tapped?: boolean
}

/** Slim row persisted in IndexedDB `cards` store. */
export type StoredCard = CardRef

export function isBasicLand(card: Pick<CardRef, 'name' | 'typeLine'>): boolean {
  const basics = new Set([
    'Plains',
    'Island',
    'Swamp',
    'Mountain',
    'Forest',
    'Wastes',
    'Snow-Covered Plains',
    'Snow-Covered Island',
    'Snow-Covered Swamp',
    'Snow-Covered Mountain',
    'Snow-Covered Forest',
  ])
  if (basics.has(card.name)) return true
  return Boolean(card.typeLine?.includes('Basic Land'))
}

export function isLand(card: Pick<CardRef, 'typeLine'>): boolean {
  return Boolean(card.typeLine?.includes('Land'))
}

export function normalizeCardName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
