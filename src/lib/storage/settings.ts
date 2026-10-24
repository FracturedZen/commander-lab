import { getDb } from './db'

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDb()
  const row = await db.get('settings', key)
  return row?.value as T | undefined
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('settings', { key, value, updatedAt: Date.now() })
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb()
  await db.delete('settings', key)
}

export const SETTINGS_KEYS = {
  openRouterApiKey: 'openrouter.apiKey',
  openRouterModel: 'openrouter.model',
  defaultSeatCount: 'table.seatCount',
} as const

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini'
