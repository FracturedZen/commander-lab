import { getDb } from './db'
import type { TableSessionRecord } from '@/types/game'

export async function listSessions(): Promise<TableSessionRecord[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('tableSessions', 'by-updated')
  return all.reverse()
}

export async function getSession(
  id: string,
): Promise<TableSessionRecord | undefined> {
  const db = await getDb()
  return db.get('tableSessions', id)
}

export async function saveSession(
  record: TableSessionRecord,
): Promise<TableSessionRecord> {
  const db = await getDb()
  const next = { ...record, updatedAt: Date.now() }
  await db.put('tableSessions', next)
  return next
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('tableSessions', id)
}
