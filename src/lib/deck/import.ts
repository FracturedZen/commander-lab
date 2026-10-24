import { getCardByName } from '@/lib/scryfall/sync'
import type { CardRef } from '@/types/card'

export type ImportLine = {
  quantity: number
  name: string
  raw: string
}

export type ImportResult = {
  commander?: CardRef
  partner?: CardRef
  cards: CardRef[]
  unresolved: string[]
  format: 'plain' | 'moxfield' | 'archidekt' | 'manabox' | 'unknown'
}

/**
 * Parse MTGO / Arena / Moxfield / Archidekt / Mana Box style text decklists.
 * Supports:
 *   1 Sol Ring
 *   1x Sol Ring
 *   Sol Ring
 *   COMMANDER: 1 Aesi, Tyrant of Gyre Strait
 *   Sideboard / Maybeboard sections ignored for Commander main.
 */
export function parseDecklistText(text: string): ImportLine[] {
  const lines = text.split(/\r?\n/)
  const out: ImportLine[] = []
  let skipSection = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('//') || line.startsWith('#')) {
      const lower = line.toLowerCase()
      skipSection =
        lower.includes('sideboard') ||
        lower.includes('maybeboard') ||
        lower.includes('wishlist')
      continue
    }
    if (/^(sideboard|maybeboard|deck|mainboard)\b/i.test(line)) {
      skipSection = /^sideboard|maybeboard/i.test(line)
      continue
    }
    if (skipSection) continue

    // COMMANDER: 1 Name  /  Commander: Name
    const cmdMatch = line.match(/^commander:\s*(?:(\d+)\s*x?\s+)?(.+)$/i)
    if (cmdMatch) {
      out.push({
        quantity: Number(cmdMatch[1] ?? 1),
        name: cleanName(cmdMatch[2]!),
        raw: rawLine,
      })
      continue
    }

    // 1 Card Name  |  1x Card Name  |  1 Card Name (SET) 123
    const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/)
    if (m) {
      out.push({
        quantity: Number(m[1]),
        name: cleanName(m[2]!),
        raw: rawLine,
      })
      continue
    }

    // Bare name
    if (/^[A-Za-z0-9]/.test(line)) {
      out.push({ quantity: 1, name: cleanName(line), raw: rawLine })
    }
  }
  return out
}

function cleanName(name: string): string {
  return name
    .replace(/\s*\[[^\]]*]\s*/g, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+\d+$/, '')
    .replace(/\s*[*★].*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectFormat(text: string): ImportResult['format'] {
  const t = text.toLowerCase()
  if (t.includes('moxfield') || /commander:/i.test(text)) return 'moxfield'
  if (t.includes('archidekt')) return 'archidekt'
  if (t.includes('manabox') || t.includes('mana box')) return 'manabox'
  if (/^\d+\s+.+/m.test(text)) return 'plain'
  return 'unknown'
}

/**
 * Resolve parsed lines against local Scryfall cache.
 * First legendary creature / planeswalker line tagged as commander if "COMMANDER:" present,
 * else caller may designate.
 */
export async function resolveImport(
  text: string,
  opts: { treatFirstLegendaryAsCommander?: boolean } = {},
): Promise<ImportResult> {
  const format = detectFormat(text)
  const lines = parseDecklistText(text)
  const unresolved: string[] = []
  const cards: CardRef[] = []
  let commander: CardRef | undefined
  let partner: CardRef | undefined

  const hasExplicitCommander = /commander:/i.test(text)

  for (const line of lines) {
    const isCmdLine = /^\s*commander:/i.test(line.raw)
    const card = await getCardByName(line.name)
    if (!card) {
      unresolved.push(line.raw.trim() || line.name)
      continue
    }
    const withQty: CardRef = { ...card, quantity: line.quantity }

    if (isCmdLine || (hasExplicitCommander && isCmdLine)) {
      if (!commander) commander = { ...card, isCommander: true, quantity: 1 }
      else if (!partner) partner = { ...card, isCommander: true, quantity: 1 }
      continue
    }

    if (
      opts.treatFirstLegendaryAsCommander &&
      !commander &&
      (card.typeLine?.includes('Legendary Creature') ||
        card.typeLine?.includes('Legendary Planeswalker'))
    ) {
      commander = { ...card, isCommander: true, quantity: 1 }
      continue
    }

    // Merge quantities
    const key = card.oracleId ?? card.id
    const idx = cards.findIndex((c) => (c.oracleId ?? c.id) === key)
    if (idx >= 0) {
      const prev = cards[idx]!
      cards[idx] = {
        ...prev,
        quantity: Math.max(1, prev.quantity ?? 1) + line.quantity,
      }
    } else {
      cards.push(withQty)
    }
  }

  return { commander, partner, cards, unresolved, format }
}

/**
 * Try fetching a public Moxfield deck URL. Often blocked by CORS in browsers —
 * on failure, return null so UI can ask user to paste export text.
 */
export async function tryFetchMoxfield(url: string): Promise<string | null> {
  const m = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i)
  if (!m) return null
  const id = m[1]
  const endpoints = [
    `https://api2.moxfield.com/v2/decks/all/${id}`,
    `https://api.moxfield.com/v2/decks/all/${id}`,
  ]
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep)
      if (!res.ok) continue
      const data = (await res.json()) as {
        name?: string
        boards?: Record<
          string,
          { cards?: Record<string, { quantity?: number; card?: { name?: string } }> }
        >
        commanders?: Record<string, { quantity?: number; card?: { name?: string } }>
        mainboard?: Record<string, { quantity?: number; card?: { name?: string } }>
      }
      const lines: string[] = []
      const pushBoard = (
        board:
          | Record<string, { quantity?: number; card?: { name?: string } }>
          | undefined,
        prefix?: string,
      ) => {
        if (!board) return
        for (const entry of Object.values(board)) {
          const name = entry.card?.name
          if (!name) continue
          const q = entry.quantity ?? 1
          lines.push(prefix ? `${prefix}${q} ${name}` : `${q} ${name}`)
        }
      }
      pushBoard(data.commanders, 'COMMANDER: ')
      pushBoard(data.boards?.commanders?.cards, 'COMMANDER: ')
      pushBoard(data.mainboard)
      pushBoard(data.boards?.mainboard?.cards)
      if (lines.length) return lines.join('\n')
    } catch {
      // CORS or network — fall through
    }
  }
  return null
}
