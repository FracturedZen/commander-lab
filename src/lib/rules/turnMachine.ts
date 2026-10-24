/**
 * Commander / MTG turn structure helpers (Arena-inspired UX).
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

export type RailSegmentId = 'beg' | 'main1' | 'combat' | 'main2' | 'end'

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

/** Compact Arena ladder: Beg | Main | Combat | Main | End */
export const RAIL_SEGMENTS: {
  id: RailSegmentId
  label: string
  short: string
  phases: Phase[]
}[] = [
  { id: 'beg', label: 'Beginning', short: 'Beg', phases: ['untap', 'upkeep', 'draw'] },
  { id: 'main1', label: 'Main 1', short: 'Main', phases: ['main1'] },
  {
    id: 'combat',
    label: 'Combat',
    short: 'Combat',
    phases: [
      'combat_begin',
      'combat_attackers',
      'combat_blockers',
      'combat_damage',
      'combat_end',
    ],
  },
  { id: 'main2', label: 'Main 2', short: 'Main', phases: ['main2'] },
  { id: 'end', label: 'End', short: 'End', phases: ['end'] },
]

/** Default draws queued when a player's turn begins (draw step). */
export const DEFAULT_TURN_DRAWS = 1

/** Beginning steps that auto-resolve with no player decision in goldfish. */
export const AUTO_SKIP_PHASES: ReadonlySet<Phase> = new Set([
  'untap',
  'upkeep',
  'draw',
])

export function nextPhaseInOrder(phase: Phase): Phase | null {
  const idx = PHASE_ORDER.indexOf(phase)
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null
  return PHASE_ORDER[idx + 1]!
}

export function isCombatPhase(phase: Phase): boolean {
  return phase.startsWith('combat')
}

export function isAutoSkipPhase(phase: Phase): boolean {
  return AUTO_SKIP_PHASES.has(phase)
}

export function phaseToRailSegment(phase: Phase): RailSegmentId {
  for (const seg of RAIL_SEGMENTS) {
    if (seg.phases.includes(phase)) return seg.id
  }
  return 'main1'
}

export function firstPhaseOfSegment(id: RailSegmentId): Phase {
  const seg = RAIL_SEGMENTS.find((s) => s.id === id)
  return seg?.phases[0] ?? 'main1'
}

export function decisionPhaseOfSegment(id: RailSegmentId): Phase {
  if (id === 'combat') return 'combat_attackers'
  if (id === 'beg') return 'main1'
  return firstPhaseOfSegment(id)
}

export type PassResult =
  | { kind: 'phase'; phase: Phase; note?: string }
  | { kind: 'end_turn'; note?: string }

/**
 * Arena-style Pass: jump to the next decision point.
 *
 * Goldfish defaults:
 * - Beginning steps auto → Main 1
 * - Main 1 → Main 2 unless combat stop (or combat already entered)
 * - Combat without attackers declared → skip remaining combat → Main 2
 * - Main 2 → End turn (unless End stop → land on End)
 * - End → End turn
 */
export function computePassAdvance(opts: {
  phase: Phase
  stops: ReadonlySet<RailSegmentId>
  /** True once the active player has entered combat this turn. */
  combatEntered: boolean
  /** True if attackers were declared (keeps combat steps meaningful). */
  attackersDeclared: boolean
}): PassResult {
  const { phase, stops, combatEntered, attackersDeclared } = opts

  // Still in beginning → land on Main 1
  if (isAutoSkipPhase(phase) || phaseToRailSegment(phase) === 'beg') {
    return { kind: 'phase', phase: 'main1', note: 'to Main' }
  }

  if (phase === 'main1') {
    if (stops.has('combat') || combatEntered) {
      return {
        kind: 'phase',
        phase: 'combat_attackers',
        note: 'to Combat',
      }
    }
    if (stops.has('main2')) {
      return { kind: 'phase', phase: 'main2', note: 'to Main' }
    }
    if (stops.has('end')) {
      return { kind: 'phase', phase: 'end', note: 'to End' }
    }
    return { kind: 'phase', phase: 'main2', note: 'to Main' }
  }

  if (isCombatPhase(phase)) {
    // No attackers → collapse rest of combat to Main 2
    if (!attackersDeclared) {
      if (stops.has('main2') || !stops.has('end')) {
        return { kind: 'phase', phase: 'main2', note: 'to Main' }
      }
      return { kind: 'phase', phase: 'end', note: 'to End' }
    }
    // Attackers declared: step through remaining combat, then Main 2
    const nxt = nextPhaseInOrder(phase)
    if (!nxt || !isCombatPhase(nxt)) {
      return { kind: 'phase', phase: 'main2', note: 'to Main' }
    }
    // Jump remaining empty combat substeps to main2 for goldfish
    // (blockers/damage still stubbed — one Pass clears combat)
    return { kind: 'phase', phase: 'main2', note: 'to Main' }
  }

  if (phase === 'main2') {
    if (stops.has('end')) {
      return { kind: 'phase', phase: 'end', note: 'to End' }
    }
    return { kind: 'end_turn', note: 'End turn' }
  }

  // end
  return { kind: 'end_turn', note: 'End turn' }
}

/** Label + hint for the primary Pass button. */
export function passButtonCopy(opts: {
  phase: Phase
  stops: ReadonlySet<RailSegmentId>
  combatEntered: boolean
  attackersDeclared: boolean
}): { label: string; hint: string } {
  const result = computePassAdvance(opts)
  if (result.kind === 'end_turn') {
    return { label: 'End turn', hint: 'to next Main' }
  }
  const dest = result.phase
  if (dest === 'main1' || dest === 'main2') {
    return {
      label: 'Pass',
      hint: dest === 'main1' ? 'to Main' : 'to Main',
    }
  }
  if (isCombatPhase(dest)) {
    return { label: 'Pass', hint: 'to Combat' }
  }
  if (dest === 'end') {
    return { label: 'Pass', hint: 'to End' }
  }
  return { label: 'Pass', hint: PHASE_LABEL[dest] }
}

/** Enter combat from Main 1 (rail tap or explicit). */
export function enterCombatPhase(): Phase {
  return 'combat_attackers'
}
