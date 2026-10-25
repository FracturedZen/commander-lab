import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CardRef } from '@/types/card'
import type { Deck } from '@/types/deck'
import type { TableSessionRecord } from '@/types/game'
import type { EngineSaveRecord } from '@/engine/engineSave'

export type StoredCardRow = CardRef & { nameNorm: string }

/** IndexedDB schema for offline-first Commander Lab data. */
export interface CommanderLabDB extends DBSchema {
  decks: {
    key: string
    value: Deck
    indexes: { 'by-updated': number }
  }
  settings: {
    key: string
    value: { key: string; value: unknown; updatedAt: number }
  }
  cards: {
    key: string
    value: StoredCardRow
    indexes: {
      'by-name': string
      'by-oracle': string
      'by-name-norm': string
    }
  }
  cardMeta: {
    key: string
    value: { key: string; value: unknown; updatedAt: number }
  }
  tableSessions: {
    key: string
    value: TableSessionRecord
    indexes: { 'by-updated': number }
  }
  blobs: {
    key: string
    value: { key: string; blob: Blob; updatedAt: number }
  }
  engineSaves: {
    key: string
    value: EngineSaveRecord
    indexes: { 'by-updated': number }
  }
}

const DB_NAME = 'commander-lab'
const DB_VERSION = 5

let dbPromise: Promise<IDBPDatabase<CommanderLabDB>> | null = null

export function getDb(): Promise<IDBPDatabase<CommanderLabDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CommanderLabDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('decks')) {
          const decks = db.createObjectStore('decks', { keyPath: 'id' })
          decks.createIndex('by-updated', 'updatedAt')
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' })
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('cards')) {
            const cards = db.createObjectStore('cards', { keyPath: 'id' })
            cards.createIndex('by-name', 'name')
            cards.createIndex('by-oracle', 'oracleId')
            cards.createIndex('by-name-norm', 'nameNorm')
          }
          if (!db.objectStoreNames.contains('cardMeta')) {
            db.createObjectStore('cardMeta', { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains('tableSessions')) {
            const sessions = db.createObjectStore('tableSessions', {
              keyPath: 'id',
            })
            sessions.createIndex('by-updated', 'updatedAt')
          }
          if (!db.objectStoreNames.contains('blobs')) {
            db.createObjectStore('blobs', { keyPath: 'key' })
          }
        }
        if (oldVersion < 3 && db.objectStoreNames.contains('cards')) {
          // Re-key to one art per oracle_id — force a fresh Sync cards.
          db.deleteObjectStore('cards')
          const cards = db.createObjectStore('cards', { keyPath: 'id' })
          cards.createIndex('by-name', 'name')
          cards.createIndex('by-oracle', 'oracleId')
          cards.createIndex('by-name-norm', 'nameNorm')
          if (db.objectStoreNames.contains('cardMeta')) {
            db.deleteObjectStore('cardMeta')
            db.createObjectStore('cardMeta', { keyPath: 'key' })
          }
        }
        if (oldVersion < 4) {
          // Switch bulk source to default_cards (image_uris) — clear oracle-only cache.
          if (db.objectStoreNames.contains('cards')) {
            db.deleteObjectStore('cards')
            const cards = db.createObjectStore('cards', { keyPath: 'id' })
            cards.createIndex('by-name', 'name')
            cards.createIndex('by-oracle', 'oracleId')
            cards.createIndex('by-name-norm', 'nameNorm')
          }
          if (db.objectStoreNames.contains('cardMeta')) {
            db.deleteObjectStore('cardMeta')
            db.createObjectStore('cardMeta', { keyPath: 'key' })
          }
        }
        if (oldVersion < 5 && !db.objectStoreNames.contains('engineSaves')) {
          const saves = db.createObjectStore('engineSaves', { keyPath: 'id' })
          saves.createIndex('by-updated', 'savedAt')
        }
      },
    })
  }
  return dbPromise
}

export function resetDbPromise(): void {
  dbPromise = null
}
