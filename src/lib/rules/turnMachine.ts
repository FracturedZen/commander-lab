/**
 * Commander / MTG turn structure helpers.
 * Multiplayer Commander: every player draws on each of their turns, including the first.
 */

export type Phase =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'combat_begin'
  | 'combat_attackers'
  | 'combat_blockers'
  | 'combat_damage'
  | 'combat_end'
  | 'main2'
  | 'end'

export const PHASE_ORDER: Phase[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'combat_begin',
  'combat_attackers',
  'combat_blockers',
  'combat_damage',
  'combat_end',
  'main2',
  'end',
]

export const PHASE_LABEL: Record<Phase, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  combat_begin: 'Begin Combat',
  combat_attackers: 'Declare Attackers',
  combat_blockers: 'Declare Blockers',
  combat_damage: 'Combat Damage',
  combat_end: 'End Combat',
  main2: 'Main 2',
  end: 'End',
}

/** Default draws queued when a player's turn begins (draw step). Cards can raise/lower later. */
export const DEFAULT_TURN_DRAWS = 1

export function nextPhaseInOrder(phase: Phase): Phase | null {
  const idx = PHASE_ORDER.indexOf(phase)
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null
  return PHASE_ORDER[idx + 1]!
}

export function isCombatPhase(phase: Phase): boolean {
  return phase.startsWith('combat')
}
