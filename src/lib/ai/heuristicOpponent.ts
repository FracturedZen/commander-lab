import { isLand, type CardRef } from '@/types/card'
import type { CardInstance } from '@/types/card'
import type { PlayerState } from '@/types/game'

export type HeuristicAction =
  | { type: 'play_land'; instanceId: string; name: string }
  | { type: 'cast'; instanceId: string; name: string; cmc: number }
  | { type: 'pass'; reason: string }

/**
 * Very simple AI opponent stub:
 * - Prefer playing a land if none played (caller tracks landsPlayedThisTurn)
 * - Then cast lowest CMC non-land that is <= availableMana
 */
export function chooseHeuristicAction(
  player: PlayerState,
  opts: { availableMana: number; landsPlayedThisTurn: number },
): HeuristicAction {
  const hand = player.zones.hand
  if (opts.landsPlayedThisTurn < 1) {
    const land = hand.find((c) => isLand(c.card))
    if (land) {
      return {
        type: 'play_land',
        instanceId: land.instanceId,
        name: land.card.name,
      }
    }
  }

  const castables = hand
    .filter((c) => !isLand(c.card))
    .filter((c) => (c.card.cmc ?? 99) <= opts.availableMana)
    .sort((a, b) => (a.card.cmc ?? 0) - (b.card.cmc ?? 0))

  const pick = castables[0]
  if (pick) {
    return {
      type: 'cast',
      instanceId: pick.instanceId,
      name: pick.card.name,
      cmc: pick.card.cmc ?? 0,
    }
  }

  return {
    type: 'pass',
    reason:
      opts.availableMana <= 0
        ? 'No mana and no land to play'
        : 'No CMC-legal spell in hand',
  }
}

export function countBattlefieldLands(player: PlayerState): number {
  return player.zones.battlefield.filter((c) => isLand(c.card)).length
}

export function cardFromInstance(c: CardInstance): CardRef {
  return c.card
}
