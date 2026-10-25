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

export type CombatDamageSlot = {
  blockerId: string
  lethalMinimum: number
}

export type CombatDamageAssignmentMode = 'Normal' | 'AsThoughUnblocked'

export type WaitingAssignCombatDamage = {
  kind: 'AssignCombatDamage'
  player: number
  attackerId: string
  totalDamage: number
  blockers: CombatDamageSlot[]
  /** Phase assignment_modes (always includes Normal when present). */
  assignmentModes: CombatDamageAssignmentMode[]
  /** Phase trample: Standard | OverPlaneswalkers | null. */
  trample: 'Standard' | 'OverPlaneswalkers' | null
  defendingPlayer: number
  attackTarget?: AttackTarget
  pwLoyalty?: number
  pwController?: number
}

export type WaitingAssignBlockerDamage = {
  kind: 'AssignBlockerDamage'
  player: number
  blockerId: string
  totalDamage: number
  /** Attackers this blocker is blocking — divide total among them. */
  attackers: string[]
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

export type LibraryBipartKind = 'ScryChoice' | 'SurveilChoice'

/** Scry / Surveil: SelectCards carries ordered keep-on-top; remainder → bottom / GY. */
export type WaitingLibraryBipart = {
  kind: 'LibraryBipart'
  type: LibraryBipartKind
  player: number
  cards: string[]
}

export type ReorderCardsKind =
  | 'RippleBottomOrder'
  | 'RevealUntilBottomOrder'
  | 'DigRestSplitChoice'
  | 'ArrangePlanarDeckTopChoice'

/**
 * Full-permutation SelectCards kinds.
 * DigRestSplit: leading `topCount` → library top; rest → bottom.
 * ArrangePlanar: keep exactly `exactKeepCount` on top (subset order), rest bottom.
 */
export type WaitingReorderCards = {
  kind: 'ReorderCards'
  type: ReorderCardsKind
  player: number
  cards: string[]
  /** DigRestSplitChoice.top_count — first N of submitted order go on top. */
  topCount?: number
  /** DigRestSplit scope OrderOnly — may not cross the top/bottom boundary. */
  orderOnly?: boolean
  /** ArrangePlanarDeckTopChoice.keep_on_top — exact keep subset size. */
  exactKeepCount?: number
}

export type CardPickKind =
  | 'SearchChoice'
  | 'SearchPartitionChoice'
  | 'DigChoice'
  | 'RevealChoice'
  | 'ChooseFromZoneChoice'

/** Subset SelectCards: search / dig / reveal / zone / partition. */
export type WaitingCardPick = {
  kind: 'CardPick'
  type: CardPickKind
  player: number
  cards: string[]
  count: number
  upTo: boolean
  /** RevealChoice: empty SelectCards declines. */
  optional?: boolean
  /** SearchChoice ordering_hint === OrderedToLibraryTop — selection order matters. */
  ordered?: boolean
}

export type TriggerSummary = {
  sourceId: string
  sourceName: string
  description: string
}

export type WaitingOrderTriggers = {
  kind: 'OrderTriggers'
  player: number
  triggers: TriggerSummary[]
}

export type ReplacementCandidate = {
  sourceId: string
  sourceName: string
  description: string
}

export type WaitingReplacement = {
  kind: 'ReplacementChoice'
  player: number
  candidateCount: number
  candidates: ReplacementCandidate[]
  /** Phase ReplacementChoiceKind.type — Order | OptionalBranch | SearchFoundDestination */
  kindType: string
  lastAppliedDecides: boolean
  /** True when remember_identity is present (ChooseReplacementAndRemember available). */
  canRemember: boolean
}

export type WaitingPayAmount = {
  kind: 'PayAmountChoice'
  player: number
  min: number
  max: number
  sourceId?: string
  /** Phase PayableResource.type string (Energy, ManaGeneric, …). */
  resourceType: string
}


export type TargetRefWire =
  | { kind: 'Object'; id: string }
  | { kind: 'Player'; id: number }

export type WaitingCrewLike = {
  kind: 'CrewLike'
  type: 'CrewVehicle' | 'SaddleMount'
  player: number
  subjectId: string
  /** Phase crew_power / saddle_power threshold. */
  need: number
  eligible: string[]
  /** Index-aligned Phase contributions (sum these, never raw power). */
  contributions: number[]
}

export type WaitingAttachPick = {
  kind: 'AttachPick'
  type: 'EquipTarget' | 'StationTarget'
  player: number
  subjectId: string
  eligible: string[]
}

export type WaitingOptionalCost = {
  kind: 'OptionalCostChoice'
  player: number
  /** Display-only origin / cost tag from Phase. */
  costLabel: string
  timesKicked: number
  origin: string
}

export type WaitingUnlessPayment = {
  kind: 'UnlessPayment'
  player: number
  costLabel: string
  effectDescription?: string
}

export type WaitingUnlessChooseCost = {
  kind: 'UnlessPaymentChooseCost'
  player: number
  costLabels: string[]
  effectDescription?: string
}

export type WaitingOptionalEffect = {
  kind: 'OptionalEffect'
  type: 'OptionalEffectChoice' | 'OpponentMayChoice' | 'TributeChoice'
  player: number
  sourceId?: string
  description: string
  /** Tribute counter count when type is TributeChoice. */
  tributeCount?: number
}

export type WaitingTargetStep = {
  kind: 'TargetStep'
  type: 'TargetSelection' | 'TriggerTargetSelection'
  player: number
  currentSlot: number
  slotCount: number
  optional: boolean
  legal: TargetRefWire[]
  modeLabel?: string
  sourceId?: string
  description?: string
}

export type WaitingMultiTarget = {
  kind: 'MultiTargetSelection'
  player: number
  legal: string[]
  minTargets: number
  maxTargets: number
}

export type WaitingObjectPick = {
  kind: 'ObjectPick'
  type: 'PairChoice' | 'CopyTargetChoice' | 'DamageSourceChoice'
  player: number
  sourceId?: string
  choices: string[]
  /** PairChoice / empty CopyTarget: ChooseTarget{None} / ChoosePair{None} allowed. */
  allowSkip: boolean
}

export type WaitingOther = {
  kind: 'Other'
  type: string
  player?: number
}

export type WaitingDetail =
  | WaitingCombatAttackers
  | WaitingCombatBlockers
  | WaitingAssignCombatDamage
  | WaitingAssignBlockerDamage
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
  | WaitingLibraryBipart
  | WaitingReorderCards
  | WaitingCardPick
  | WaitingOrderTriggers
  | WaitingReplacement
  | WaitingPayAmount
  | WaitingCrewLike
  | WaitingAttachPick
  | WaitingOptionalCost
  | WaitingUnlessPayment
  | WaitingUnlessChooseCost
  | WaitingOptionalEffect
  | WaitingTargetStep
  | WaitingMultiTarget
  | WaitingObjectPick
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


function parseTargetRef(raw: unknown): TargetRefWire | null {
  if (raw == null) return null
  if (typeof raw === 'number' || typeof raw === 'string') {
    return { kind: 'Object', id: String(raw) }
  }
  const r = asRecord(raw)
  if (!r) return null
  // Externally tagged: { Object: id } / { Player: n }
  if ('Object' in r) {
    const id = idStr(r.Object)
    return id ? { kind: 'Object', id } : null
  }
  if ('Player' in r) {
    const p = r.Player
    if (typeof p === 'number') return { kind: 'Player', id: p }
    if (typeof p === 'string' && Number.isFinite(Number(p))) return { kind: 'Player', id: Number(p) }
  }
  // Internally tagged fallback: { type: 'Object', data } / { type: 'Player', data }
  const t = typeof r.type === 'string' ? r.type : null
  if (t === 'Object') {
    const id = idStr(r.data ?? r.id ?? r.object_id ?? r.objectId)
    return id ? { kind: 'Object', id } : null
  }
  if (t === 'Player') {
    const p = r.data ?? r.id ?? r.player
    if (typeof p === 'number') return { kind: 'Player', id: p }
    if (typeof p === 'string' && Number.isFinite(Number(p))) return { kind: 'Player', id: Number(p) }
  }
  return null
}

function parseTargetRefs(raw: unknown): TargetRefWire[] {
  if (!Array.isArray(raw)) return []
  const out: TargetRefWire[] = []
  for (const x of raw) {
    const t = parseTargetRef(x)
    if (t) out.push(t)
  }
  return out
}

/** Display-only AbilityCost / AdditionalCost / nested cost label from Phase JSON. */
export function summarizeCostLabel(raw: unknown): string {
  if (raw == null) return 'cost'
  if (typeof raw === 'string') return raw
  const r = asRecord(raw)
  if (!r) return 'cost'
  const t = typeof r.type === 'string' ? r.type : null
  if (!t) return 'cost'
  const data = r.data !== undefined ? r.data : r
  const d = asRecord(data) ?? (typeof data === 'object' ? null : null)
  switch (t) {
    case 'Mana': {
      const cost = asRecord(d?.cost ?? r.cost)
      if (!cost) return 'mana'
      const bits: string[] = []
      for (const k of ['white', 'blue', 'black', 'red', 'green', 'colorless', 'generic', 'W', 'U', 'B', 'R', 'G', 'C', 'X']) {
        const v = cost[k]
        if (typeof v === 'number' && v > 0) bits.push(`${k}${v}`)
      }
      return bits.length ? `{${bits.join('')}}` : 'mana'
    }
    case 'ManaDynamic':
      return 'mana (X)'
    case 'Tap':
      return '{T}'
    case 'Untap':
      return '{Q}'
    case 'Loyalty':
      return `loyalty ${d?.amount ?? r.amount ?? '?'}`
    case 'PayLife':
      return `pay life`
    case 'PayEnergy':
      return 'pay energy'
    case 'Discard':
      return 'discard'
    case 'Sacrifice':
      return 'sacrifice'
    case 'Exile':
      return 'exile'
    case 'Optional': {
      const inner = d?.cost ?? asRecord(data)?.cost ?? r.cost
      return `optional ${summarizeCostLabel(inner)}`
    }
    case 'Kicker': {
      const costs = Array.isArray(d?.costs) ? d!.costs : Array.isArray(r.costs) ? r.costs : []
      const labels = costs.map(summarizeCostLabel)
      return labels.length ? `kicker ${labels.join(' / ')}` : 'kicker'
    }
    case 'Choice':
      return 'choice cost'
    case 'Required':
      return summarizeCostLabel(data)
    default:
      return t
  }
}

export function targetRefToWire(ref: TargetRefWire): unknown {
  if (ref.kind === 'Object') return { Object: Number(ref.id) }
  return { Player: ref.id }
}

export function contributionOf(
  eligible: string[],
  contributions: number[],
  id: string,
): number {
  const i = eligible.indexOf(id)
  if (i < 0) return 0
  if (contributions.length === 0) return 1 // legacy soft gate; engine still validates
  return contributions[i] ?? 0
}

export function selectedContributionTotal(
  eligible: string[],
  contributions: number[],
  selected: string[],
): number {
  let n = 0
  for (const id of selected) n += contributionOf(eligible, contributions, id)
  return n
}

export function crewLikeReady(detail: WaitingCrewLike, selected: string[]): boolean {
  if (selected.length === 0) return detail.need <= 0
  for (const id of selected) {
    if (!detail.eligible.includes(id)) return false
  }
  return selectedContributionTotal(detail.eligible, detail.contributions, selected) >= detail.need
}

export function multiTargetReady(
  detail: WaitingMultiTarget,
  selected: string[],
): boolean {
  if (selected.length < detail.minTargets || selected.length > detail.maxTargets) return false
  for (const id of selected) {
    if (!detail.legal.includes(id)) return false
  }
  return true
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

  if (type === 'AssignCombatDamage') {
    const blockersRaw = Array.isArray(data.blockers) ? data.blockers : []
    const blockers: CombatDamageSlot[] = []
    for (const raw of blockersRaw) {
      const b = asRecord(raw)
      if (!b) continue
      const blockerId = idStr(b.blocker_id ?? b.blockerId)
      if (!blockerId) continue
      const lethal =
        typeof b.lethal_minimum === 'number'
          ? b.lethal_minimum
          : typeof b.lethalMinimum === 'number'
            ? b.lethalMinimum
            : 0
      blockers.push({ blockerId, lethalMinimum: lethal })
    }
    const modesRaw = Array.isArray(data.assignment_modes)
      ? data.assignment_modes
      : Array.isArray(data.assignmentModes)
        ? data.assignmentModes
        : ['Normal']
    const assignmentModes: CombatDamageAssignmentMode[] = []
    for (const m of modesRaw) {
      if (m === 'Normal' || m === 'AsThoughUnblocked') assignmentModes.push(m)
      else if (typeof m === 'string') {
        // ignore unknown — Phase is authority
      }
    }
    if (assignmentModes.length === 0) assignmentModes.push('Normal')

    let trample: WaitingAssignCombatDamage['trample'] = null
    const tramp = data.trample
    if (tramp === 'Standard' || tramp === 'OverPlaneswalkers') trample = tramp
    else {
      const tr = asRecord(tramp)
      if (tr && typeof tr.type === 'string') {
        if (tr.type === 'Standard' || tr.type === 'OverPlaneswalkers') {
          trample = tr.type
        }
      }
    }

    const attackerId = idStr(data.attacker_id ?? data.attackerId) ?? '?'
    const totalDamage =
      typeof data.total_damage === 'number'
        ? data.total_damage
        : typeof data.totalDamage === 'number'
          ? data.totalDamage
          : 0
    const defendingPlayer =
      typeof data.defending_player === 'number'
        ? data.defending_player
        : typeof data.defendingPlayer === 'number'
          ? data.defendingPlayer
          : 0
    const atRaw = data.attack_target ?? data.attackTarget
    const attackTarget =
      atRaw && typeof atRaw === 'object' && typeof (atRaw as AttackTarget).type === 'string'
        ? (atRaw as AttackTarget)
        : undefined
    const pwLoyalty =
      typeof data.pw_loyalty === 'number'
        ? data.pw_loyalty
        : typeof data.pwLoyalty === 'number'
          ? data.pwLoyalty
          : undefined
    const pwController =
      typeof data.pw_controller === 'number'
        ? data.pw_controller
        : typeof data.pwController === 'number'
          ? data.pwController
          : undefined
    return {
      kind: 'AssignCombatDamage',
      player,
      attackerId,
      totalDamage,
      blockers,
      assignmentModes,
      trample,
      defendingPlayer,
      attackTarget,
      pwLoyalty,
      pwController,
    }
  }

  if (type === 'AssignBlockerDamage') {
    const blockerId = idStr(data.blocker_id ?? data.blockerId) ?? '?'
    const totalDamage =
      typeof data.total_damage === 'number'
        ? data.total_damage
        : typeof data.totalDamage === 'number'
          ? data.totalDamage
          : 0
    const attackers = numIds(data.attackers ?? [])
    return {
      kind: 'AssignBlockerDamage',
      player,
      blockerId,
      totalDamage,
      attackers,
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

  if (type === 'ScryChoice' || type === 'SurveilChoice') {
    return {
      kind: 'LibraryBipart',
      type,
      player,
      cards: numIds(data.cards ?? []),
    }
  }

  if (
    type === 'RippleBottomOrder' ||
    type === 'RevealUntilBottomOrder' ||
    type === 'DigRestSplitChoice' ||
    type === 'ArrangePlanarDeckTopChoice'
  ) {
    const cards = numIds(data.cards ?? [])
    const scope = asRecord(data.scope)
    const scopeType = typeof scope?.type === 'string' ? scope.type : typeof data.scope === 'string' ? data.scope : null
    const topCount =
      typeof data.top_count === 'number'
        ? data.top_count
        : typeof data.topCount === 'number'
          ? data.topCount
          : undefined
    const exactKeepCount =
      typeof data.keep_on_top === 'number'
        ? data.keep_on_top
        : typeof data.keepOnTop === 'number'
          ? data.keepOnTop
          : undefined
    return {
      kind: 'ReorderCards',
      type,
      player,
      cards,
      topCount,
      orderOnly: scopeType === 'OrderOnly' || scopeType === 'order_only',
      exactKeepCount,
    }
  }

  if (
    type === 'SearchChoice' ||
    type === 'SearchPartitionChoice' ||
    type === 'DigChoice' ||
    type === 'RevealChoice' ||
    type === 'ChooseFromZoneChoice'
  ) {
    const cards =
      type === 'DigChoice'
        ? numIds(data.selectable_cards ?? data.selectableCards ?? data.cards ?? [])
        : numIds(data.cards ?? [])
    let count = 1
    if (typeof data.count === 'number') count = data.count
    else if (typeof data.primary_count === 'number') count = data.primary_count
    else if (typeof data.primaryCount === 'number') count = data.primaryCount
    else if (typeof data.keep_count === 'number') count = data.keep_count
    else if (typeof data.keepCount === 'number') count = data.keepCount
    const ordering = asRecord(data.ordering_hint) ?? asRecord(data.orderingHint)
    const orderingType =
      typeof ordering?.type === 'string'
        ? ordering.type
        : typeof data.ordering_hint === 'string'
          ? data.ordering_hint
          : typeof data.orderingHint === 'string'
            ? data.orderingHint
            : null
    const upTo =
      Boolean(data.up_to ?? data.upTo) ||
      Boolean(data.allows_partial_find ?? data.allowsPartialFind) ||
      (type === 'DigChoice' && Boolean(data.up_to ?? data.upTo))
    return {
      kind: 'CardPick',
      type,
      player,
      cards,
      count,
      upTo,
      optional: type === 'RevealChoice' ? Boolean(data.optional) : undefined,
      ordered: orderingType === 'OrderedToLibraryTop',
    }
  }

  if (type === 'OrderTriggers') {
    const raw = Array.isArray(data.triggers) ? data.triggers : []
    const triggers: TriggerSummary[] = []
    for (const t of raw) {
      const tr = asRecord(t)
      if (!tr) continue
      const sourceId = idStr(tr.source_id ?? tr.sourceId) ?? '?'
      triggers.push({
        sourceId,
        sourceName: typeof tr.source_name === 'string' ? tr.source_name : typeof tr.sourceName === 'string' ? tr.sourceName : '',
        description: typeof tr.description === 'string' ? tr.description : '',
      })
    }
    return { kind: 'OrderTriggers', player, triggers }
  }

  if (type === 'ReplacementChoice') {
    const candidateCount =
      typeof data.candidate_count === 'number'
        ? data.candidate_count
        : typeof data.candidateCount === 'number'
          ? data.candidateCount
          : Array.isArray(data.candidates)
            ? data.candidates.length
            : 0
    const raw = Array.isArray(data.candidates) ? data.candidates : []
    const candidates: ReplacementCandidate[] = []
    for (const c of raw) {
      const cr = asRecord(c)
      if (!cr) continue
      candidates.push({
        sourceId: idStr(cr.source_id ?? cr.sourceId) ?? '?',
        sourceName:
          typeof cr.source_name === 'string'
            ? cr.source_name
            : typeof cr.sourceName === 'string'
              ? cr.sourceName
              : '',
        description: typeof cr.description === 'string' ? cr.description : '',
      })
    }
    const kindRaw = asRecord(data.kind)
    const kindType =
      typeof kindRaw?.type === 'string'
        ? kindRaw.type
        : typeof data.kind === 'string'
          ? data.kind
          : 'Order'
    return {
      kind: 'ReplacementChoice',
      player,
      candidateCount,
      candidates,
      kindType,
      lastAppliedDecides: Boolean(
        data.last_applied_decides ?? data.lastAppliedDecides,
      ),
      canRemember: data.remember_identity !== undefined || data.rememberIdentity !== undefined,
    }
  }

  if (type === 'PayAmountChoice') {
    const min = typeof data.min === 'number' ? data.min : 0
    const max = typeof data.max === 'number' ? data.max : min
    const resource = asRecord(data.resource)
    const resourceType =
      typeof resource?.type === 'string'
        ? resource.type
        : typeof data.resource === 'string'
          ? data.resource
          : 'Energy'
    return {
      kind: 'PayAmountChoice',
      player: typeof data.player === 'number' ? data.player : player,
      min,
      max,
      sourceId: idStr(data.source_id ?? data.sourceId) ?? undefined,
      resourceType,
    }
  }


  if (type === 'CrewVehicle' || type === 'SaddleMount') {
    const eligible = numIds(data.eligible_creatures ?? data.eligibleCreatures ?? [])
    const contribRaw = data.contributions
    const contributions = Array.isArray(contribRaw)
      ? contribRaw.map((x) => (typeof x === 'number' ? x : 0))
      : []
    const need =
      type === 'CrewVehicle'
        ? typeof data.crew_power === 'number'
          ? data.crew_power
          : typeof data.crewPower === 'number'
            ? data.crewPower
            : 0
        : typeof data.saddle_power === 'number'
          ? data.saddle_power
          : typeof data.saddlePower === 'number'
            ? data.saddlePower
            : 0
    const subjectId =
      idStr(
        type === 'CrewVehicle'
          ? (data.vehicle_id ?? data.vehicleId)
          : (data.mount_id ?? data.mountId),
      ) ?? '?'
    return {
      kind: 'CrewLike',
      type,
      player,
      subjectId,
      need,
      eligible,
      contributions,
    }
  }

  if (type === 'EquipTarget' || type === 'StationTarget') {
    const eligible = numIds(
      type === 'EquipTarget'
        ? (data.valid_targets ?? data.validTargets ?? [])
        : (data.eligible_creatures ?? data.eligibleCreatures ?? []),
    )
    const subjectId =
      idStr(
        type === 'EquipTarget'
          ? (data.equipment_id ?? data.equipmentId)
          : (data.spacecraft_id ?? data.spacecraftId),
      ) ?? '?'
    return { kind: 'AttachPick', type, player, subjectId, eligible }
  }

  if (type === 'OptionalCostChoice') {
    const origin =
      typeof data.origin === 'string'
        ? data.origin
        : typeof asRecord(data.origin)?.type === 'string'
          ? String(asRecord(data.origin)!.type)
          : 'Optional'
    const timesKicked =
      typeof data.times_kicked === 'number'
        ? data.times_kicked
        : typeof data.timesKicked === 'number'
          ? data.timesKicked
          : 0
    return {
      kind: 'OptionalCostChoice',
      player,
      costLabel: summarizeCostLabel(data.cost),
      timesKicked,
      origin,
    }
  }

  if (type === 'UnlessPayment') {
    return {
      kind: 'UnlessPayment',
      player,
      costLabel: summarizeCostLabel(data.cost),
      effectDescription:
        typeof data.effect_description === 'string'
          ? data.effect_description
          : typeof data.effectDescription === 'string'
            ? data.effectDescription
            : undefined,
    }
  }

  if (type === 'UnlessPaymentChooseCost') {
    const rawCosts = Array.isArray(data.costs) ? data.costs : []
    return {
      kind: 'UnlessPaymentChooseCost',
      player,
      costLabels: rawCosts.map(summarizeCostLabel),
      effectDescription:
        typeof data.effect_description === 'string'
          ? data.effect_description
          : typeof data.effectDescription === 'string'
            ? data.effectDescription
            : undefined,
    }
  }

  if (
    type === 'OptionalEffectChoice' ||
    type === 'OpponentMayChoice' ||
    type === 'TributeChoice'
  ) {
    let description = ''
    if (type === 'TributeChoice') {
      const count =
        typeof data.count === 'number' ? data.count : 0
      description = `Tribute: place ${count} +1/+1 counter${count === 1 ? '' : 's'}?`
    } else {
      description =
        typeof data.description === 'string' && data.description
          ? data.description
          : 'You may …'
    }
    return {
      kind: 'OptionalEffect',
      type,
      player,
      sourceId: idStr(data.source_id ?? data.sourceId) ?? undefined,
      description,
      tributeCount: type === 'TributeChoice' && typeof data.count === 'number' ? data.count : undefined,
    }
  }

  if (type === 'TargetSelection' || type === 'TriggerTargetSelection') {
    const slotsRaw = Array.isArray(data.target_slots)
      ? data.target_slots
      : Array.isArray(data.targetSlots)
        ? data.targetSlots
        : []
    const selection = asRecord(data.selection) ?? {}
    const currentSlot =
      typeof selection.current_slot === 'number'
        ? selection.current_slot
        : typeof selection.currentSlot === 'number'
          ? selection.currentSlot
          : 0
    const legal = parseTargetRefs(
      selection.current_legal_targets ?? selection.currentLegalTargets ?? [],
    )
    const slotRec = asRecord(slotsRaw[currentSlot])
    const optional = Boolean(slotRec?.optional)
    const modeLabels = Array.isArray(data.mode_labels)
      ? data.mode_labels
      : Array.isArray(data.modeLabels)
        ? data.modeLabels
        : []
    const modeLabelRaw = modeLabels[currentSlot]
    const modeLabel =
      typeof modeLabelRaw === 'string' ? modeLabelRaw : undefined
    return {
      kind: 'TargetStep',
      type,
      player,
      currentSlot,
      slotCount: slotsRaw.length,
      optional,
      legal,
      modeLabel,
      sourceId: idStr(data.source_id ?? data.sourceId) ?? undefined,
      description:
        typeof data.description === 'string' ? data.description : undefined,
    }
  }

  if (type === 'MultiTargetSelection') {
    return {
      kind: 'MultiTargetSelection',
      player,
      legal: numIds(data.legal_targets ?? data.legalTargets ?? []),
      minTargets:
        typeof data.min_targets === 'number'
          ? data.min_targets
          : typeof data.minTargets === 'number'
            ? data.minTargets
            : 0,
      maxTargets:
        typeof data.max_targets === 'number'
          ? data.max_targets
          : typeof data.maxTargets === 'number'
            ? data.maxTargets
            : 0,
    }
  }

  if (type === 'PairChoice') {
    return {
      kind: 'ObjectPick',
      type,
      player,
      sourceId: idStr(data.source_id ?? data.sourceId) ?? undefined,
      choices: numIds(data.choices ?? []),
      allowSkip: true,
    }
  }

  if (type === 'CopyTargetChoice') {
    const choices = numIds(data.valid_targets ?? data.validTargets ?? [])
    return {
      kind: 'ObjectPick',
      type,
      player,
      sourceId: idStr(data.source_id ?? data.sourceId) ?? undefined,
      choices,
      allowSkip: choices.length === 0,
    }
  }

  if (type === 'DamageSourceChoice') {
    return {
      kind: 'ObjectPick',
      type,
      player,
      choices: numIds(data.options ?? []),
      allowSkip: false,
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

/** Greedy lethal-first split (mirrors Phase AI candidate). Soft UI default only. */
export function defaultCombatDamageSplit(detail: WaitingAssignCombatDamage): {
  mode: CombatDamageAssignmentMode
  amounts: Record<string, number>
  trampleDamage: number
  controllerDamage: number
} {
  let remaining = detail.totalDamage
  const amounts: Record<string, number> = {}
  for (const slot of detail.blockers) {
    const assign = Math.min(remaining, slot.lethalMinimum)
    amounts[slot.blockerId] = assign
    remaining -= assign
  }
  let trampleDamage = 0
  let controllerDamage = 0
  if (detail.trample === 'OverPlaneswalkers' && remaining > 0) {
    const loyalty = detail.pwLoyalty ?? 0
    trampleDamage = Math.min(remaining, loyalty)
    controllerDamage = remaining - trampleDamage
  } else if (detail.trample != null) {
    trampleDamage = remaining
  } else if (remaining > 0 && detail.blockers.length > 0) {
    const last = detail.blockers[detail.blockers.length - 1]!.blockerId
    amounts[last] = (amounts[last] ?? 0) + remaining
  }
  return {
    mode: 'Normal',
    amounts,
    trampleDamage,
    controllerDamage,
  }
}

export function combatDamageAssignedTotal(
  amounts: Record<string, number>,
  trampleDamage: number,
  controllerDamage: number,
): number {
  let n = trampleDamage + controllerDamage
  for (const v of Object.values(amounts)) n += v
  return n
}

export function combatDamageReady(
  detail: WaitingAssignCombatDamage,
  mode: CombatDamageAssignmentMode,
  amounts: Record<string, number>,
  trampleDamage: number,
  controllerDamage: number,
): boolean {
  if (mode === 'AsThoughUnblocked') {
    return detail.assignmentModes.includes('AsThoughUnblocked')
  }
  if (!detail.assignmentModes.includes(mode) && mode !== 'Normal') return false
  return (
    combatDamageAssignedTotal(amounts, trampleDamage, controllerDamage) ===
    detail.totalDamage
  )
}

export function buildAssignCombatDamage(
  mode: CombatDamageAssignmentMode,
  amounts: Record<string, number>,
  trampleDamage: number,
  controllerDamage: number,
): PhaseGameAction {
  if (mode === 'AsThoughUnblocked') {
    return {
      type: 'AssignCombatDamage',
      data: {
        mode: 'AsThoughUnblocked',
        assignments: [],
        trample_damage: 0,
        controller_damage: 0,
      },
    }
  }
  const assignments: Array<[number, number]> = []
  for (const [id, dmg] of Object.entries(amounts)) {
    if (dmg <= 0) continue
    const n = Number(id)
    if (!Number.isFinite(n)) continue
    assignments.push([n, dmg])
  }
  return {
    type: 'AssignCombatDamage',
    data: {
      mode: 'Normal',
      assignments,
      trample_damage: trampleDamage,
      controller_damage: controllerDamage,
    },
  }
}

export function defaultBlockerDamageSplit(
  detail: WaitingAssignBlockerDamage,
): Record<string, number> {
  const amounts: Record<string, number> = {}
  for (const id of detail.attackers) amounts[id] = 0
  if (detail.attackers.length > 0) {
    amounts[detail.attackers[0]!] = detail.totalDamage
  }
  return amounts
}

export function blockerDamageReady(
  detail: WaitingAssignBlockerDamage,
  amounts: Record<string, number>,
): boolean {
  let n = 0
  for (const id of detail.attackers) n += amounts[id] ?? 0
  return n === detail.totalDamage
}

export function buildAssignBlockerDamage(
  amounts: Record<string, number>,
): PhaseGameAction {
  const assignments: Array<[number, number]> = []
  for (const [id, dmg] of Object.entries(amounts)) {
    if (dmg <= 0) continue
    const n = Number(id)
    if (!Number.isFinite(n)) continue
    assignments.push([n, dmg])
  }
  return { type: 'AssignBlockerDamage', data: { assignments } }
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
    case 'AssignCombatDamage':
    case 'AssignBlockerDamage':
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
    case 'LibraryBipart':
    case 'ReorderCards':
    case 'CardPick':
    case 'OrderTriggers':
    case 'ReplacementChoice':
    case 'PayAmountChoice':
    case 'CrewLike':
    case 'AttachPick':
    case 'OptionalCostChoice':
    case 'UnlessPayment':
    case 'UnlessPaymentChooseCost':
    case 'OptionalEffect':
    case 'TargetStep':
    case 'MultiTargetSelection':
    case 'ObjectPick':
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

export function buildOrderTriggers(order: number[]): PhaseGameAction {
  return { type: 'OrderTriggers', data: { order } }
}

export function buildChooseReplacement(index: number): PhaseGameAction {
  return { type: 'ChooseReplacement', data: { index } }
}

export function buildChooseReplacementAndRemember(
  choice:
    | { type: 'Order'; data: { order: number[] } }
    | { type: 'Optional'; data: { index: number } },
): PhaseGameAction {
  return { type: 'ChooseReplacementAndRemember', data: { choice } }
}

export function buildSubmitPayAmount(amount: number): PhaseGameAction {
  return { type: 'SubmitPayAmount', data: { amount } }
}

/** Scry/Surveil: ordered keep-on-top ids (rest implied by Phase). */
export function libraryBipartReady(
  detail: WaitingLibraryBipart,
  keepOrdered: string[],
): boolean {
  const set = new Set(detail.cards)
  if (keepOrdered.length > detail.cards.length) return false
  const seen = new Set<string>()
  for (const id of keepOrdered) {
    if (!set.has(id) || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

/** Full permutation (Ripple/RevealUntil/DigRest) or exact-keep ArrangePlanar. */
export function reorderCardsReady(
  detail: WaitingReorderCards,
  ordered: string[],
): boolean {
  if (detail.type === 'ArrangePlanarDeckTopChoice') {
    const keep = detail.exactKeepCount ?? 0
    if (ordered.length !== keep) return false
    const set = new Set(detail.cards)
    const seen = new Set<string>()
    for (const id of ordered) {
      if (!set.has(id) || seen.has(id)) return false
      seen.add(id)
    }
    return true
  }
  if (ordered.length !== detail.cards.length) return false
  const set = new Set(detail.cards)
  const seen = new Set<string>()
  for (const id of ordered) {
    if (!set.has(id) || seen.has(id)) return false
    seen.add(id)
  }
  if (detail.orderOnly && detail.topCount != null) {
    const top = new Set(detail.cards.slice(0, detail.topCount))
    for (let i = 0; i < detail.topCount; i++) {
      if (!top.has(ordered[i]!)) return false
    }
  }
  return true
}

export function cardPickReady(
  detail: WaitingCardPick,
  selected: string[],
): boolean {
  if (detail.optional && selected.length === 0) return true
  if (detail.upTo) return selected.length <= detail.count
  return selected.length === detail.count
}

export function payAmountInRange(
  detail: WaitingPayAmount,
  value: number,
): boolean {
  return (
    Number.isFinite(value) &&
    value >= detail.min &&
    value <= detail.max &&
    detail.min <= detail.max
  )
}


export function buildCrewVehicle(
  vehicleId: string,
  creatureIds: string[],
): PhaseGameAction {
  return {
    type: 'CrewVehicle',
    data: {
      vehicle_id: Number(vehicleId),
      creature_ids: creatureIds.map(Number).filter((n) => Number.isFinite(n)),
    },
  }
}

export function buildSaddleMount(
  mountId: string,
  creatureIds: string[],
): PhaseGameAction {
  return {
    type: 'SaddleMount',
    data: {
      mount_id: Number(mountId),
      creature_ids: creatureIds.map(Number).filter((n) => Number.isFinite(n)),
    },
  }
}

export function buildEquip(equipmentId: string, targetId: string): PhaseGameAction {
  return {
    type: 'Equip',
    data: { equipment_id: Number(equipmentId), target_id: Number(targetId) },
  }
}

export function buildActivateStation(
  spacecraftId: string,
  creatureId: string,
): PhaseGameAction {
  return {
    type: 'ActivateStation',
    data: {
      spacecraft_id: Number(spacecraftId),
      creature_id: Number(creatureId),
    },
  }
}

export function buildDecideOptionalCost(pay: boolean): PhaseGameAction {
  return { type: 'DecideOptionalCost', data: { pay } }
}

export function buildPayUnlessCost(pay: boolean): PhaseGameAction {
  return { type: 'PayUnlessCost', data: { pay } }
}

export function buildChooseUnlessCostBranch(
  choice: { type: 'Decline' } | { type: 'Pay'; data: { index: number } },
): PhaseGameAction {
  return { type: 'ChooseUnlessCostBranch', data: { choice } }
}

export function buildDecideOptionalEffect(accept: boolean): PhaseGameAction {
  return { type: 'DecideOptionalEffect', data: { accept } }
}

export function buildChooseTarget(
  target: TargetRefWire | null,
): PhaseGameAction {
  return {
    type: 'ChooseTarget',
    data: { target: target ? targetRefToWire(target) : null },
  }
}

export function buildSelectTargets(targets: TargetRefWire[]): PhaseGameAction {
  return {
    type: 'SelectTargets',
    data: { targets: targets.map(targetRefToWire) },
  }
}

export function buildChoosePair(partnerId: string | null): PhaseGameAction {
  return {
    type: 'ChoosePair',
    data: { partner: partnerId != null ? Number(partnerId) : null },
  }
}

export function buildChooseDamageSource(sourceId: string): PhaseGameAction {
  return {
    type: 'ChooseDamageSource',
    data: { source: Number(sourceId) },
  }
}


export function isReplacementOrderMode(detail: WaitingReplacement): boolean {
  return detail.kindType === 'Order' && detail.candidateCount > 1
}

