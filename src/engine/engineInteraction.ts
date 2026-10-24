/**
 * Display-layer helpers for Arena-like targeting / combat on Engine.
 * All legality still comes from Phase legal actions / waiting_for payloads.
 */

import type { PhaseGameAction } from './types'

export type AttackTarget =
  | { type: 'Player'; data: number }
  | { type: 'Planeswalker'; data: number }
  | { type: 'Battle'; data: number }
  | { type: string; data?: unknown }

export type WaitingCombatAttackers = {
  kind: 'DeclareAttackers'
  player: number
  validAttackerIds: string[]
  validAttackTargets: AttackTarget[]
  validAttackTargetsByAttacker?: Record<string, AttackTarget[]>
}

export type WaitingCombatBlockers = {
  kind: 'DeclareBlockers'
  player: number
  validBlockerIds: string[]
  /** blockerId → attacker object ids */
  validBlockTargets: Record<string, string[]>
}

export type WaitingMulligan = {
  kind: 'MulliganDecision'
  freeFirstMulligan?: boolean
}

export type WaitingOther = {
  kind: 'Other'
  type: string
  player?: number
}

export type WaitingDetail =
  | WaitingCombatAttackers
  | WaitingCombatBlockers
  | WaitingMulligan
  | WaitingOther
  | null

const CAST_FAMILY = new Set([
  'CastSpell',
  'CastSpellForFree',
  'CastSpellAsSneak',
  'CastSpellAsWebSlinging',
  'CastSpellAsMiracle',
  'CastSpellAsMadness',
])

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function idStr(v: unknown): string | null {
  if (typeof v === 'number' || typeof v === 'string') return String(v)
  return null
}

export function parseWaitingFor(raw: unknown): WaitingDetail {
  if (!raw) return null
  if (typeof raw === 'string') return { kind: 'Other', type: raw }
  const r = asRecord(raw)
  if (!r || typeof r.type !== 'string') return null
  const data = asRecord(r.data) ?? r
  const type = r.type

  if (type === 'DeclareAttackers') {
    const validAttackerIds = (
      (data.valid_attacker_ids as unknown[]) ??
      (data.validAttackerIds as unknown[]) ??
      []
    )
      .map(idStr)
      .filter((x): x is string => x != null)
    const validAttackTargets = (
      (data.valid_attack_targets as AttackTarget[]) ??
      (data.validAttackTargets as AttackTarget[]) ??
      []
    ).filter((t) => t && typeof t === 'object' && typeof t.type === 'string')
    const byAttRaw =
      (data.valid_attack_targets_by_attacker as Record<string, AttackTarget[]>) ??
      (data.validAttackTargetsByAttacker as Record<string, AttackTarget[]>)
    let validAttackTargetsByAttacker: Record<string, AttackTarget[]> | undefined
    if (byAttRaw && typeof byAttRaw === 'object') {
      validAttackTargetsByAttacker = {}
      for (const [k, v] of Object.entries(byAttRaw)) {
        validAttackTargetsByAttacker[String(k)] = Array.isArray(v) ? v : []
      }
    }
    return {
      kind: 'DeclareAttackers',
      player: typeof data.player === 'number' ? data.player : 0,
      validAttackerIds,
      validAttackTargets,
      validAttackTargetsByAttacker,
    }
  }

  if (type === 'DeclareBlockers') {
    const validBlockerIds = (
      (data.valid_blocker_ids as unknown[]) ??
      (data.validBlockerIds as unknown[]) ??
      []
    )
      .map(idStr)
      .filter((x): x is string => x != null)
    const rawMap =
      (data.valid_block_targets as Record<string, unknown>) ??
      (data.validBlockTargets as Record<string, unknown>) ??
      {}
    const validBlockTargets: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(rawMap)) {
      if (!Array.isArray(v)) continue
      validBlockTargets[String(k)] = v.map(idStr).filter((x): x is string => x != null)
    }
    return {
      kind: 'DeclareBlockers',
      player: typeof data.player === 'number' ? data.player : 0,
      validBlockerIds,
      validBlockTargets,
    }
  }

  if (type === 'MulliganDecision') {
    return {
      kind: 'MulliganDecision',
      freeFirstMulligan: Boolean(
        data.free_first_mulligan ?? data.freeFirstMulligan,
      ),
    }
  }

  return {
    kind: 'Other',
    type,
    player: typeof data.player === 'number' ? data.player : undefined,
  }
}

export function isCastFamily(a: PhaseGameAction): boolean {
  return CAST_FAMILY.has(a.type)
}

export function actionTargets(a: PhaseGameAction): string[] {
  const d = asRecord(a.data)
  if (!d) return []
  const t = d.targets
  if (!Array.isArray(t)) return []
  return t.map(idStr).filter((x): x is string => x != null)
}

/** True when the object's legal actions are cast variants that differ by targets. */
export function needsTargetingWizard(actions: PhaseGameAction[]): boolean {
  const casts = actions.filter(isCastFamily)
  if (casts.length < 2) {
    // Single cast with non-empty targets still needs a confirm glow path
    if (casts.length === 1 && actionTargets(casts[0]!).length > 0) return true
    return false
  }
  const signatures = new Set(casts.map((a) => actionTargets(a).join(',')))
  return signatures.size > 1 || [...signatures][0] !== ''
}

/** Union of target object ids across cast variants (for glow). */
export function unionCastTargets(actions: PhaseGameAction[]): string[] {
  const set = new Set<string>()
  for (const a of actions.filter(isCastFamily)) {
    for (const t of actionTargets(a)) set.add(t)
  }
  return [...set]
}

/** Legal next targets given already-selected prefix. */
export function nextSlotTargets(
  variants: PhaseGameAction[],
  selected: string[],
): string[] {
  const set = new Set<string>()
  for (const a of variants.filter(isCastFamily)) {
    const t = actionTargets(a)
    if (t.length < selected.length) continue
    let ok = true
    for (let i = 0; i < selected.length; i++) {
      if (t[i] !== selected[i]) {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (t.length === selected.length) continue
    const next = t[selected.length]
    if (next) set.add(next)
  }
  return [...set]
}

/** Exact-match cast action for the selected target list, prefer Auto payment. */
export function matchCastVariant(
  variants: PhaseGameAction[],
  selected: string[],
): PhaseGameAction | null {
  const hits = variants.filter((a) => {
    if (!isCastFamily(a)) return false
    const t = actionTargets(a)
    if (t.length !== selected.length) return false
    return t.every((x, i) => x === selected[i])
  })
  if (hits.length === 0) return null
  // Prefer Auto / omitted payment_mode
  const auto = hits.find((a) => {
    const d = asRecord(a.data)
    const pm = asRecord(d?.payment_mode)
    return !pm || pm.type === 'Auto' || pm.type === 'AutoExceptSacrificialMana'
  })
  return auto ?? hits[0] ?? null
}

export function ensureAutoPayment(action: PhaseGameAction): PhaseGameAction {
  if (!isCastFamily(action) && action.type !== 'ActivateAbility') return action
  const d = asRecord(action.data) ?? {}
  const pm = asRecord(d.payment_mode)
  if (pm?.type === 'Manual') return action
  if (pm?.type === 'Auto' || pm?.type === 'AutoExceptSacrificialMana') return action
  return {
    ...action,
    data: { ...d, payment_mode: { type: 'Auto' } },
  }
}

export function attackTargetsFor(
  attackerId: string,
  detail: WaitingCombatAttackers,
): AttackTarget[] {
  if (detail.validAttackTargetsByAttacker) {
    return detail.validAttackTargetsByAttacker[attackerId] ?? []
  }
  return detail.validAttackTargets
}

/** Build DeclareAttackers from selected attackers (2p / single-target path). */
export function buildDeclareAttackersAction(
  selectedAttackerIds: string[],
  detail: WaitingCombatAttackers,
): PhaseGameAction | null {
  const attacks: Array<[number, AttackTarget]> = []
  for (const id of selectedAttackerIds) {
    const targets = attackTargetsFor(id, detail)
    const target = targets[0]
    if (!target) return null
    const n = Number(id)
    if (!Number.isFinite(n)) return null
    attacks.push([n, target])
  }
  return {
    type: 'DeclareAttackers',
    data: { attacks, bands: [] },
  }
}

export function buildDeclareNoneAttackers(): PhaseGameAction {
  return { type: 'DeclareAttackers', data: { attacks: [], bands: [] } }
}

export function buildDeclareBlockersAction(
  assignments: Array<[string, string]>,
): PhaseGameAction {
  return {
    type: 'DeclareBlockers',
    data: {
      assignments: assignments.map(([b, a]) => [Number(b), Number(a)]),
    },
  }
}

export function buildDeclareNoneBlockers(): PhaseGameAction {
  return { type: 'DeclareBlockers', data: { assignments: [] } }
}

export function findMulliganActions(actions: PhaseGameAction[]): {
  keep?: PhaseGameAction
  mulligan?: PhaseGameAction
} {
  let keep: PhaseGameAction | undefined
  let mulligan: PhaseGameAction | undefined
  for (const a of actions) {
    if (a.type !== 'MulliganDecision') continue
    const d = asRecord(a.data)
    const choice = asRecord(d?.choice) ?? d
    const t = choice?.type
    if (t === 'Keep') keep = a
    if (t === 'Mulligan') mulligan = a
  }
  return { keep, mulligan }
}

/** Prefer submitting a cast variant that already has empty targets (no wizard). */
export function pickUntargetedCast(actions: PhaseGameAction[]): PhaseGameAction | null {
  const casts = actions.filter(isCastFamily)
  const empty = casts.find((a) => actionTargets(a).length === 0)
  return empty ? ensureAutoPayment(empty) : null
}
