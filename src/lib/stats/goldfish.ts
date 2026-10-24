import { isLand, type CardRef } from '@/types/card'
import { expandDeckCards } from '@/lib/deck/legality'
import { shuffle } from '@/lib/shuffle'
import type { Deck } from '@/types/deck'

export type GoldfishOptions = {
  iterations: number
  handSize?: number
  /** Keep hand if land count in [min, max]. */
  keepLandMin?: number
  keepLandMax?: number
}

export type GoldfishResult = {
  iterations: number
  avgLandsInOpener: number
  keepRate: number
  landDistribution: Record<number, number>
  avgCmcNonLandInHand: number
  manaCurve: Record<number, number>
  sampleHands: { lands: number; kept: boolean; names: string[] }[]
}

export function runGoldfish(
  deck: Deck,
  opts: GoldfishOptions,
): GoldfishResult {
  const handSize = opts.handSize ?? 7
  const keepMin = opts.keepLandMin ?? 2
  const keepMax = opts.keepLandMax ?? 5
  const pool = buildLibrary(deck)
  if (pool.length < handSize) {
    return {
      iterations: 0,
      avgLandsInOpener: 0,
      keepRate: 0,
      landDistribution: {},
      avgCmcNonLandInHand: 0,
      manaCurve: buildManaCurve(pool),
      sampleHands: [],
    }
  }

  let landSum = 0
  let keeps = 0
  let cmcSum = 0
  let cmcCount = 0
  const landDistribution: Record<number, number> = {}
  const sampleHands: GoldfishResult['sampleHands'] = []

  for (let i = 0; i < opts.iterations; i++) {
    const shuffled = shuffle(pool)
    const hand = shuffled.slice(0, handSize)
    const lands = hand.filter((c) => isLand(c)).length
    landSum += lands
    landDistribution[lands] = (landDistribution[lands] ?? 0) + 1
    const kept = lands >= keepMin && lands <= keepMax
    if (kept) keeps++

    const nonLands = hand.filter((c) => !isLand(c))
    for (const c of nonLands) {
      cmcSum += c.cmc ?? 0
      cmcCount++
    }

    if (sampleHands.length < 8) {
      sampleHands.push({
        lands,
        kept,
        names: hand.map((c) => c.name),
      })
    }
  }

  return {
    iterations: opts.iterations,
    avgLandsInOpener: landSum / opts.iterations,
    keepRate: keeps / opts.iterations,
    landDistribution,
    avgCmcNonLandInHand: cmcCount ? cmcSum / cmcCount : 0,
    manaCurve: buildManaCurve(pool),
    sampleHands,
  }
}

function buildLibrary(deck: Deck): CardRef[] {
  const main = expandDeckCards(deck.cards)
  // Goldfish usually excludes commander from the 99 library
  return main
}

function buildManaCurve(cards: CardRef[]): Record<number, number> {
  const curve: Record<number, number> = {}
  for (const c of cards) {
    if (isLand(c)) continue
    const mv = Math.min(7, Math.floor(c.cmc ?? 0))
    curve[mv] = (curve[mv] ?? 0) + 1
  }
  return curve
}

/** Simple local heuristic tips when AI is offline. */
export function localDeckTips(deck: Deck): string[] {
  const tips: string[] = []
  const lib = buildLibrary(deck)
  const total = lib.length + (deck.commander ? 1 : 0) + (deck.partner ? 1 : 0)
  const lands = lib.filter((c) => isLand(c)).length
  const landRatio = lib.length ? lands / lib.length : 0

  if (!deck.commander) tips.push('Pick a commander — it defines color identity.')
  if (total < 100) tips.push(`Deck is short: ${total}/100 cards.`)
  if (total > 100) tips.push(`Deck is oversized: ${total}/100 cards.`)
  if (landRatio < 0.33) {
    tips.push(
      `Low land count (${lands} in 99 ≈ ${Math.round(landRatio * 100)}%). Most decks want ~35–40.`,
    )
  } else if (landRatio > 0.45) {
    tips.push(
      `High land count (${lands}). Consider more ramp/card draw if intentional.`,
    )
  } else {
    tips.push(`Land count looks reasonable (${lands} in the 99).`)
  }

  const ramp = lib.filter((c) =>
    /search your library for.*(land|Forest|Plains|Island|Swamp|Mountain)|Add \{[WUBRGC]\}/i.test(
      c.oracleText ?? '',
    ),
  ).length
  if (ramp < 8) {
    tips.push(`Only ~${ramp} obvious ramp/mana pieces detected — Commander often wants 8–12.`)
  }

  const curve = buildManaCurve(lib)
  const high = (curve[5] ?? 0) + (curve[6] ?? 0) + (curve[7] ?? 0)
  if (high > 20) {
    tips.push('Top-heavy mana curve — more 2–3 drops or ramp will help early turns.')
  }

  return tips
}
