import { getDb } from './db'

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await getDb()
  await db.put('blobs', { key, blob, updatedAt: Date.now() })
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await getDb()
  const row = await db.get('blobs', key)
  return row?.blob
}

export async function deleteBlob(key: string): Promise<void> {
  const db = await getDb()
  await db.delete('blobs', key)
}

export const BLOB_KEYS = {
  tableBackground: 'table.background',
} as const
