import { isBasicLand, type CardRef } from '@/types/card'
import type { Deck, DeckValidity } from '@/types/deck'

/** Expand deck cards respecting quantity into a flat list. */
export function expandDeckCards(cards: CardRef[]): CardRef[] {
  const out: CardRef[] = []
  for (const c of cards) {
    const q = Math.max(1, c.quantity ?? 1)
    for (let i = 0; i < q; i++) {
      out.push({ ...c, quantity: 1 })
    }
  }
  return out
}

export function deckCardCount(deck: Pick<Deck, 'cards' | 'commander' | 'partner'>): number {
  const main = deck.cards.reduce((sum, c) => sum + Math.max(1, c.quantity ?? 1), 0)
  const cmd = (deck.commander ? 1 : 0) + (deck.partner ? 1 : 0)
  return main + cmd
}

export function commanderColorIdentity(
  commander?: CardRef,
  partner?: CardRef,
): string[] {
  const set = new Set<string>()
  for (const c of [commander, partner]) {
    for (const col of c?.colorIdentity ?? []) set.add(col)
  }
  return [...set].sort()
}

export function validateCommanderDeck(deck: Deck): DeckValidity {
  const issues: string[] = []
  const hasPartner = Boolean(deck.partner)
  const expectedTotal = 100
  const totalCards = deckCardCount(deck)

  if (!deck.commander) {
    issues.push('Missing commander')
  } else {
    if (
      deck.commander.commanderLegality &&
      deck.commander.commanderLegality !== 'legal'
    ) {
      issues.push(
        `Commander not legal in Commander (${deck.commander.commanderLegality})`,
      )
    }
    const tl = deck.commander.typeLine ?? ''
    if (tl && !tl.includes('Legendary')) {
      issues.push('Commander should be Legendary')
    }
  }

  if (deck.partner?.commanderLegality && deck.partner.commanderLegality !== 'legal') {
    issues.push(`Partner not legal (${deck.partner.commanderLegality})`)
  }

  if (totalCards !== expectedTotal) {
    issues.push(
      `Deck size ${totalCards} (expected ${expectedTotal}${hasPartner ? ' with partner' : ''})`,
    )
  }

  const ci = new Set(commanderColorIdentity(deck.commander, deck.partner))
  const seen = new Map<string, number>()

  const checkCard = (card: CardRef, where: string) => {
    const key = card.oracleId ?? card.name
    const q = Math.max(1, card.quantity ?? 1)
    seen.set(key, (seen.get(key) ?? 0) + q)

    if (card.commanderLegality && card.commanderLegality === 'banned') {
      issues.push(`Banned: ${card.name} (${where})`)
    }
    const cardCi = card.colorIdentity ?? []
    if (ci.size >= 0 && cardCi.some((col) => !ci.has(col))) {
      // Only flag CI if commander is set (otherwise CI is empty = colorless only)
      if (deck.commander) {
        issues.push(`Color identity: ${card.name}`)
      }
    }
  }

  for (const c of deck.cards) checkCard(c, 'main')
  // Singleton (except basics)
  for (const [key, count] of seen) {
    if (count <= 1) continue
    const sample =
      deck.cards.find((c) => (c.oracleId ?? c.name) === key) ??
      deck.cards.find((c) => c.name === key)
    if (sample && isBasicLand(sample)) continue
    issues.push(`Singleton violation: ${sample?.name ?? key} ×${count}`)
  }

  // Dedupe CI issues (can be many)
  const uniqueIssues = [...new Set(issues)]
  const ciIssues = uniqueIssues.filter((i) => i.startsWith('Color identity:'))
  const other = uniqueIssues.filter((i) => !i.startsWith('Color identity:'))
  const trimmed =
    ciIssues.length > 5
      ? [...other, ...ciIssues.slice(0, 5), `…and ${ciIssues.length - 5} more CI issues`]
      : [...other, ...ciIssues]

  return {
    ok: trimmed.length === 0,
    totalCards,
    expectedTotal,
    issues: trimmed,
  }
}

/** Merge a card into a list with quantity. */
export function addCardToList(list: CardRef[], card: CardRef, qty = 1): CardRef[] {
  const key = card.oracleId ?? card.id
  const idx = list.findIndex((c) => (c.oracleId ?? c.id) === key)
  if (idx >= 0) {
    const existing = list[idx]!
    const next = [...list]
    next[idx] = {
      ...existing,
      quantity: Math.max(1, existing.quantity ?? 1) + qty,
    }
    return next
  }
  return [...list, { ...card, quantity: qty }]
}

export function removeCardFromList(
  list: CardRef[],
  cardIdOrOracle: string,
  qty = 1,
): CardRef[] {
  const idx = list.findIndex(
    (c) => c.id === cardIdOrOracle || c.oracleId === cardIdOrOracle,
  )
  if (idx < 0) return list
  const existing = list[idx]!
  const current = Math.max(1, existing.quantity ?? 1)
  if (current <= qty) {
    return list.filter((_, i) => i !== idx)
  }
  const next = [...list]
  next[idx] = { ...existing, quantity: current - qty }
  return next
}
