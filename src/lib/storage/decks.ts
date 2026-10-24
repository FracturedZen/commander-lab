import { getDb } from './db'
import type { CreateDeckInput, Deck } from '@/types/deck'

function newId(): string {
  return crypto.randomUUID()
}

export async function listDecks(): Promise<Deck[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('decks', 'by-updated')
  return all.reverse()
}

export async function getDeck(id: string): Promise<Deck | undefined> {
  const db = await getDb()
  return db.get('decks', id)
}

export async function createDeck(input: CreateDeckInput): Promise<Deck> {
  const now = Date.now()
  const deck: Deck = {
    id: input.id ?? newId(),
    name: input.name.trim() || 'Untitled Deck',
    commander: input.commander,
    partner: input.partner,
    cards: input.cards ?? [],
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  }
  const db = await getDb()
  await db.put('decks', deck)
  return deck
}

export async function upsertDeck(deck: Deck): Promise<Deck> {
  const db = await getDb()
  const existing = await db.get('decks', deck.id)
  const next: Deck = {
    ...deck,
    createdAt: existing?.createdAt ?? deck.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
  await db.put('decks', next)
  return next
}

export async function updateDeck(
  id: string,
  patch: Partial<Omit<Deck, 'id' | 'createdAt'>>,
): Promise<Deck | undefined> {
  const db = await getDb()
  const existing = await db.get('decks', id)
  if (!existing) return undefined
  const next: Deck = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  }
  await db.put('decks', next)
  return next
}

export async function deleteDeck(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('decks', id)
}
