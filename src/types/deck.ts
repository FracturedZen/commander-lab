import type { CardRef } from './card'

/** Deck object persisted in IndexedDB. */
export interface Deck {
  id: string
  name: string
  /** Primary commander (Commander format). */
  commander?: CardRef
  /** Optional partner / background / related commander. */
  partner?: CardRef
  /**
   * Main deck cards (99 with commander, or 98 with partner).
   * Basics may appear with quantity > 1; others should be singleton.
   */
  cards: CardRef[]
  createdAt: number
  updatedAt: number
  notes?: string
}

export type CreateDeckInput = {
  /** Optional stable id (sample decks). */
  id?: string
  name: string
  commander?: CardRef
  partner?: CardRef
  cards?: CardRef[]
  notes?: string
}

export type DeckValidity = {
  ok: boolean
  totalCards: number
  expectedTotal: number
  issues: string[]
}
