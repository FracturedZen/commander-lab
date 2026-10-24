/**
 * Which zone-to-zone moves are legal under Strict rules vs sandbox.
 * Pending actions (mill, tutor, return from GY, etc.) temporarily unlock paths.
 */

import type { Phase } from './turnMachine'
import type { ZoneName } from '@/types/game'

export type PendingActionType =
  | 'draw'
  | 'mill'
  | 'tutor'
  | 'exileFromLibrary'
  | 'putFromLibrary'
  | 'discard'
  | 'returnFromGy'
  | 'returnFromExile'
  | 'putFromGy'

export interface PendingAction {
  id: string
  type: PendingActionType
  /** How many cards this effect still allows. */
  count: number
  playerId: string
  /** Optional destination override for tutor/put effects. */
  toZone?: ZoneName
  label?: string
}

export type MoveCheck = {
  allowed: boolean
  reason?: string
  /** If a pending action was consumed, its id. */
  consumeActionId?: string
}

const MAIN_PHASES: Phase[] = ['main1', 'main2']

function findAction(
  pending: PendingAction[],
  playerId: string,
  types: PendingActionType[],
): PendingAction | undefined {
  return pending.find(
    (a) => a.playerId === playerId && a.count > 0 && types.includes(a.type),
  )
}

/**
 * Baseline + effect-queue legality for moving one card from → to.
 * Sandbox (rulesStrict=false): everything allowed.
 */
export function checkZoneMove(opts: {
  from: ZoneName
  to: ZoneName
  rulesStrict: boolean
  phase: Phase
  playerId: string
  pendingActions: PendingAction[]
  /** True if the card is a commander (command zone casting / death). */
  isCommander?: boolean
  mulliganOpen?: boolean
}): MoveCheck {
  const { from, to, rulesStrict, phase, playerId, pendingActions, isCommander } =
    opts

  if (from === to) {
    return { allowed: false, reason: 'Already in that zone.' }
  }

  if (!rulesStrict) {
    return { allowed: true }
  }

  // --- Always-OK commander aids ---
  if (from === 'command' && to === 'battlefield') {
    return { allowed: true }
  }
  if (from === 'battlefield' && to === 'command' && isCommander) {
    return { allowed: true }
  }
  // Commander dies → GY then often to command; allow BF → GY and GY → command for commanders
  if (from === 'battlefield' && to === 'graveyard') {
    return { allowed: true }
  }
  if (from === 'battlefield' && to === 'exile') {
    return { allowed: true }
  }
  if (
    from === 'graveyard' &&
    to === 'command' &&
    isCommander
  ) {
    return { allowed: true }
  }

  // Cast / play from hand → battlefield (prefer main phase)
  if (from === 'hand' && to === 'battlefield') {
    if (MAIN_PHASES.includes(phase)) {
      return { allowed: true }
    }
    return {
      allowed: false,
      reason: 'You can only put cards onto the battlefield during a main phase (for now).',
    }
  }

  // Hand → graveyard: only with pending discard (or mulligan window handled separately)
  if (from === 'hand' && to === 'graveyard') {
    const act = findAction(pendingActions, playerId, ['discard'])
    if (act) {
      return { allowed: true, consumeActionId: act.id }
    }
    return {
      allowed: false,
      reason: 'Needs a discard effect. (No free graveyard dumping under strict rules.)',
    }
  }

  // Hand → exile (rare; treat like effect-gated)
  if (from === 'hand' && to === 'exile') {
    return {
      allowed: false,
      reason: 'Needs a card effect that exiles from hand.',
    }
  }

  // Hand → library / command: blocked
  if (from === 'hand' && (to === 'library' || to === 'command')) {
    if (to === 'command' && isCommander) return { allowed: true }
    return {
      allowed: false,
      reason: 'Needs a card effect for that zone change.',
    }
  }

  // Library → anywhere: needs draw/mill/tutor/put pending (draw step uses resolveDraws, not this)
  if (from === 'library') {
    if (to === 'hand') {
      const act = findAction(pendingActions, playerId, ['draw', 'tutor'])
      if (act) return { allowed: true, consumeActionId: act.id }
      return {
        allowed: false,
        reason: 'Needs a draw or tutor effect. (Turn draws happen automatically on the draw step.)',
      }
    }
    if (to === 'graveyard') {
      const act = findAction(pendingActions, playerId, ['mill'])
      if (act) return { allowed: true, consumeActionId: act.id }
      return {
        allowed: false,
        reason: 'Needs a mill effect. No free “top → graveyard.”',
      }
    }
    if (to === 'exile') {
      const act = findAction(pendingActions, playerId, [
        'exileFromLibrary',
        'tutor',
      ])
      if (act) return { allowed: true, consumeActionId: act.id }
      return {
        allowed: false,
        reason: 'Needs an exile-from-library or tutor effect.',
      }
    }
    if (to === 'battlefield') {
      const act = findAction(pendingActions, playerId, [
        'putFromLibrary',
        'tutor',
      ])
      if (act && (!act.toZone || act.toZone === 'battlefield')) {
        return { allowed: true, consumeActionId: act.id }
      }
      return {
        allowed: false,
        reason: 'Needs a “put onto battlefield” or tutor effect.',
      }
    }
    return {
      allowed: false,
      reason: 'Library access needs a card effect under strict rules.',
    }
  }

  // Graveyard → hand / BF / library
  if (from === 'graveyard') {
    if (to === 'hand' || to === 'library') {
      const act = findAction(pendingActions, playerId, ['returnFromGy'])
      if (act) return { allowed: true, consumeActionId: act.id }
      return {
        allowed: false,
        reason: 'Needs a return-from-graveyard effect.',
      }
    }
    if (to === 'battlefield') {
      const act = findAction(pendingActions, playerId, [
        'putFromGy',
        'returnFromGy',
      ])
      if (act) return { allowed: true, consumeActionId: act.id }
      return {
        allowed: false,
        reason: 'Needs a reanimate / put-from-graveyard effect.',
      }
    }
    if (to === 'exile') {
      // Free exile from GY is sometimes done as a shortcut; keep gated
      return {
        allowed: false,
        reason: 'Needs an exile-from-graveyard effect.',
      }
    }
  }

  // Exile → hand / BF
  if (from === 'exile') {
    const act = findAction(pendingActions, playerId, ['returnFromExile'])
    if (act && (to === 'hand' || to === 'battlefield')) {
      return { allowed: true, consumeActionId: act.id }
    }
    return {
      allowed: false,
      reason: 'Needs a return-from-exile effect.',
    }
  }

  // Command → elsewhere (non-BF already handled)
  if (from === 'command') {
    return {
      allowed: false,
      reason: 'Commander usually goes to the battlefield when cast.',
    }
  }

  return {
    allowed: false,
    reason: 'That zone change needs a card effect under strict rules.',
  }
}

/** Destinations the UI should offer for a selected card. */
export function legalDestinations(opts: {
  from: ZoneName
  rulesStrict: boolean
  phase: Phase
  playerId: string
  pendingActions: PendingAction[]
  isCommander?: boolean
}): { zone: ZoneName; reason?: string }[] {
  const all: ZoneName[] = [
    'hand',
    'battlefield',
    'graveyard',
    'exile',
    'command',
    'library',
  ]
  const out: { zone: ZoneName; reason?: string }[] = []
  for (const to of all) {
    if (to === opts.from) continue
    const check = checkZoneMove({ ...opts, to })
    if (check.allowed) out.push({ zone: to })
  }
  return out
}

export function describeBlockedMove(from: ZoneName, to: ZoneName): string {
  return `Can’t move ${from} → ${to} without an effect.`
}

/**
 * Arena-style “can activate / can take a legal action now” for glow highlight.
 * Pragmatic v1 — no Oracle parser. GY/exile/library only glow when a matching
 * pendingAction exists (even in sandbox), so we don’t light up every card.
 */
export function cardCanActivate(opts: {
  zone: ZoneName
  rulesStrict: boolean
  phase: Phase
  playerId: string
  pendingActions: PendingAction[]
  isCommander?: boolean
  tapped?: boolean
  /** True when this seat is the turn’s active player. */
  isActivePlayer: boolean
  gameActive: boolean
  mulliganOpen?: boolean
}): boolean {
  const {
    zone,
    rulesStrict,
    phase,
    playerId,
    pendingActions,
    isCommander,
    tapped,
    isActivePlayer,
    gameActive,
  } = opts

  if (!gameActive || !isActivePlayer) return false

  const hasPending = (types: PendingActionType[]) =>
    Boolean(findAction(pendingActions, playerId, types))

  // Hand: playable this main phase, or discard target
  if (zone === 'hand') {
    if (hasPending(['discard'])) return true
    const play = checkZoneMove({
      from: 'hand',
      to: 'battlefield',
      rulesStrict,
      phase,
      playerId,
      pendingActions,
      isCommander,
    })
    return play.allowed
  }

  // Command: cast commander → BF (prefer main phase under strict)
  if (zone === 'command') {
    if (rulesStrict && !MAIN_PHASES.includes(phase)) return false
    const cast = checkZoneMove({
      from: 'command',
      to: 'battlefield',
      rulesStrict,
      phase,
      playerId,
      pendingActions,
      isCommander: true,
    })
    return cast.allowed
  }

  // Battlefield: untapped permanent = tap-activation stand-in on your turn
  if (zone === 'battlefield') {
    if (!tapped) return true
    return false
  }

  // Graveyard: only when a return/reanimate effect is queued
  if (zone === 'graveyard') {
    if (isCommander) {
      const toCmd = checkZoneMove({
        from: 'graveyard',
        to: 'command',
        rulesStrict,
        phase,
        playerId,
        pendingActions,
        isCommander: true,
      })
      if (toCmd.allowed) return true
    }
    return hasPending(['returnFromGy', 'putFromGy'])
  }

  // Exile: only with return-from-exile pending
  if (zone === 'exile') {
    return hasPending(['returnFromExile'])
  }

  // Library: top-access effects (glow applied to visible stack chips by caller)
  if (zone === 'library') {
    return hasPending([
      'draw',
      'mill',
      'tutor',
      'exileFromLibrary',
      'putFromLibrary',
    ])
  }

  return false
}
