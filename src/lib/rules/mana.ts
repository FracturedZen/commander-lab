/**
 * Pragmatic Arena-style mana payment (v1).
 * - Parse {W}{U}{B}{R}{G}{C} and generic digits; hybrid/X best-effort (X=0).
 * - Untapped lands auto-tap to pay: basics by name, others by colorIdentity (else C).
 */

import { isBasicLand, isLand, type CardInstance, type CardRef } from '../../types/card'

export type ColorLetter = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'

export type ParsedCost = {
  W: number
  U: number
  B: number
  R: number
  G: number
  C: number
  generic: number
  /** Total pips + generic (for tax display). */
  total: number
}

const EMPTY: ParsedCost = {
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  C: 0,
  generic: 0,
  total: 0,
}

const BASIC_PRODUCES: Record<string, ColorLetter> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
  Wastes: 'C',
  'Snow-Covered Plains': 'W',
  'Snow-Covered Island': 'U',
  'Snow-Covered Swamp': 'B',
  'Snow-Covered Mountain': 'R',
  'Snow-Covered Forest': 'G',
}

/** Parse Scryfall mana_cost like "{2}{U}{U}" or "{X}{R}". X ignored (=0). Hybrid ≈ one of the two. */
export function parseManaCost(manaCost?: string, extraGeneric = 0): ParsedCost {
  const out: ParsedCost = { ...EMPTY, generic: Math.max(0, extraGeneric) }
  if (!manaCost) {
    out.total = out.generic
    return out
  }
  const tokens = manaCost.match(/\{[^}]+\}/g) ?? []
  for (const raw of tokens) {
    const t = raw.slice(1, -1).toUpperCase()
    if (t === 'X' || t === 'Y' || t === 'Z') continue
    if (t === 'W') out.W++
    else if (t === 'U') out.U++
    else if (t === 'B') out.B++
    else if (t === 'R') out.R++
    else if (t === 'G') out.G++
    else if (t === 'C') out.C++
    else if (/^\d+$/.test(t)) out.generic += Number(t)
    else if (t.includes('/')) {
      // Hybrid / phyrexian: prefer first colored letter, else generic 1
      const parts = t.split('/')
      const colored = parts.find((p) => 'WUBRG'.includes(p))
      if (colored === 'W') out.W++
      else if (colored === 'U') out.U++
      else if (colored === 'B') out.B++
      else if (colored === 'R') out.R++
      else if (colored === 'G') out.G++
      else out.generic += 1
    } else {
      out.generic += 1
    }
  }
  out.total =
    out.W + out.U + out.B + out.R + out.G + out.C + out.generic
  return out
}

/** What one mana an untapped land can make (single pip for v1). */
export function landProduces(card: CardRef): ColorLetter {
  if (BASIC_PRODUCES[card.name]) return BASIC_PRODUCES[card.name]!
  if (isBasicLand(card) && card.name.includes('Plains')) return 'W'
  if (isBasicLand(card) && card.name.includes('Island')) return 'U'
  if (isBasicLand(card) && card.name.includes('Swamp')) return 'B'
  if (isBasicLand(card) && card.name.includes('Mountain')) return 'R'
  if (isBasicLand(card) && card.name.includes('Forest')) return 'G'
  const id = (card.colorIdentity ?? card.colors ?? []).map((c) =>
    c.toUpperCase(),
  )
  if (id.includes('W')) return 'W'
  if (id.includes('U')) return 'U'
  if (id.includes('B')) return 'B'
  if (id.includes('R')) return 'R'
  if (id.includes('G')) return 'G'
  return 'C'
}

export type PaymentResult = {
  ok: boolean
  reason?: string
  /** Battlefield instance ids to tap when paying. */
  tapIds: string[]
}

/**
 * Greedy pay: assign colored pips first (exact match), then C, then remaining
 * lands cover generic. Lands may float as generic after colored needs met.
 */
export function canPayWithLands(
  manaCost: string | undefined,
  battlefield: CardInstance[],
  extraGeneric = 0,
): PaymentResult {
  const cost = parseManaCost(manaCost, extraGeneric)
  const untappedLands = battlefield.filter(
    (c) => isLand(c.card) && !c.tapped,
  )

  if (cost.total === 0) {
    return { ok: true, tapIds: [] }
  }

  if (untappedLands.length < cost.total) {
    return {
      ok: false,
      reason: 'Not enough mana',
      tapIds: [],
    }
  }

  const pools: Record<ColorLetter, CardInstance[]> = {
    W: [],
    U: [],
    B: [],
    R: [],
    G: [],
    C: [],
  }
  for (const land of untappedLands) {
    pools[landProduces(land.card)].push(land)
  }

  const tapIds: string[] = []
  const need: ColorLetter[] = ['W', 'U', 'B', 'R', 'G', 'C']
  for (const color of need) {
    let n = cost[color]
    while (n > 0) {
      const land = pools[color].pop()
      if (!land) {
        return {
          ok: false,
          reason: 'Not enough mana',
          tapIds: [],
        }
      }
      tapIds.push(land.instanceId)
      n--
    }
  }

  let generic = cost.generic
  // Any remaining untapped lands (all colors) pay generic
  const leftover: CardInstance[] = []
  for (const color of need) leftover.push(...pools[color])
  while (generic > 0) {
    const land = leftover.pop()
    if (!land) {
      return {
        ok: false,
        reason: 'Not enough mana',
        tapIds: [],
      }
    }
    tapIds.push(land.instanceId)
    generic--
  }

  return { ok: true, tapIds }
}

export type PlayGateResult = {
  allowed: boolean
  reason?: string
  tapIds?: string[]
  /** True when this play should count as the land drop. */
  countsAsLandDrop?: boolean
  /** True when casting from command zone (increment commanderCastCount). */
  countsAsCommanderCast?: boolean
}

/**
 * Land once per turn + mana payment for non-lands / commander (+2 tax per prior cast).
 */
export function checkPlayOrCast(opts: {
  card: CardRef
  from: 'hand' | 'command'
  landsPlayedThisTurn: number
  battlefield: CardInstance[]
  commanderCastCount?: number
}): PlayGateResult {
  const { card, from, landsPlayedThisTurn, battlefield } = opts
  const castCount = opts.commanderCastCount ?? 0

  if (from === 'hand' && isLand(card)) {
    if (landsPlayedThisTurn > 0) {
      return {
        allowed: false,
        reason: 'Already played a land this turn.',
      }
    }
    return { allowed: true, tapIds: [], countsAsLandDrop: true }
  }

  const tax =
    from === 'command' ? castCount * 2 : 0
  const payment = canPayWithLands(card.manaCost, battlefield, tax)
  if (!payment.ok) {
    const taxNote = tax > 0 ? ` (includes +${tax} commander tax)` : ''
    return {
      allowed: false,
      reason: `${payment.reason ?? 'Not enough mana'}${taxNote}`,
    }
  }
  return {
    allowed: true,
    tapIds: payment.tapIds,
    countsAsCommanderCast: from === 'command',
  }
}

/** True if this hand/command card is currently castable/playable. */
export function isPlayableNow(opts: {
  card: CardRef
  from: 'hand' | 'command'
  phaseOk: boolean
  landsPlayedThisTurn: number
  battlefield: CardInstance[]
  commanderCastCount?: number
}): boolean {
  if (!opts.phaseOk) return false
  return checkPlayOrCast(opts).allowed
}
