import { getDb } from '@/lib/storage/db'
import { PHASE_CDN } from './config'
import type { PhaseDeckList } from './types'

/** Mid-game Phase snapshot + deck picks for Resume (IDB). */
export type EngineSaveRecord = {
  id: string
  savedAt: number
  cardDataHash: string
  playerCount: number
  deckList: PhaseDeckList
  humanDeckId?: string
  aiDeckIds?: string[]
  /** Opaque Phase `export_game_state_json` payload. */
  stateJson: string
  label?: string
  turnNumber?: number
  phaseRaw?: string
}

export const ENGINE_SAVE_SLOT = 'midgame'

export async function putEngineSave(
  record: Omit<EngineSaveRecord, 'id' | 'savedAt'> & {
    id?: string
    savedAt?: number
  },
): Promise<EngineSaveRecord> {
  const next: EngineSaveRecord = {
    id: record.id ?? ENGINE_SAVE_SLOT,
    savedAt: record.savedAt ?? Date.now(),
    cardDataHash: record.cardDataHash,
    playerCount: record.playerCount,
    deckList: record.deckList,
    humanDeckId: record.humanDeckId,
    aiDeckIds: record.aiDeckIds,
    stateJson: record.stateJson,
    label: record.label,
    turnNumber: record.turnNumber,
    phaseRaw: record.phaseRaw,
  }
  const db = await getDb()
  await db.put('engineSaves', next)
  return next
}

export async function getEngineSave(
  id: string = ENGINE_SAVE_SLOT,
): Promise<EngineSaveRecord | undefined> {
  const db = await getDb()
  return db.get('engineSaves', id)
}

export async function deleteEngineSave(id: string = ENGINE_SAVE_SLOT): Promise<void> {
  const db = await getDb()
  await db.delete('engineSaves', id)
}

export async function listEngineSaves(): Promise<EngineSaveRecord[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('engineSaves', 'by-updated')
  return all.reverse()
}

export function saveCompatibleWithBoot(save: EngineSaveRecord): boolean {
  return save.cardDataHash === PHASE_CDN.cardDataHash
}

export function formatSaveStamp(savedAt: number): string {
  try {
    return new Date(savedAt).toLocaleString()
  } catch {
    return String(savedAt)
  }
}
