/**
 * Display-layer helpers for Arena-like targeting / combat / mana / choices on Engine.
 * All legality still comes from Phase legal actions / waiting_for payloads.
 */

import type { PhaseGameAction } from './types'
import type { Phase as LabPhase, RailSegmentId } from '@/lib/rules/turnMachine'
import { phaseToRailSegment } from '@/lib/rules/turnMachine'

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

export type WaitingManaPayment = {
  kind: 'ManaPayment'
  player: number
  convokeMode?: unknown
}

export type WaitingManaSourceSelection = {
  kind: 'ManaSourceSelection'
  player: number
  /** Exact Phase ManaSourceSelection rows — submit ActivateManaSource as-is. */
  options: unknown[]
  convokeMode?: unknown
}

export type WaitingDiscard = {
  kind: 'Discard'
  type: 'DiscardChoice' | 'DiscardToHandSize' | 'WardDiscardChoice'
  player: number
  count: number
  cards: string[]
  upTo: boolean
}

export type WaitingModeChoice = {
  kind: 'ModeChoice'
  type: 'ModeChoice' | 'AbilityModeChoice'
  player: number
  minChoices: number
  maxChoices: number
  modeDescriptions: string[]
  allowRepeat: boolean
  unavailableModes: number[]
}

export type WaitingEffectZone = {
  kind: 'EffectZoneChoice'
  player: number
  cards: string[]
  count: number
  minCount: number
  upTo: boolean
  zone?: string
}

export type PhyrexianShardOptions =
  | { type: 'ManaOrLife' }
  | { type: 'LifeOnly' }
  | { type: 'ManaOnly' }
  | { type: string; [k: string]: unknown }

export type PhyrexianShard = {
  shardIndex: number
  color: string
  options: PhyrexianShardOptions
}

export type WaitingPhyrexian = {
  kind: 'PhyrexianPayment'
  player: number
  shards: PhyrexianShard[]
  spellObject?: number
}

export type WaitingChooseX = {
  kind: 'ChooseXValue'
  player?: number
  min: number
  max: number
  /** Exact Phase [x, cost] preview rows when present. */
  xCostPreviews: Array<[number, unknown]>
}

export type WaitingAssistChoosePlayer = {
  kind: 'AssistChoosePlayer'
  candidates: number[]
  maxGeneric: number
}

export type WaitingAssistPayment = {
  kind: 'AssistPayment'
  maxGeneric: number
  caster?: number
  chosen?: number
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
  | WaitingManaPayment
  | WaitingManaSourceSelection
  | WaitingPhyrexian
  | WaitingChooseX
  | WaitingAssistChoosePlayer
  | WaitingAssistPayment
  | WaitingDiscard
  | WaitingModeChoice
  | WaitingEffectZone
  | WaitingOther
  | null

export type CastPaymentModeType = 'Auto' | 'Manual' | 'AutoExceptSacrificialMana'

const CAST_FAMILY = new Set([
  'CastSpell',
  'CastSpellForFree',
  'CastSpellAsSneak',
  'CastSpellAsWebSlinging',
  'CastSpellAsMiracle',
  'CastSpellAsMadness',
])

const MANA_TAP_TYPES = new Set(['TapLandForMana', 'ActivateManaSource'])

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function idStr(v: unknown): string | null {
  if (typeof v === 'number' || typeof v === 'string') return String(v)
  return null
}

function numIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(idStr).filter((x): x is string => x != null)
}

export function parseWaitingFor(raw: unknown): WaitingDetail {
  if (!raw) return null
  if (typeof raw === 'string') return { kind: 'Other', type: raw }
  const r = asRecord(raw)
  if (!r || typeof r.type !== 'string') return null
  const data = asRecord(r.data) ?? r
  const type = r.type
  const player = typeof data.player === 'number' ? data.player : 0

  if (type === 'DeclareAttackers') {
    const validAttackerIds = numIds(
      data.valid_attacker_ids ?? data.validAttackerIds ?? [],
    )
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
      player,
      validAttackerIds,
      validAttackTargets,
      validAttackTargetsByAttacker,
    }
  }

  if (type === 'DeclareBlockers') {
    const validBlockerIds = numIds(
      data.valid_blocker_ids ?? data.validBlockerIds ?? [],
    )
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
      player,
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

  if (type === 'ManaPayment' || type === 'ManaAbilityManaPayment') {
    return {
      kind: 'ManaPayment',
      player: typeof data.player === 'number' ? data.player : player,
      convokeMode: data.convoke_mode ?? data.convokeMode,
    }
  }

  if (type === 'PhyrexianPayment') {
    const rawShards = Array.isArray(data.shards) ? data.shards : []
    const shards: PhyrexianShard[] = []
    for (const s of rawShards) {
      const sr = asRecord(s)
      if (!sr) continue
      const shardIndex =
        typeof sr.shard_index === 'number'
          ? sr.shard_index
          : typeof sr.shardIndex === 'number'
            ? sr.shardIndex
            : shards.length
      const color = typeof sr.color === 'string' ? sr.color : 'Colorless'
      const optRaw = asRecord(sr.options) ?? { type: 'ManaOrLife' }
      const optType = typeof optRaw.type === 'string' ? optRaw.type : 'ManaOrLife'
      shards.push({
        shardIndex,
        color,
        options: { ...optRaw, type: optType },
      })
    }
    const spellObject =
      typeof data.spell_object === 'number'
        ? data.spell_object
        : typeof data.spellObject === 'number'
          ? data.spellObject
          : undefined
    return {
      kind: 'PhyrexianPayment',
      player: typeof data.player === 'number' ? data.player : player,
      shards,
      spellObject,
    }
  }

  if (type === 'ChooseXValue') {
    const min =
      typeof data.min === 'number'
        ? data.min
        : typeof data.min_x_value === 'number'
          ? data.min_x_value
          : 0
    const max =
      typeof data.max === 'number'
        ? data.max
        : typeof data.max_x_value === 'number'
          ? data.max_x_value
          : min
    const previewsRaw = data.x_cost_previews ?? data.xCostPreviews
    const xCostPreviews: Array<[number, unknown]> = []
    if (Array.isArray(previewsRaw)) {
      for (const row of previewsRaw) {
        if (Array.isArray(row) && typeof row[0] === 'number') {
          xCostPreviews.push([row[0], row[1]])
        }
      }
    }
    return {
      kind: 'ChooseXValue',
      player: typeof data.player === 'number' ? data.player : undefined,
      min,
      max,
      xCostPreviews,
    }
  }

  if (type === 'AssistChoosePlayer') {
    const candidates = Array.isArray(data.candidates)
      ? data.candidates
          .map((n) => (typeof n === 'number' ? n : Number(n)))
          .filter((n) => Number.isFinite(n))
      : []
    const maxGeneric =
      typeof data.max_generic === 'number'
        ? data.max_generic
        : typeof data.maxGeneric === 'number'
          ? data.maxGeneric
          : 0
    return { kind: 'AssistChoosePlayer', candidates, maxGeneric }
  }

  if (type === 'AssistPayment') {
    const maxGeneric =
      typeof data.max_generic === 'number'
        ? data.max_generic
        : typeof data.maxGeneric === 'number'
          ? data.maxGeneric
          : 0
    return {
      kind: 'AssistPayment',
      maxGeneric,
      caster: typeof data.caster === 'number' ? data.caster : undefined,
      chosen: typeof data.chosen === 'number' ? data.chosen : undefined,
    }
  }

  if (type === 'ManaSourceSelection') {
    const options = Array.isArray(data.options) ? data.options : []
    return {
      kind: 'ManaSourceSelection',
      player,
      options,
      convokeMode: data.convoke_mode ?? data.convokeMode,
    }
  }

  if (
    type === 'DiscardChoice' ||
    type === 'DiscardToHandSize' ||
    type === 'WardDiscardChoice'
  ) {
    const cards = numIds(data.cards ?? [])
    const count =
      typeof data.count === 'number'
        ? data.count
        : typeof data.remaining === 'number'
          ? data.remaining
          : 1
    return {
      kind: 'Discard',
      type,
      player,
      count,
      cards,
      upTo: Boolean(data.up_to ?? data.upTo),
    }
  }

  if (type === 'ModeChoice' || type === 'AbilityModeChoice') {
    const modal = asRecord(data.modal) ?? {}
    const descs = Array.isArray(modal.mode_descriptions)
      ? (modal.mode_descriptions as unknown[]).map(String)
      : Array.isArray(modal.modeDescriptions)
        ? (modal.modeDescriptions as unknown[]).map(String)
        : []
    const unavailable = Array.isArray(data.unavailable_modes)
      ? (data.unavailable_modes as unknown[])
          .map((n) => (typeof n === 'number' ? n : Number(n)))
          .filter((n) => Number.isFinite(n))
      : Array.isArray(data.unavailableModes)
        ? (data.unavailableModes as unknown[])
            .map((n) => (typeof n === 'number' ? n : Number(n)))
            .filter((n) => Number.isFinite(n))
        : []
    return {
      kind: 'ModeChoice',
      type,
      player,
      minChoices:
        typeof modal.min_choices === 'number'
          ? modal.min_choices
          : typeof modal.minChoices === 'number'
            ? modal.minChoices
            : 1,
      maxChoices:
        typeof modal.max_choices === 'number'
          ? modal.max_choices
          : typeof modal.maxChoices === 'number'
            ? modal.maxChoices
            : Math.max(1, descs.length || 1),
      modeDescriptions: descs,
      allowRepeat: Boolean(modal.allow_repeat_modes ?? modal.allowRepeatModes),
      unavailableModes: unavailable,
    }
  }

  if (type === 'EffectZoneChoice') {
    const cards = numIds(data.cards ?? [])
    const count = typeof data.count === 'number' ? data.count : 1
    const minCount =
      typeof data.min_count === 'number'
        ? data.min_count
        : typeof data.minCount === 'number'
          ? data.minCount
          : 0
    return {
      kind: 'EffectZoneChoice',
      player,
      cards,
      count,
      minCount,
      upTo: Boolean(data.up_to ?? data.upTo),
      zone: typeof data.zone === 'string' ? data.zone : undefined,
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

export function isManaTapAction(a: PhaseGameAction): boolean {
  return MANA_TAP_TYPES.has(a.type)
}

/** Object id a TapLandForMana / ActivateManaSource taps, if present. */
export function manaTapObjectId(a: PhaseGameAction): string | null {
  if (!isManaTapAction(a)) return null
  const d = asRecord(a.data)
  const sel = asRecord(d?.selection)
  const source = asRecord(sel?.source)
  return idStr(source?.object_id ?? source?.objectId ?? sel?.source)
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
  const auto = hits.find((a) => {
    const d = asRecord(a.data)
    const pm = asRecord(d?.payment_mode)
    return !pm || pm.type === 'Auto' || pm.type === 'AutoExceptSacrificialMana'
  })
  return auto ?? hits[0] ?? null
}

export function stampPaymentMode(
  action: PhaseGameAction,
  mode: CastPaymentModeType,
): PhaseGameAction {
  if (!isCastFamily(action) && action.type !== 'ActivateAbility') return action
  const d = asRecord(action.data) ?? {}
  return {
    ...action,
    data: { ...d, payment_mode: { type: mode } },
  }
}

export function ensureAutoPayment(action: PhaseGameAction): PhaseGameAction {
  if (!isCastFamily(action) && action.type !== 'ActivateAbility') return action
  const d = asRecord(action.data) ?? {}
  const pm = asRecord(d.payment_mode)
  if (pm?.type === 'Manual') return action
  if (pm?.type === 'Auto' || pm?.type === 'AutoExceptSacrificialMana') return action
  return stampPaymentMode(action, 'Auto')
}

export function applyPaymentPref(
  action: PhaseGameAction,
  pref: CastPaymentModeType,
): PhaseGameAction {
  if (!isCastFamily(action) && action.type !== 'ActivateAbility') return action
  return stampPaymentMode(action, pref)
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

/** Object ids that currently offer a mana-tap action. */
export function manaTapObjectIds(
  actionsByObject: Record<string, PhaseGameAction[]>,
): Set<string> {
  const set = new Set<string>()
  for (const [oid, list] of Object.entries(actionsByObject)) {
    if (list.some(isManaTapAction)) set.add(oid)
  }
  return set
}

/**
 * Pick a single mana-tap action for an object.
 * Returns null when multiple distinct selections exist (open picker).
 */
export function pickManaTapAction(
  actions: PhaseGameAction[],
): PhaseGameAction | 'ambiguous' | null {
  const taps = actions.filter(isManaTapAction)
  if (taps.length === 0) return null
  if (taps.length === 1) return taps[0]!
  return 'ambiguous'
}

export function buildActivateManaSource(selection: unknown): PhaseGameAction {
  return { type: 'ActivateManaSource', data: { selection } }
}

export function buildSelectCards(cardIds: string[]): PhaseGameAction {
  return {
    type: 'SelectCards',
    data: { cards: cardIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)) },
  }
}

export function buildSelectModes(indices: number[]): PhaseGameAction {
  return { type: 'SelectModes', data: { indices } }
}

export function buildChooseX(value: number): PhaseGameAction {
  return { type: 'ChooseX', data: { value } }
}

export function buildSubmitPhyrexianChoices(
  choices: Array<{ type: 'PayLife' } | { type: 'PayMana' }>,
): PhaseGameAction {
  return { type: 'SubmitPhyrexianChoices', data: { choices } }
}

export function buildChooseAssistPlayer(player: number | null): PhaseGameAction {
  return { type: 'ChooseAssistPlayer', data: { player } }
}

export function buildCommitAssistPayment(generic: number): PhaseGameAction {
  return { type: 'CommitAssistPayment', data: { generic } }
}

export function buildSpendPoolMana(pipId: number): PhaseGameAction {
  return { type: 'SpendPoolMana', data: { pip_id: pipId } }
}

export function buildUnspendPoolMana(pipId: number): PhaseGameAction {
  return { type: 'UnspendPoolMana', data: { pip_id: pipId } }
}

/** Default per-shard choice map from Phase shard options (ManaOnly / LifeOnly / ManaOrLife). */
export function defaultPhyrexianChoices(
  shards: PhyrexianShard[],
): Map<number, 'mana' | 'life'> {
  const m = new Map<number, 'mana' | 'life'>()
  for (const s of shards) {
    m.set(s.shardIndex, s.options.type === 'LifeOnly' ? 'life' : 'mana')
  }
  return m
}

export function phyrexianChoicesPayload(
  shards: PhyrexianShard[],
  picks: Map<number, 'mana' | 'life'>,
): Array<{ type: 'PayLife' } | { type: 'PayMana' }> {
  return shards.map((s) =>
    (picks.get(s.shardIndex) ?? 'mana') === 'life'
      ? { type: 'PayLife' as const }
      : { type: 'PayMana' as const },
  )
}

export function chooseXInRange(detail: WaitingChooseX, value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= detail.min &&
    value <= detail.max &&
    detail.min <= detail.max
  )
}

export function assistPaymentInRange(
  detail: WaitingAssistPayment,
  value: number,
): boolean {
  return Number.isFinite(value) && value >= 0 && value <= detail.maxGeneric
}

export function findFlatAction(
  actions: PhaseGameAction[],
  type: string,
): PhaseGameAction | undefined {
  return actions.find((a) => a.type === type)
}

/** Display-only rail stops from real engine WaitingFor choice points. */
export function derivedEngineStops(
  waiting: WaitingDetail,
  phase: LabPhase,
): Set<RailSegmentId> {
  const stops = new Set<RailSegmentId>()
  if (!waiting) return stops
  const seg = phaseToRailSegment(phase)
  switch (waiting.kind) {
    case 'DeclareAttackers':
    case 'DeclareBlockers':
      stops.add('combat')
      break
    case 'MulliganDecision':
      stops.add('beg')
      break
    case 'ManaPayment':
    case 'ManaSourceSelection':
    case 'PhyrexianPayment':
    case 'ChooseXValue':
    case 'AssistChoosePlayer':
    case 'AssistPayment':
    case 'Discard':
    case 'ModeChoice':
    case 'EffectZoneChoice':
      stops.add(seg)
      break
    case 'Other':
      // Mark current segment when engine is waiting on something unknown
      if (waiting.type && waiting.type !== 'Priority') stops.add(seg)
      break
    default:
      break
  }
  return stops
}

export function discardReady(
  detail: WaitingDiscard,
  selected: string[],
): boolean {
  if (detail.upTo) return selected.length <= detail.count
  return selected.length === detail.count
}

export function effectZoneReady(
  detail: WaitingEffectZone,
  selected: string[],
): boolean {
  if (detail.upTo) {
    return selected.length >= detail.minCount && selected.length <= detail.count
  }
  return selected.length === detail.count
}

export function modeChoiceReady(
  detail: WaitingModeChoice,
  selected: number[],
): boolean {
  const n = selected.length
  return n >= detail.minChoices && n <= detail.maxChoices
}

/** Label a ManaSourceSelection option without inventing fields. */
export function summarizeManaSourceOption(selection: unknown, index: number): string {
  const sel = asRecord(selection)
  if (!sel) return `Source option ${index + 1}`
  const source = asRecord(sel.source)
  const oid = idStr(source?.object_id ?? source?.objectId) ?? '?'
  const manaType = sel.mana_type ?? sel.manaType
  const penalty = asRecord(sel.penalty)
  const penType = typeof penalty?.type === 'string' ? penalty.type : null
  const bits = [`#${oid}`]
  if (typeof manaType === 'string') bits.push(manaType)
  if (penType && penType !== 'None') bits.push(penType)
  return bits.join(' · ')
}
