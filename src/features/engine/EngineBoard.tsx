/**
 * Arena-style board driven purely by Phase state + legal actions.
 * No free DnD / zone moves — only engine submits.
 */
import { useEffect, useMemo, useState } from 'react'
import { CardChip } from '@/components/CardChip'
import { CardDetailOverlay } from '@/components/CardDetailOverlay'
import { PhaseRail } from '@/components/PhaseRail'
import type { PhaseGameAction } from '@/engine'
import {
  pickPrimaryAction,
  summarizeAction,
  type PhaseBoardView,
  type PhaseObjectView,
} from '@/engine/phaseStateView'
import {
  applyPaymentPref,
  assistPaymentInRange,
  buildActivateManaSource,
  buildChooseAssistPlayer,
  buildChooseX,
  buildCommitAssistPayment,
  buildDeclareAttackersAction,
  buildDeclareBlockersAction,
  buildDeclareNoneAttackers,
  buildDeclareNoneBlockers,
  buildAssignCombatDamage,
  buildAssignBlockerDamage,
  defaultCombatDamageSplit,
  defaultBlockerDamageSplit,
  combatDamageReady,
  blockerDamageReady,
  combatDamageAssignedTotal,
  buildSelectCards,
  buildSelectModes,
  buildSpendPoolMana,
  buildSubmitPhyrexianChoices,
  buildUnspendPoolMana,
  buildOrderTriggers,
  buildChooseReplacement,
  buildChooseReplacementAndRemember,
  buildSubmitPayAmount,
  chooseXInRange,
  defaultPhyrexianChoices,
  derivedEngineStops,
  discardReady,
  effectZoneReady,
  findFlatAction,
  findMulliganActions,
  matchCastVariant,
  modeChoiceReady,
  manaTapObjectIds,
  needsTargetingWizard,
  nextSlotTargets,
  parseWaitingFor,
  phyrexianChoicesPayload,
  pickManaTapAction,
  pickUntargetedCast,
  preferActivateAbility,
  countRespondableActions,
  hasBoardResponses,
  formatSpellCostLabel,
  isActivateAbility,
  isCastFamily,
  summarizeManaSourceOption,
  libraryBipartReady,
  reorderCardsReady,
  cardPickReady,
  payAmountInRange,
  isReplacementOrderMode,
  type CastPaymentModeType,
  type WaitingAssistChoosePlayer,
  type WaitingAssistPayment,
  type WaitingChooseX,
  type WaitingCombatAttackers,
  type WaitingCombatBlockers,
  type WaitingAssignCombatDamage,
  type WaitingAssignBlockerDamage,
  type CombatDamageAssignmentMode,
  type WaitingDetail,
  type WaitingDiscard,
  type WaitingEffectZone,
  type WaitingManaPayment,
  type WaitingManaSourceSelection,
  type WaitingModeChoice,
  type WaitingPhyrexian,
  type WaitingLibraryBipart,
  type WaitingReorderCards,
  type WaitingCardPick,
  type WaitingOrderTriggers,
  type WaitingReplacement,
  type WaitingPayAmount,
  type WaitingCrewLike,
  type WaitingAttachPick,
  type WaitingOptionalCost,
  type WaitingUnlessPayment,
  type WaitingUnlessChooseCost,
  type WaitingOptionalEffect,
  type WaitingTargetStep,
  type WaitingMultiTarget,
  type WaitingObjectPick,
  buildCrewVehicle,
  buildSaddleMount,
  buildEquip,
  buildActivateStation,
  buildDecideOptionalCost,
  buildPayUnlessCost,
  buildChooseUnlessCostBranch,
  buildDecideOptionalEffect,
  buildChooseTarget,
  buildChoosePair,
  buildChooseDamageSource,
  crewLikeReady,
  multiTargetReady,
  selectedContributionTotal,
} from '@/engine/engineInteraction'
import {
  aggregateManaPool,
  manaCountsEntries,
  MANA_PIP_GLYPH,
  MANA_PIP_CLASS,
} from '@/engine/phaseGameLog'

type Props = {
  view: PhaseBoardView
  busy: boolean
  onSubmit: (action: PhaseGameAction) => void
  /** Submit several engine-legal actions without AI between them (mana shortcuts). */
  onSubmitChain?: (actions: PhaseGameAction[]) => void
  onDriveAi: () => void
  /** Optional Auto-payment source preview (object ids). */
  onPreviewMana?: (action: PhaseGameAction) => string[]
  onConcede?: () => void
  onRematch?: () => void
}

type UiMode =
  | { kind: 'idle' }
  | {
      kind: 'targeting'
      sourceName: string
      objectId: string
      variants: PhaseGameAction[]
      selected: string[]
    }
  | {
      kind: 'attackers'
      detail: WaitingCombatAttackers
      selected: string[]
      /** When an attacker needs a target pick among multiple AttackTargets. */
      pendingAttacker: string | null
      attackTargets: Record<string, import('@/engine/engineInteraction').AttackTarget>
    }
  | {
      kind: 'blockers'
      detail: WaitingCombatBlockers
      pendingBlocker: string | null
      assignments: Array<[string, string]>
    }
  | {
      kind: 'assignCombatDamage'
      detail: WaitingAssignCombatDamage
      mode: CombatDamageAssignmentMode
      amounts: Record<string, number>
      trampleDamage: number
      controllerDamage: number
    }
  | {
      kind: 'assignBlockerDamage'
      detail: WaitingAssignBlockerDamage
      amounts: Record<string, number>
    }
  | { kind: 'manaPay'; detail: WaitingManaPayment }
  | { kind: 'manaSource'; detail: WaitingManaSourceSelection }
  | {
      kind: 'phyrexian'
      detail: WaitingPhyrexian
      /** shardIndex → mana | life — Phase PayMana / PayLife */
      picks: Map<number, 'mana' | 'life'>
    }
  | { kind: 'chooseX'; detail: WaitingChooseX; value: number }
  | { kind: 'assistPlayer'; detail: WaitingAssistChoosePlayer }
  | { kind: 'assistPay'; detail: WaitingAssistPayment; value: number }
  | { kind: 'discard'; detail: WaitingDiscard; selected: string[] }
  | { kind: 'modeChoice'; detail: WaitingModeChoice; selected: number[] }
  | { kind: 'effectZone'; detail: WaitingEffectZone; selected: string[] }
  | {
      kind: 'libraryBipart'
      detail: WaitingLibraryBipart
      /** Current display order of looked-at cards. */
      order: string[]
      /** Cards marked rest (bottom / graveyard). */
      rest: string[]
    }
  | {
      kind: 'reorderCards'
      detail: WaitingReorderCards
      order: string[]
    }
  | { kind: 'cardPick'; detail: WaitingCardPick; selected: string[] }
  | { kind: 'orderTriggers'; detail: WaitingOrderTriggers; order: number[] }
  | {
      kind: 'replacement'
      detail: WaitingReplacement
      /** Permutation of candidate indices (Order mode). */
      order: number[]
      remember: boolean
    }
  | { kind: 'payAmount'; detail: WaitingPayAmount; value: number }
  | { kind: 'crewLike'; detail: WaitingCrewLike; selected: string[] }
  | { kind: 'attachPick'; detail: WaitingAttachPick }
  | { kind: 'optionalCost'; detail: WaitingOptionalCost }
  | { kind: 'unlessPayment'; detail: WaitingUnlessPayment }
  | { kind: 'unlessChooseCost'; detail: WaitingUnlessChooseCost }
  | { kind: 'optionalEffect'; detail: WaitingOptionalEffect }
  | { kind: 'targetStep'; detail: WaitingTargetStep }
  | { kind: 'multiTarget'; detail: WaitingMultiTarget; selected: string[] }
  | { kind: 'objectPick'; detail: WaitingObjectPick }

function LifeBadge({
  life,
  size = 'md',
  active,
  lost,
}: {
  life: number
  size?: 'md' | 'lg'
  active?: boolean
  lost?: boolean
}) {
  const dim = size === 'lg' ? 'h-14 w-14 text-xl' : 'h-10 w-10 text-base'
  return (
    <div
      className={[
        'flex items-center justify-center rounded-full font-bold tabular-nums text-white shadow-lg',
        dim,
        lost ? 'bg-slate-700/80 line-through' : 'bg-gradient-to-b from-amber-500 to-amber-700',
        active ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-emerald-950' : '',
      ].join(' ')}
    >
      {life}
    </div>
  )
}

function SeatStatusBadges({
  poison,
  commanderDamage,
}: {
  poison: number
  commanderDamage: Array<{ commanderName: string; damage: number }>
}) {
  if (poison <= 0 && commanderDamage.length === 0) return null
  return (
    <div className="flex max-w-[9rem] flex-col gap-0.5 text-[9px] leading-tight">
      {poison > 0 && (
        <span className="rounded bg-emerald-900/80 px-1.5 py-0.5 font-semibold text-lime-300">
          Poison {poison}
        </span>
      )}
      {commanderDamage.map((cd, i) => (
        <span
          key={i}
          className="truncate rounded bg-rose-950/80 px-1.5 py-0.5 text-rose-200"
          title={`${cd.commanderName}: ${cd.damage} commander damage`}
        >
          CMD {cd.damage}
          <span className="text-rose-200/60"> · {cd.commanderName}</span>
        </span>
      ))}
    </div>
  )
}

const PAY_LABEL: Record<CastPaymentModeType, string> = {
  Auto: 'Auto',
  Manual: 'Manual',
  AutoExceptSacrificialMana: 'Sac-safe',
}

export function EngineBoard({
  view,
  busy,
  onSubmit,
  onSubmitChain,
  onDriveAi,
  onPreviewMana,
  onConcede,
  onRematch,
}: Props) {
  const you = view.seats[0]
  const opponents = view.seats.slice(1)
  const [inspect, setInspect] = useState<PhaseObjectView | null>(null)
  const [picker, setPicker] = useState<{
    objectId: string
    name: string
    actions: PhaseGameAction[]
  } | null>(null)
  const [showAllActions, setShowAllActions] = useState(false)
  const [mode, setMode] = useState<UiMode>({ kind: 'idle' })
  const [manaGlow, setManaGlow] = useState<Set<string>>(() => new Set())
  const [paymentPref, setPaymentPref] = useState<CastPaymentModeType>('Auto')

  const waitingDetail: WaitingDetail = useMemo(
    () => parseWaitingFor(view.waitingRaw ?? view.waitingFor),
    [view.waitingRaw, view.waitingFor],
  )

  const glowing = useMemo(
    () => new Set(Object.keys(view.actionsByObject)),
    [view.actionsByObject],
  )

  const manaTapGlow = useMemo(
    () => manaTapObjectIds(view.actionsByObject),
    [view.actionsByObject],
  )

  const passAction = view.flatActions.find((a) => a.type === 'PassPriority')
  const cancelCast = findFlatAction(view.flatActions, 'CancelCast')
  const backToMana = findFlatAction(view.flatActions, 'BackToManaPayment')
  const canPass =
    Boolean(passAction) &&
    (mode.kind === 'idle' || mode.kind === 'manaPay')
  const respondableCount = useMemo(
    () => countRespondableActions(view.flatActions),
    [view.flatActions],
  )
  const boardResponses = useMemo(
    () => hasBoardResponses(view.actionsByObject),
    [view.actionsByObject],
  )
  const yourPriority = view.priorityPlayer === 0
  const stackNonempty = view.stackCount > 0
  const showPriorityBanner =
    yourPriority &&
    mode.kind === 'idle' &&
    Boolean(passAction) &&
    !view.waitingFor &&
    (stackNonempty || respondableCount > 0 || boardResponses)
  const mulliganActs = useMemo(
    () => findMulliganActions(view.flatActions),
    [view.flatActions],
  )

  const railStops = useMemo(
    () => derivedEngineStops(waitingDetail, view.phase),
    [waitingDetail, view.phase],
  )

  const pinnedPool = useMemo(
    () => new Set(view.pinnedPoolUnits ?? []),
    [view.pinnedPoolUnits],
  )

  // Auto-enter engine-driven choice modes from waiting_for (viewer seat 0).
  useEffect(() => {
    const w = waitingDetail
    if (w?.kind === 'DeclareAttackers' && w.player === 0) {
      setMode({
        kind: 'attackers',
        detail: w,
        selected: [],
        pendingAttacker: null,
        attackTargets: {},
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'DeclareBlockers' && w.player === 0) {
      setMode({
        kind: 'blockers',
        detail: w,
        pendingBlocker: null,
        assignments: [],
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'AssignCombatDamage' && w.player === 0) {
      const split = defaultCombatDamageSplit(w)
      setMode({
        kind: 'assignCombatDamage',
        detail: w,
        mode: split.mode,
        amounts: split.amounts,
        trampleDamage: split.trampleDamage,
        controllerDamage: split.controllerDamage,
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'AssignBlockerDamage' && w.player === 0) {
      setMode({
        kind: 'assignBlockerDamage',
        detail: w,
        amounts: defaultBlockerDamageSplit(w),
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'ManaPayment' && w.player === 0) {
      setMode({ kind: 'manaPay', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'ManaSourceSelection' && w.player === 0) {
      setMode({ kind: 'manaSource', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'Discard' && w.player === 0) {
      setMode({ kind: 'discard', detail: w, selected: [] })
      setPicker(null)
      return
    }
    if (w?.kind === 'ModeChoice' && w.player === 0) {
      setMode({ kind: 'modeChoice', detail: w, selected: [] })
      setPicker(null)
      return
    }
    if (w?.kind === 'EffectZoneChoice' && w.player === 0) {
      setMode({ kind: 'effectZone', detail: w, selected: [] })
      setPicker(null)
      return
    }
    if (w?.kind === 'PhyrexianPayment' && w.player === 0) {
      setMode({
        kind: 'phyrexian',
        detail: w,
        picks: defaultPhyrexianChoices(w.shards),
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'ChooseXValue') {
      // Phase does not always stamp player; treat as viewer decision when present.
      const start =
        w.min <= w.max ? Math.max(w.min, 0) : w.min
      setMode({ kind: 'chooseX', detail: w, value: start })
      setPicker(null)
      return
    }
    if (w?.kind === 'AssistChoosePlayer') {
      setMode({ kind: 'assistPlayer', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'AssistPayment') {
      setMode({ kind: 'assistPay', detail: w, value: 0 })
      setPicker(null)
      return
    }
    if (w?.kind === 'LibraryBipart' && w.player === 0) {
      setMode({
        kind: 'libraryBipart',
        detail: w,
        order: [...w.cards],
        rest: [],
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'ReorderCards' && w.player === 0) {
      const initial =
        w.type === 'ArrangePlanarDeckTopChoice'
          ? w.cards.slice(0, w.exactKeepCount ?? 0)
          : [...w.cards]
      setMode({ kind: 'reorderCards', detail: w, order: initial })
      setPicker(null)
      return
    }
    if (w?.kind === 'CardPick' && w.player === 0) {
      setMode({ kind: 'cardPick', detail: w, selected: [] })
      setPicker(null)
      return
    }
    if (w?.kind === 'OrderTriggers' && w.player === 0) {
      setMode({
        kind: 'orderTriggers',
        detail: w,
        order: w.triggers.map((_, i) => i),
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'ReplacementChoice' && w.player === 0) {
      const n = Math.max(w.candidateCount, w.candidates.length)
      setMode({
        kind: 'replacement',
        detail: w,
        order: Array.from({ length: n }, (_, i) => i),
        remember: false,
      })
      setPicker(null)
      return
    }
    if (w?.kind === 'PayAmountChoice') {
      setMode({ kind: 'payAmount', detail: w, value: w.min })
      setPicker(null)
      return
    }
    if (w?.kind === 'CrewLike' && w.player === 0) {
      setMode({ kind: 'crewLike', detail: w, selected: [] })
      setPicker(null)
      return
    }
    if (w?.kind === 'AttachPick' && w.player === 0) {
      setMode({ kind: 'attachPick', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'OptionalCostChoice' && w.player === 0) {
      setMode({ kind: 'optionalCost', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'UnlessPayment' && w.player === 0) {
      setMode({ kind: 'unlessPayment', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'UnlessPaymentChooseCost' && w.player === 0) {
      setMode({ kind: 'unlessChooseCost', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'OptionalEffect' && w.player === 0) {
      setMode({ kind: 'optionalEffect', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'TargetStep' && w.player === 0) {
      setMode({ kind: 'targetStep', detail: w })
      setPicker(null)
      return
    }
    if (w?.kind === 'MultiTargetSelection' && w.player === 0) {
      setMode({ kind: 'multiTarget', detail: w, selected: [] })
      setPicker(null)
      return
    }
    if (w?.kind === 'ObjectPick' && w.player === 0) {
      setMode({ kind: 'objectPick', detail: w })
      setPicker(null)
      return
    }
    setMode((m) => {
      if (
        m.kind === 'attackers' ||
        m.kind === 'blockers' ||
        m.kind === 'assignCombatDamage' ||
        m.kind === 'assignBlockerDamage' ||
        m.kind === 'manaPay' ||
        m.kind === 'manaSource' ||
        m.kind === 'phyrexian' ||
        m.kind === 'chooseX' ||
        m.kind === 'assistPlayer' ||
        m.kind === 'assistPay' ||
        m.kind === 'discard' ||
        m.kind === 'modeChoice' ||
        m.kind === 'effectZone' ||
        m.kind === 'libraryBipart' ||
        m.kind === 'reorderCards' ||
        m.kind === 'cardPick' ||
        m.kind === 'orderTriggers' ||
        m.kind === 'replacement' ||
        m.kind === 'payAmount' ||
        m.kind === 'crewLike' ||
        m.kind === 'attachPick' ||
        m.kind === 'optionalCost' ||
        m.kind === 'unlessPayment' ||
        m.kind === 'unlessChooseCost' ||
        m.kind === 'optionalEffect' ||
        m.kind === 'targetStep' ||
        m.kind === 'multiTarget' ||
        m.kind === 'objectPick'
      ) {
        return { kind: 'idle' }
      }
      return m
    })
  }, [waitingDetail])

  // Clear targeting when legal actions refresh out from under us
  useEffect(() => {
    if (mode.kind !== 'targeting') return
    const still = view.actionsByObject[mode.objectId]
    if (!still || still.length === 0) setMode({ kind: 'idle' })
  }, [view.actionsByObject, mode])

  const targetGlow = useMemo(() => {
    if (mode.kind !== 'targeting') return new Set<string>()
    return new Set(nextSlotTargets(mode.variants, mode.selected))
  }, [mode])

  const combatGlow = useMemo(() => {
    if (mode.kind === 'attackers') {
      if (mode.pendingAttacker) return new Set<string>() // player targets via banner
      return new Set(mode.detail.validAttackerIds)
    }
    if (mode.kind === 'blockers') {
      if (mode.pendingBlocker) {
        return new Set(mode.detail.validBlockTargets[mode.pendingBlocker] ?? [])
      }
      return new Set(mode.detail.validBlockerIds)
    }
    if (mode.kind === 'assignCombatDamage') {
      const s = new Set<string>([mode.detail.attackerId])
      for (const b of mode.detail.blockers) s.add(b.blockerId)
      return s
    }
    if (mode.kind === 'assignBlockerDamage') {
      const s = new Set<string>([mode.detail.blockerId])
      for (const a of mode.detail.attackers) s.add(a)
      return s
    }
    return new Set<string>()
  }, [mode])

  const choiceGlow = useMemo(() => {
    if (mode.kind === 'discard') return new Set(mode.detail.cards)
    if (mode.kind === 'effectZone') return new Set(mode.detail.cards)
    if (mode.kind === 'libraryBipart') return new Set(mode.detail.cards)
    if (mode.kind === 'reorderCards') return new Set(mode.detail.cards)
    if (mode.kind === 'cardPick') return new Set(mode.detail.cards)
    if (mode.kind === 'crewLike') return new Set(mode.detail.eligible)
    if (mode.kind === 'attachPick') return new Set(mode.detail.eligible)
    if (mode.kind === 'multiTarget') return new Set(mode.detail.legal)
    if (mode.kind === 'objectPick') return new Set(mode.detail.choices)
    if (mode.kind === 'targetStep') {
      return new Set(
        mode.detail.legal.filter((t) => t.kind === 'Object').map((t) => t.id),
      )
    }
    if (
      mode.kind === 'manaPay' ||
      mode.kind === 'manaSource' ||
      mode.kind === 'phyrexian'
    ) {
      return manaTapGlow
    }
    return new Set<string>()
  }, [mode, manaTapGlow])

  const selectedIds = useMemo(() => {
    if (mode.kind === 'targeting') return new Set(mode.selected)
    if (mode.kind === 'attackers') return new Set(mode.selected)
    if (mode.kind === 'blockers') {
      const s = new Set<string>()
      for (const [b, a] of mode.assignments) {
        s.add(b)
        s.add(a)
      }
      if (mode.pendingBlocker) s.add(mode.pendingBlocker)
      return s
    }
    if (mode.kind === 'assignCombatDamage') {
      const s = new Set<string>([mode.detail.attackerId])
      for (const [id, dmg] of Object.entries(mode.amounts)) {
        if (dmg > 0) s.add(id)
      }
      return s
    }
    if (mode.kind === 'assignBlockerDamage') {
      const s = new Set<string>([mode.detail.blockerId])
      for (const [id, dmg] of Object.entries(mode.amounts)) {
        if (dmg > 0) s.add(id)
      }
      return s
    }
    if (mode.kind === 'discard' || mode.kind === 'effectZone' || mode.kind === 'cardPick') {
      return new Set(mode.selected)
    }
    if (mode.kind === 'crewLike' || mode.kind === 'multiTarget') {
      return new Set(mode.selected)
    }
    if (mode.kind === 'attachPick') {
      return new Set([mode.detail.subjectId])
    }
    if (mode.kind === 'libraryBipart') {
      return new Set(mode.order.filter((id) => !mode.rest.includes(id)))
    }
    if (mode.kind === 'reorderCards') {
      return new Set(mode.order)
    }
    return new Set<string>()
  }, [mode])

  function chipGlow(objectId: string): {
    highlighted: boolean
    glow: 'legal' | 'target' | 'mana' | 'combat'
    selected: boolean
  } {
    if (manaGlow.has(objectId)) {
      return { highlighted: true, glow: 'mana', selected: true }
    }
    if (mode.kind === 'targeting') {
      if (targetGlow.has(objectId) || selectedIds.has(objectId)) {
        return {
          highlighted: true,
          glow: 'target',
          selected: selectedIds.has(objectId),
        }
      }
      if (objectId === mode.objectId) {
        return { highlighted: true, glow: 'legal', selected: true }
      }
      return { highlighted: false, glow: 'legal', selected: false }
    }
    if (
      mode.kind === 'attackers' ||
      mode.kind === 'blockers' ||
      mode.kind === 'assignCombatDamage' ||
      mode.kind === 'assignBlockerDamage'
    ) {
      if (combatGlow.has(objectId) || selectedIds.has(objectId)) {
        return {
          highlighted: true,
          glow: 'combat',
          selected: selectedIds.has(objectId),
        }
      }
      return { highlighted: false, glow: 'legal', selected: false }
    }
    if (
      mode.kind === 'discard' ||
      mode.kind === 'effectZone' ||
      mode.kind === 'cardPick' ||
      mode.kind === 'libraryBipart' ||
      mode.kind === 'reorderCards' ||
      mode.kind === 'crewLike' ||
      mode.kind === 'attachPick' ||
      mode.kind === 'multiTarget' ||
      mode.kind === 'objectPick' ||
      mode.kind === 'targetStep'
    ) {
      if (choiceGlow.has(objectId) || selectedIds.has(objectId)) {
        return {
          highlighted: true,
          glow: 'target',
          selected: selectedIds.has(objectId),
        }
      }
      return { highlighted: false, glow: 'legal', selected: false }
    }
    if (
      mode.kind === 'manaPay' ||
      mode.kind === 'manaSource' ||
      mode.kind === 'phyrexian'
    ) {
      if (choiceGlow.has(objectId)) {
        return { highlighted: true, glow: 'mana', selected: false }
      }
      return { highlighted: false, glow: 'legal', selected: false }
    }
    return {
      highlighted: glowing.has(objectId),
      glow: 'legal',
      selected: false,
    }
  }

  function submitWithManaPreview(action: PhaseGameAction) {
    const paid = applyPaymentPref(action, paymentPref)
    if (onPreviewMana && paymentPref !== 'Manual') {
      try {
        const ids = onPreviewMana(paid)
        if (ids.length) {
          setManaGlow(new Set(ids))
          window.setTimeout(() => setManaGlow(new Set()), 700)
        }
      } catch {
        /* preview optional */
      }
    }
    setMode({ kind: 'idle' })
    setPicker(null)
    onSubmit(paid)
  }

  function onCardTap(card: PhaseObjectView) {
    if (busy) return

    if (mode.kind === 'targeting') {
      if (!targetGlow.has(card.objectId)) {
        if (card.objectId === mode.objectId) return
        setInspect(card)
        return
      }
      const next = [...mode.selected, card.objectId]
      const matched = matchCastVariant(mode.variants, next)
      if (matched) {
        submitWithManaPreview(matched)
        return
      }
      const more = nextSlotTargets(mode.variants, next)
      if (more.length === 0) {
        setMode({ ...mode, selected: [] })
        return
      }
      setMode({ ...mode, selected: next })
      return
    }

    if (mode.kind === 'attackers') {
      if (mode.pendingAttacker) {
        setInspect(card)
        return
      }
      if (!mode.detail.validAttackerIds.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const targets =
        mode.detail.validAttackTargetsByAttacker?.[card.objectId] ??
        mode.detail.validAttackTargets
      if (targets.length > 1 && !mode.selected.includes(card.objectId)) {
        // Multi-target: select attacker then pick target in banner
        setMode({
          ...mode,
          pendingAttacker: card.objectId,
          selected: mode.selected.includes(card.objectId)
            ? mode.selected
            : [...mode.selected, card.objectId],
        })
        return
      }
      setMode({
        ...mode,
        selected: mode.selected.includes(card.objectId)
          ? mode.selected.filter((id) => id !== card.objectId)
          : [...mode.selected, card.objectId],
      })
      return
    }

    if (mode.kind === 'blockers') {
      if (!mode.pendingBlocker) {
        if (!mode.detail.validBlockerIds.includes(card.objectId)) {
          setInspect(card)
          return
        }
        setMode({ ...mode, pendingBlocker: card.objectId })
        return
      }
      const legal = mode.detail.validBlockTargets[mode.pendingBlocker] ?? []
      if (!legal.includes(card.objectId)) {
        if (mode.detail.validBlockerIds.includes(card.objectId)) {
          setMode({ ...mode, pendingBlocker: card.objectId })
          return
        }
        setInspect(card)
        return
      }
      const assignments = mode.assignments.filter(([b]) => b !== mode.pendingBlocker)
      assignments.push([mode.pendingBlocker, card.objectId])
      setMode({ ...mode, pendingBlocker: null, assignments })
      return
    }

    if (mode.kind === 'assignCombatDamage') {
      if (mode.mode === 'AsThoughUnblocked') {
        setInspect(card)
        return
      }
      const slot = mode.detail.blockers.find((b) => b.blockerId === card.objectId)
      if (!slot) {
        setInspect(card)
        return
      }
      const cur = mode.amounts[card.objectId] ?? 0
      const assigned = combatDamageAssignedTotal(
        mode.amounts,
        mode.trampleDamage,
        mode.controllerDamage,
      )
      if (assigned >= mode.detail.totalDamage) {
        // Cycle: reset this slot to 0 when fully assigned
        setMode({
          ...mode,
          amounts: { ...mode.amounts, [card.objectId]: 0 },
        })
        return
      }
      setMode({
        ...mode,
        amounts: { ...mode.amounts, [card.objectId]: cur + 1 },
      })
      return
    }

    if (mode.kind === 'assignBlockerDamage') {
      if (!mode.detail.attackers.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const cur = mode.amounts[card.objectId] ?? 0
      let assigned = 0
      for (const id of mode.detail.attackers) assigned += mode.amounts[id] ?? 0
      if (assigned >= mode.detail.totalDamage) {
        setMode({
          ...mode,
          amounts: { ...mode.amounts, [card.objectId]: 0 },
        })
        return
      }
      setMode({
        ...mode,
        amounts: { ...mode.amounts, [card.objectId]: cur + 1 },
      })
      return
    }

    if (mode.kind === 'manaPay' || mode.kind === 'phyrexian') {
      const acts = view.actionsByObject[card.objectId] ?? []
      const pick = pickManaTapAction(acts)
      if (pick === 'ambiguous') {
        setPicker({
          objectId: card.objectId,
          name: card.card.name,
          actions: acts.filter(
            (a) => a.type === 'TapLandForMana' || a.type === 'ActivateManaSource',
          ),
        })
        return
      }
      if (pick) {
        onSubmit(pick)
        return
      }
      setInspect(card)
      return
    }

    if (mode.kind === 'manaSource') {
      // Prefer board tap if legal; otherwise inspect (options are in banner)
      const acts = view.actionsByObject[card.objectId] ?? []
      const pick = pickManaTapAction(acts)
      if (pick && pick !== 'ambiguous') {
        onSubmit(pick)
        return
      }
      if (pick === 'ambiguous') {
        setPicker({
          objectId: card.objectId,
          name: card.card.name,
          actions: acts.filter(
            (a) => a.type === 'TapLandForMana' || a.type === 'ActivateManaSource',
          ),
        })
        return
      }
      setInspect(card)
      return
    }

    if (mode.kind === 'crewLike') {
      if (!mode.detail.eligible.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const selected = mode.selected.includes(card.objectId)
        ? mode.selected.filter((id) => id !== card.objectId)
        : [...mode.selected, card.objectId]
      setMode({ ...mode, selected })
      return
    }

    if (mode.kind === 'attachPick') {
      if (!mode.detail.eligible.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const d = mode.detail
      setMode({ kind: 'idle' })
      if (d.type === 'EquipTarget') {
        onSubmit(buildEquip(d.subjectId, card.objectId))
      } else {
        onSubmit(buildActivateStation(d.subjectId, card.objectId))
      }
      return
    }

    if (mode.kind === 'multiTarget') {
      if (!mode.detail.legal.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const selected = mode.selected.includes(card.objectId)
        ? mode.selected.filter((id) => id !== card.objectId)
        : mode.selected.length < mode.detail.maxTargets
          ? [...mode.selected, card.objectId]
          : mode.selected
      setMode({ ...mode, selected })
      return
    }

    if (mode.kind === 'objectPick') {
      if (!mode.detail.choices.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const d = mode.detail
      setMode({ kind: 'idle' })
      if (d.type === 'PairChoice') {
        onSubmit(buildChoosePair(card.objectId))
      } else if (d.type === 'CopyTargetChoice') {
        onSubmit(buildChooseTarget({ kind: 'Object', id: card.objectId }))
      } else {
        onSubmit(buildChooseDamageSource(card.objectId))
      }
      return
    }

    if (mode.kind === 'targetStep') {
      const hit = mode.detail.legal.find(
        (t) => t.kind === 'Object' && t.id === card.objectId,
      )
      if (!hit) {
        setInspect(card)
        return
      }
      setMode({ kind: 'idle' })
      onSubmit(buildChooseTarget(hit))
      return
    }

    if (mode.kind === 'discard' || mode.kind === 'effectZone' || mode.kind === 'cardPick') {
      if (!mode.detail.cards.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const selected = mode.selected.includes(card.objectId)
        ? mode.selected.filter((id) => id !== card.objectId)
        : [...mode.selected, card.objectId]
      // Cap exact-count selections
      if (
        selected.length > mode.detail.count &&
        !mode.selected.includes(card.objectId)
      ) {
        return
      }
      setMode({ ...mode, selected })
      return
    }

    if (mode.kind === 'libraryBipart') {
      if (!mode.detail.cards.includes(card.objectId)) {
        setInspect(card)
        return
      }
      // Toggle rest (bottom / GY) membership
      const inRest = mode.rest.includes(card.objectId)
      setMode({
        ...mode,
        rest: inRest
          ? mode.rest.filter((id) => id !== card.objectId)
          : [...mode.rest, card.objectId],
      })
      return
    }

    if (mode.kind === 'reorderCards') {
      if (!mode.detail.cards.includes(card.objectId)) {
        setInspect(card)
        return
      }
      if (mode.detail.type === 'ArrangePlanarDeckTopChoice') {
        const keep = mode.detail.exactKeepCount ?? 0
        if (mode.order.includes(card.objectId)) {
          setMode({
            ...mode,
            order: mode.order.filter((id) => id !== card.objectId),
          })
        } else if (mode.order.length < keep) {
          setMode({ ...mode, order: [...mode.order, card.objectId] })
        }
        return
      }
      setInspect(card)
      return
    }

    if (mode.kind === 'modeChoice') {
      setInspect(card)
      return
    }

    const acts = view.actionsByObject[card.objectId]
    if (acts && acts.length > 0) {
      const untargeted = pickUntargetedCast(acts)
      if (
        untargeted &&
        acts.filter((a) => a.type === untargeted.type).length === 1 &&
        acts.length === 1
      ) {
        submitWithManaPreview(untargeted)
        return
      }
      // ActivateAbility: same mana/optional/target WaitingFor flow as casts after submit.
      // Prefer a single activate over mixed mana taps (mana still legal during payment).
      const activatePref = preferActivateAbility(acts)
      if (activatePref && activatePref !== 'picker') {
        submitWithManaPreview(activatePref)
        return
      }
      if (activatePref === 'picker') {
        setPicker({
          objectId: card.objectId,
          name: card.card.name,
          actions: acts.filter(isActivateAbility),
        })
        return
      }
      if (needsTargetingWizard(acts)) {
        setMode({
          kind: 'targeting',
          sourceName: card.card.name,
          objectId: card.objectId,
          variants: acts,
          selected: [],
        })
        setPicker(null)
        return
      }
      if (acts.length === 1) {
        submitWithManaPreview(acts[0]!)
        return
      }
      const primary = pickPrimaryAction(acts)
      setPicker({
        objectId: card.objectId,
        name: card.card.name,
        actions: acts,
      })
      void primary
      return
    }
    setInspect(card)
  }

  function onCardInspect(card: PhaseObjectView) {
    setInspect(card)
  }

  function confirmAttackers() {
    if (mode.kind !== 'attackers') return
    // Apply per-attacker target overrides when present
    if (Object.keys(mode.attackTargets).length > 0 && mode.selected.length > 0) {
      const attacks: Array<[number, import('@/engine/engineInteraction').AttackTarget]> = []
      for (const id of mode.selected) {
        const t =
          mode.attackTargets[id] ??
          (mode.detail.validAttackTargetsByAttacker?.[id] ??
            mode.detail.validAttackTargets)[0]
        if (!t) return
        const n = Number(id)
        if (!Number.isFinite(n)) return
        attacks.push([n, t])
      }
      setMode({ kind: 'idle' })
      onSubmit({ type: 'DeclareAttackers', data: { attacks, bands: [] } })
      return
    }
    const action =
      mode.selected.length === 0
        ? buildDeclareNoneAttackers()
        : buildDeclareAttackersAction(mode.selected, mode.detail)
    if (!action) return
    setMode({ kind: 'idle' })
    onSubmit(action)
  }

  function confirmBlockers() {
    if (mode.kind !== 'blockers') return
    const action =
      mode.assignments.length === 0
        ? buildDeclareNoneBlockers()
        : buildDeclareBlockersAction(mode.assignments)
    setMode({ kind: 'idle' })
    onSubmit(action)
  }


  function confirmCrewLike() {
    if (mode.kind !== 'crewLike') return
    if (!crewLikeReady(mode.detail, mode.selected)) return
    const d = mode.detail
    setMode({ kind: 'idle' })
    if (d.type === 'CrewVehicle') {
      onSubmit(buildCrewVehicle(d.subjectId, mode.selected))
    } else {
      onSubmit(buildSaddleMount(d.subjectId, mode.selected))
    }
  }

  function confirmMultiTarget() {
    if (mode.kind !== 'multiTarget') return
    if (!multiTargetReady(mode.detail, mode.selected)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSelectCards(mode.selected))
  }

  function confirmAssignCombatDamage() {
    if (mode.kind !== 'assignCombatDamage') return
    if (
      !combatDamageReady(
        mode.detail,
        mode.mode,
        mode.amounts,
        mode.trampleDamage,
        mode.controllerDamage,
      )
    ) {
      return
    }
    setMode({ kind: 'idle' })
    onSubmit(
      buildAssignCombatDamage(
        mode.mode,
        mode.amounts,
        mode.trampleDamage,
        mode.controllerDamage,
      ),
    )
  }

  function confirmAssignBlockerDamage() {
    if (mode.kind !== 'assignBlockerDamage') return
    if (!blockerDamageReady(mode.detail, mode.amounts)) return
    setMode({ kind: 'idle' })
    onSubmit(buildAssignBlockerDamage(mode.amounts))
  }

  function confirmDiscard() {
    if (mode.kind !== 'discard') return
    if (!discardReady(mode.detail, mode.selected)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSelectCards(mode.selected))
  }

  function confirmEffectZone() {
    if (mode.kind !== 'effectZone') return
    if (!effectZoneReady(mode.detail, mode.selected)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSelectCards(mode.selected))
  }

  function confirmModes() {
    if (mode.kind !== 'modeChoice') return
    if (!modeChoiceReady(mode.detail, mode.selected)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSelectModes(mode.selected))
  }

  function objectLabel(id: string): string {
    for (const seat of view.seats) {
      const hit =
        seat.battlefield.find((c) => c.objectId === id) ||
        seat.hand.find((c) => c.objectId === id) ||
        seat.command.find((c) => c.objectId === id) ||
        seat.graveyard.find((c) => c.objectId === id)
      if (hit) return hit.card.name
    }
    return view.objectNames?.[id] || `#${id}`
  }

  function moveInOrder(ids: string[], index: number, dir: -1 | 1): string[] {
    const j = index + dir
    if (j < 0 || j >= ids.length) return ids
    const next = [...ids]
    const tmp = next[index]!
    next[index] = next[j]!
    next[j] = tmp
    return next
  }

  function moveIndexOrder(order: number[], index: number, dir: -1 | 1): number[] {
    const j = index + dir
    if (j < 0 || j >= order.length) return order
    const next = [...order]
    const tmp = next[index]!
    next[index] = next[j]!
    next[j] = tmp
    return next
  }

  function confirmLibraryBipart() {
    if (mode.kind !== 'libraryBipart') return
    const keep = mode.order.filter((id) => !mode.rest.includes(id))
    if (!libraryBipartReady(mode.detail, keep)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSelectCards(keep))
  }

  function confirmReorderCards() {
    if (mode.kind !== 'reorderCards') return
    if (!reorderCardsReady(mode.detail, mode.order)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSelectCards(mode.order))
  }

  function confirmCardPick() {
    if (mode.kind !== 'cardPick') return
    if (!cardPickReady(mode.detail, mode.selected)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSelectCards(mode.selected))
  }

  function confirmOrderTriggers() {
    if (mode.kind !== 'orderTriggers') return
    if (mode.order.length !== mode.detail.triggers.length) return
    setMode({ kind: 'idle' })
    onSubmit(buildOrderTriggers(mode.order))
  }

  function confirmReplacement() {
    if (mode.kind !== 'replacement') return
    const d = mode.detail
    if (isReplacementOrderMode(d)) {
      if (mode.remember && d.canRemember) {
        setMode({ kind: 'idle' })
        onSubmit(
          buildChooseReplacementAndRemember({
            type: 'Order',
            data: { order: mode.order },
          }),
        )
        return
      }
      // Iterative: apply first in order; Phase may re-ask for the rest.
      const first = mode.order[0]
      if (first == null) return
      setMode({ kind: 'idle' })
      onSubmit(buildChooseReplacement(first))
      return
    }
    // OptionalBranch / SearchFoundDestination / single candidate — pick first selected = order[0]
    const idx = mode.order[0] ?? 0
    if (mode.remember && d.canRemember) {
      setMode({ kind: 'idle' })
      onSubmit(
        buildChooseReplacementAndRemember({
          type: 'Optional',
          data: { index: idx },
        }),
      )
      return
    }
    setMode({ kind: 'idle' })
    onSubmit(buildChooseReplacement(idx))
  }

  function confirmPayAmount() {
    if (mode.kind !== 'payAmount') return
    if (!payAmountInRange(mode.detail, mode.value)) return
    setMode({ kind: 'idle' })
    onSubmit(buildSubmitPayAmount(mode.value))
  }

  function runManaShortcuts() {
    const acts = view.manaPaymentShortcutActions ?? []
    if (acts.length === 0) return
    if (onSubmitChain) onSubmitChain(acts)
    else {
      for (const a of acts) onSubmit(a)
    }
  }

  if (!view.ok || !you) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
        {view.reason ?? 'Board map incomplete'} — use the action list below.
      </div>
    )
  }

  function poolPinRow() {
    const pool = you.manaPool ?? []
    if (pool.length === 0) return null
    const usable = pool.filter((p) => !p.restrictions.includes('ConvokePayment'))
    if (usable.length === 0) return null
    return (
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-amber-200/70">
          Pool pin
        </span>
        {usable.map((pip) => {
          const isPinned = pinnedPool.has(pip.pipId)
          return (
            <button
              key={pip.pipId}
              type="button"
              disabled={busy}
              title={
                isPinned
                  ? `Unspend ${pip.color} #${pip.pipId}`
                  : `Spend ${pip.color} #${pip.pipId}`
              }
              className={[
                'rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums disabled:opacity-40',
                isPinned
                  ? 'bg-emerald-600 text-white ring-1 ring-emerald-300'
                  : 'bg-slate-800 text-amber-100 ring-1 ring-amber-700/50 hover:bg-slate-700',
              ].join(' ')}
              onClick={() =>
                onSubmit(
                  isPinned
                    ? buildUnspendPoolMana(pip.pipId)
                    : buildSpendPoolMana(pip.pipId),
                )
              }
            >
              {(pip.color[0] ?? '?').toUpperCase()}
              {isPinned ? '✓' : ''}
            </button>
          )
        })}
      </div>
    )
  }


  function manaPoolReadout() {
    const counts = aggregateManaPool(you.manaPool)
    const rows = manaCountsEntries(counts)
    return (
      <div
        className="flex flex-wrap items-center gap-1 rounded-lg border border-amber-500/25 bg-black/45 px-2 py-1"
        title="Your mana pool (Phase mana_pool)"
      >
        <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-200/60">
          Mana
        </span>
        {rows.length === 0 ? (
          <span className="text-[10px] tabular-nums text-emerald-100/35">empty</span>
        ) : (
          rows.map(({ color, count }) => (
            <span
              key={color}
              className={[
                'inline-flex min-w-[1.35rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                MANA_PIP_CLASS[color] ?? 'bg-slate-700 text-slate-100',
              ].join(' ')}
              title={`${count}× ${color}`}
            >
              {MANA_PIP_GLYPH[color] ?? color[0] ?? '?'}
              {count > 1 ? count : ''}
            </span>
          ))
        )}
        {counts.total > 0 && (
          <span className="text-[9px] tabular-nums text-amber-100/45">{counts.total}</span>
        )}
      </div>
    )
  }

  const paymentBar = (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
      <span className="text-slate-500">Pay:</span>
      {(['Auto', 'Manual', 'AutoExceptSacrificialMana'] as CastPaymentModeType[]).map(
        (m) => (
          <button
            key={m}
            type="button"
            disabled={busy || mode.kind === 'manaPay' || mode.kind === 'phyrexian'}
            onClick={() => setPaymentPref(m)}
            className={[
              'rounded px-2 py-0.5 font-medium',
              paymentPref === m
                ? 'bg-amber-600/90 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
              'disabled:opacity-40',
            ].join(' ')}
            title={
              m === 'Auto'
                ? 'Engine auto-taps payment (default)'
                : m === 'Manual'
                  ? 'Cast then tap paying permanents yourself'
                  : 'Auto until a sacrifice-mana source — then pick'
            }
          >
            {PAY_LABEL[m]}
          </button>
        ),
      )}
    </div>
  )

  const modeBanner =
    mode.kind === 'targeting' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-50">
        <span>
          Choose target{mode.selected.length ? `s (${mode.selected.length})` : ''} for{' '}
          <strong>{mode.sourceName}</strong>
          {targetGlow.size ? ` · ${targetGlow.size} legal` : ''}
          <span className="ml-2 text-rose-200/70">({PAY_LABEL[paymentPref]} pay)</span>
        </span>
        <button
          type="button"
          className="ml-auto min-h-10 rounded bg-rose-800/80 px-3 py-2 text-xs hover:bg-rose-700"
          onClick={() => setMode({ kind: 'idle' })}
        >
          Cancel
        </button>
      </div>
    ) : mode.kind === 'attackers' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Declare attackers · tap creatures ({mode.selected.length} selected)
            {mode.pendingAttacker ? ' · pick attack target' : ''}
          </span>
          <button
            type="button"
            disabled={busy}
            className="min-h-10 rounded bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
            onClick={confirmAttackers}
          >
            {mode.selected.length === 0
              ? 'Declare none'
              : `Attack (${mode.selected.length})`}
          </button>
        </div>
        {mode.pendingAttacker && (
          <div className="flex flex-wrap gap-1">
            {(
              mode.detail.validAttackTargetsByAttacker?.[mode.pendingAttacker] ??
              mode.detail.validAttackTargets
            ).map((t, i) => (
              <button
                key={i}
                type="button"
                className="rounded bg-orange-800/80 px-2 py-1 text-xs hover:bg-orange-700"
                onClick={() => {
                  const id = mode.pendingAttacker!
                  setMode({
                    ...mode,
                    pendingAttacker: null,
                    attackTargets: { ...mode.attackTargets, [id]: t },
                    selected: mode.selected.includes(id)
                      ? mode.selected
                      : [...mode.selected, id],
                  })
                }}
              >
                {t.type}
                {typeof t.data === 'number' ? ` ${t.data}` : ''}
              </button>
            ))}
            <button
              type="button"
              className="rounded bg-slate-700 px-2 py-1 text-xs"
              onClick={() =>
                setMode({
                  ...mode,
                  pendingAttacker: null,
                  selected: mode.selected.filter((id) => id !== mode.pendingAttacker),
                })
              }
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    ) : mode.kind === 'blockers' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <span>
          {mode.pendingBlocker
            ? 'Choose attacker to block'
            : `Declare blockers · ${mode.assignments.length} assigned`}
        </span>
        <button
          type="button"
          disabled={busy}
          className="min-h-10 rounded bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          onClick={confirmBlockers}
        >
          {mode.assignments.length === 0
            ? 'Declare none'
            : `Confirm blocks (${mode.assignments.length})`}
        </button>
        {mode.pendingBlocker && (
          <button
            type="button"
            className="rounded bg-slate-700 px-2 py-1 text-xs"
            onClick={() => setMode({ ...mode, pendingBlocker: null })}
          >
            Cancel blocker
          </button>
        )}
      </div>
    ) : mode.kind === 'assignCombatDamage' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Assign combat damage from{' '}
            <strong>{objectLabel(mode.detail.attackerId)}</strong> ·{' '}
            {combatDamageAssignedTotal(
              mode.amounts,
              mode.trampleDamage,
              mode.controllerDamage,
            )}
            /{mode.detail.totalDamage}
            {mode.detail.trample ? ` · trample ${mode.detail.trample}` : ''}
          </span>
          <button
            type="button"
            disabled={
              busy ||
              !combatDamageReady(
                mode.detail,
                mode.mode,
                mode.amounts,
                mode.trampleDamage,
                mode.controllerDamage,
              )
            }
            className="min-h-10 rounded bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
            onClick={confirmAssignCombatDamage}
          >
            Confirm damage
          </button>
          <button
            type="button"
            className="rounded bg-slate-700 px-2 py-1 text-xs"
            onClick={() => {
              const split = defaultCombatDamageSplit(mode.detail)
              setMode({
                ...mode,
                mode: 'Normal',
                amounts: split.amounts,
                trampleDamage: split.trampleDamage,
                controllerDamage: split.controllerDamage,
              })
            }}
          >
            Reset
          </button>
        </div>
        {mode.detail.assignmentModes.includes('AsThoughUnblocked') && (
          <div className="flex flex-wrap gap-1">
            {(['Normal', 'AsThoughUnblocked'] as CombatDamageAssignmentMode[])
              .filter((m) => mode.detail.assignmentModes.includes(m))
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  className={[
                    'rounded px-2 py-1 text-xs',
                    mode.mode === m
                      ? 'bg-orange-500 text-white'
                      : 'bg-orange-900/70 hover:bg-orange-800',
                  ].join(' ')}
                  onClick={() => {
                    if (m === 'AsThoughUnblocked') {
                      setMode({
                        ...mode,
                        mode: m,
                        amounts: {},
                        trampleDamage: 0,
                        controllerDamage: 0,
                      })
                    } else {
                      const split = defaultCombatDamageSplit(mode.detail)
                      setMode({
                        ...mode,
                        mode: m,
                        amounts: split.amounts,
                        trampleDamage: split.trampleDamage,
                        controllerDamage: split.controllerDamage,
                      })
                    }
                  }}
                >
                  {m === 'AsThoughUnblocked' ? 'As though unblocked' : 'Normal'}
                </button>
              ))}
          </div>
        )}
        {mode.mode === 'Normal' && (
          <div className="flex flex-col gap-1">
            {mode.detail.blockers.map((slot) => (
              <div
                key={slot.blockerId}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="min-w-[8rem] truncate">
                  {objectLabel(slot.blockerId)}
                  <span className="text-orange-200/50">
                    {' '}
                    (lethal {slot.lethalMinimum})
                  </span>
                </span>
                <button
                  type="button"
                  className="rounded bg-orange-900 px-2 py-0.5"
                  onClick={() =>
                    setMode({
                      ...mode,
                      amounts: {
                        ...mode.amounts,
                        [slot.blockerId]: Math.max(
                          0,
                          (mode.amounts[slot.blockerId] ?? 0) - 1,
                        ),
                      },
                    })
                  }
                >
                  −
                </button>
                <span className="w-6 text-center tabular-nums font-semibold">
                  {mode.amounts[slot.blockerId] ?? 0}
                </span>
                <button
                  type="button"
                  className="rounded bg-orange-900 px-2 py-0.5"
                  onClick={() =>
                    setMode({
                      ...mode,
                      amounts: {
                        ...mode.amounts,
                        [slot.blockerId]: (mode.amounts[slot.blockerId] ?? 0) + 1,
                      },
                    })
                  }
                >
                  +
                </button>
              </div>
            ))}
            {mode.detail.trample != null && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-[8rem]">
                  Trample → defender
                  {mode.detail.trample === 'OverPlaneswalkers' && mode.detail.pwLoyalty != null
                    ? ` (PW loyalty ${mode.detail.pwLoyalty})`
                    : ''}
                </span>
                <button
                  type="button"
                  className="rounded bg-orange-900 px-2 py-0.5"
                  onClick={() =>
                    setMode({
                      ...mode,
                      trampleDamage: Math.max(0, mode.trampleDamage - 1),
                    })
                  }
                >
                  −
                </button>
                <span className="w-6 text-center tabular-nums font-semibold">
                  {mode.trampleDamage}
                </span>
                <button
                  type="button"
                  className="rounded bg-orange-900 px-2 py-0.5"
                  onClick={() =>
                    setMode({ ...mode, trampleDamage: mode.trampleDamage + 1 })
                  }
                >
                  +
                </button>
              </div>
            )}
            {mode.detail.trample === 'OverPlaneswalkers' &&
              mode.detail.pwController != null && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="min-w-[8rem]">
                    Excess → P{mode.detail.pwController}
                  </span>
                  <button
                    type="button"
                    className="rounded bg-orange-900 px-2 py-0.5"
                    onClick={() =>
                      setMode({
                        ...mode,
                        controllerDamage: Math.max(0, mode.controllerDamage - 1),
                      })
                    }
                  >
                    −
                  </button>
                  <span className="w-6 text-center tabular-nums font-semibold">
                    {mode.controllerDamage}
                  </span>
                  <button
                    type="button"
                    className="rounded bg-orange-900 px-2 py-0.5"
                    onClick={() =>
                      setMode({
                        ...mode,
                        controllerDamage: mode.controllerDamage + 1,
                      })
                    }
                  >
                    +
                  </button>
                </div>
              )}
          </div>
        )}
      </div>
    ) : mode.kind === 'assignBlockerDamage' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Assign blocker damage from{' '}
            <strong>{objectLabel(mode.detail.blockerId)}</strong> ·{' '}
            {Object.values(mode.amounts).reduce((a, b) => a + b, 0)}/
            {mode.detail.totalDamage}
          </span>
          <button
            type="button"
            disabled={busy || !blockerDamageReady(mode.detail, mode.amounts)}
            className="rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            onClick={confirmAssignBlockerDamage}
          >
            Confirm damage
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {mode.detail.attackers.map((aid) => (
            <div key={aid} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-[8rem] truncate">{objectLabel(aid)}</span>
              <button
                type="button"
                className="rounded bg-orange-900 px-2 py-0.5"
                onClick={() =>
                  setMode({
                    ...mode,
                    amounts: {
                      ...mode.amounts,
                      [aid]: Math.max(0, (mode.amounts[aid] ?? 0) - 1),
                    },
                  })
                }
              >
                −
              </button>
              <span className="w-6 text-center tabular-nums font-semibold">
                {mode.amounts[aid] ?? 0}
              </span>
              <button
                type="button"
                className="rounded bg-orange-900 px-2 py-0.5"
                onClick={() =>
                  setMode({
                    ...mode,
                    amounts: {
                      ...mode.amounts,
                      [aid]: (mode.amounts[aid] ?? 0) + 1,
                    },
                  })
                }
              >
                +
              </button>
            </div>
          ))}
        </div>
      </div>
    ) : mode.kind === 'manaPay' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-amber-50">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Pay mana · tap glowing sources
            {manaTapGlow.size ? ` (${manaTapGlow.size})` : ''}
          </span>
          {(view.manaPaymentShortcutActions?.length ?? 0) > 0 && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-amber-700 px-2 py-1 text-xs font-semibold disabled:opacity-40"
              onClick={runManaShortcuts}
              title="Tap each land that has exactly one TapLandForMana option"
            >
              Tap simple ({view.manaPaymentShortcutActions!.length})
            </button>
          )}
          {passAction && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
              onClick={() => onSubmit(passAction)}
            >
              Confirm pay
            </button>
          )}
          {cancelCast && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40"
              onClick={() => onSubmit(cancelCast)}
            >
              Cancel cast
            </button>
          )}
        </div>
        {poolPinRow()}
      </div>
    ) : mode.kind === 'manaSource' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-amber-50">
        <span>Sacrifice / special mana source — pick an engine option:</span>
        <div className="flex max-h-40 flex-col gap-1 overflow-auto">
          {mode.detail.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              disabled={busy}
              className="rounded border border-amber-700/60 bg-amber-950/80 px-2 py-1.5 text-left text-xs hover:border-amber-400 disabled:opacity-40"
              onClick={() => {
                setMode({ kind: 'idle' })
                onSubmit(buildActivateManaSource(opt))
              }}
            >
              {summarizeManaSourceOption(opt, i)}
            </button>
          ))}
        </div>
        {backToMana && (
          <button
            type="button"
            disabled={busy}
            className="self-start rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => onSubmit(backToMana)}
          >
            Back to mana payment
          </button>
        )}
      </div>
    ) : mode.kind === 'discard' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-50">
        <span>
          Discard {mode.detail.upTo ? `up to ${mode.detail.count}` : mode.detail.count} ·{' '}
          {mode.selected.length} selected
        </span>
        <button
          type="button"
          disabled={busy || !discardReady(mode.detail, mode.selected)}
          className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmDiscard}
        >
          Confirm discard
        </button>
      </div>
    ) : mode.kind === 'effectZone' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-400/40 bg-violet-950/50 px-3 py-2 text-sm text-violet-50">
        <span>
          Choose {mode.detail.upTo ? `up to ${mode.detail.count}` : mode.detail.count}
          {mode.detail.zone ? ` from ${mode.detail.zone}` : ''} · {mode.selected.length}{' '}
          selected
        </span>
        <button
          type="button"
          disabled={busy || !effectZoneReady(mode.detail, mode.selected)}
          className="rounded bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmEffectZone}
        >
          Confirm
        </button>
      </div>
    ) : mode.kind === 'modeChoice' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-sky-400/40 bg-sky-950/50 px-3 py-2 text-sm text-sky-50">
        <span>
          Choose mode{mode.detail.maxChoices > 1 ? 's' : ''} ({mode.detail.minChoices}
          {mode.detail.maxChoices !== mode.detail.minChoices
            ? `–${mode.detail.maxChoices}`
            : ''}
          )
        </span>
        <div className="flex max-h-48 flex-col gap-1 overflow-auto">
          {mode.detail.modeDescriptions.map((desc, index) => {
            const blocked = mode.detail.unavailableModes.includes(index)
            const on = mode.selected.includes(index)
            return (
              <button
                key={index}
                type="button"
                disabled={busy || blocked}
                className={[
                  'rounded border px-2 py-1.5 text-left text-xs disabled:opacity-40',
                  on
                    ? 'border-sky-400 bg-sky-900/80'
                    : 'border-sky-800/60 bg-sky-950/60 hover:border-sky-500',
                ].join(' ')}
                onClick={() => {
                  if (mode.detail.maxChoices <= 1) {
                    setMode({ ...mode, selected: [index] })
                    return
                  }
                  if (on) {
                    setMode({
                      ...mode,
                      selected: mode.selected.filter((i) => i !== index),
                    })
                    return
                  }
                  if (
                    !mode.detail.allowRepeat &&
                    mode.selected.length >= mode.detail.maxChoices
                  ) {
                    return
                  }
                  setMode({ ...mode, selected: [...mode.selected, index] })
                }}
              >
                {index + 1}. {desc || `(mode ${index + 1})`}
                {blocked ? ' (unavailable)' : ''}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          disabled={busy || !modeChoiceReady(mode.detail, mode.selected)}
          className="self-start rounded bg-sky-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmModes}
        >
          Confirm modes
        </button>
      </div>
    ) : mode.kind === 'phyrexian' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-rose-400/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-50">
        <span>
          Phyrexian mana · tap sources, pin pool, then choose life vs mana per shard
        </span>
        <div className="flex flex-wrap gap-1.5">
          {mode.detail.shards.map((s) => {
            const pick = mode.picks.get(s.shardIndex) ?? 'mana'
            const locked = s.options.type !== 'ManaOrLife'
            return (
              <button
                key={s.shardIndex}
                type="button"
                disabled={busy || locked}
                className={[
                  'rounded px-2 py-1 text-xs ring-1 disabled:opacity-50',
                  pick === 'life'
                    ? 'bg-red-900/70 text-red-100 ring-red-400/50'
                    : 'bg-slate-800 text-slate-100 ring-slate-500/50',
                ].join(' ')}
                onClick={() => {
                  if (locked) return
                  const next = new Map(mode.picks)
                  next.set(s.shardIndex, pick === 'life' ? 'mana' : 'life')
                  setMode({ ...mode, picks: next })
                }}
                title={
                  locked
                    ? `${s.options.type} (${s.color})`
                    : `Toggle ${s.color}/P — now ${pick}`
                }
              >
                {s.color[0]}/P · {pick === 'life' ? '2 life' : 'mana'}
              </button>
            )
          })}
        </div>
        {poolPinRow()}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || mode.detail.shards.length === 0}
            className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            onClick={() => {
              const choices = phyrexianChoicesPayload(mode.detail.shards, mode.picks)
              setMode({ kind: 'idle' })
              onSubmit(buildSubmitPhyrexianChoices(choices))
            }}
          >
            Confirm Phyrexian
          </button>
          {cancelCast && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40"
              onClick={() => onSubmit(cancelCast)}
            >
              Cancel cast
            </button>
          )}
        </div>
      </div>
    ) : mode.kind === 'chooseX' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-fuchsia-400/40 bg-fuchsia-950/50 px-3 py-2 text-sm text-fuchsia-50">
        <span>
          Choose X ({mode.detail.min}
          {mode.detail.max !== mode.detail.min ? `–${mode.detail.max}` : ''})
        </span>
        <input
          type="number"
          className="w-20 rounded border border-fuchsia-700 bg-fuchsia-950 px-2 py-1 text-sm text-white"
          min={mode.detail.min}
          max={mode.detail.max}
          value={mode.value}
          disabled={busy || mode.detail.min > mode.detail.max}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            setMode({ ...mode, value: n })
          }}
        />
        <button
          type="button"
          disabled={busy || !chooseXInRange(mode.detail, mode.value)}
          className="rounded bg-fuchsia-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildChooseX(mode.value))
          }}
        >
          Confirm X
        </button>
        {cancelCast && (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => onSubmit(cancelCast)}
          >
            Cancel cast
          </button>
        )}
      </div>
    ) : mode.kind === 'assistPlayer' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-teal-400/40 bg-teal-950/50 px-3 py-2 text-sm text-teal-50">
        <span>
          Assist — choose a helper (max generic {mode.detail.maxGeneric})
        </span>
        <div className="flex flex-wrap gap-1.5">
          {mode.detail.candidates.map((pid) => (
            <button
              key={pid}
              type="button"
              disabled={busy}
              className="rounded bg-teal-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
              onClick={() => {
                setMode({ kind: 'idle' })
                onSubmit(buildChooseAssistPlayer(pid))
              }}
            >
              {pid === 0 ? 'You' : `P${pid}`}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
            onClick={() => {
              setMode({ kind: 'idle' })
              onSubmit(buildChooseAssistPlayer(null))
            }}
          >
            Decline assist
          </button>
          {cancelCast && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-800 px-2 py-1 text-xs disabled:opacity-40"
              onClick={() => onSubmit(cancelCast)}
            >
              Cancel cast
            </button>
          )}
        </div>
      </div>
    ) : mode.kind === 'assistPay' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-400/40 bg-teal-950/50 px-3 py-2 text-sm text-teal-50">
        <span>
          Assist payment · contribute 0–{mode.detail.maxGeneric} generic
          {mode.detail.caster != null ? ` for P${mode.detail.caster}` : ''}
        </span>
        <input
          type="number"
          className="w-20 rounded border border-teal-700 bg-teal-950 px-2 py-1 text-sm text-white"
          min={0}
          max={mode.detail.maxGeneric}
          value={mode.value}
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            setMode({ ...mode, value: n })
          }}
        />
        <button
          type="button"
          disabled={busy || !assistPaymentInRange(mode.detail, mode.value)}
          className="rounded bg-teal-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildCommitAssistPayment(mode.value))
          }}
        >
          Commit assist
        </button>
      </div>
    ) : mode.kind === 'libraryBipart' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-cyan-400/40 bg-cyan-950/50 px-3 py-2 text-sm text-cyan-50">
        <span>
          {mode.detail.type === 'SurveilChoice' ? 'Surveil' : 'Scry'} · tap to send to{' '}
          {mode.detail.type === 'SurveilChoice' ? 'graveyard' : 'bottom'} · reorder keep
          on top
        </span>
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {mode.order.map((id, index) => {
            const isRest = mode.rest.includes(id)
            return (
              <div
                key={id}
                className={[
                  'flex items-center gap-1 rounded border px-2 py-1 text-xs',
                  isRest
                    ? 'border-slate-600 bg-slate-900/70 text-slate-400 line-through'
                    : 'border-cyan-700/60 bg-cyan-950/70',
                ].join(' ')}
              >
                <button
                  type="button"
                  disabled={busy}
                  className="min-w-0 flex-1 truncate text-left disabled:opacity-40"
                  onClick={() => {
                    setMode({
                      ...mode,
                      rest: isRest
                        ? mode.rest.filter((x) => x !== id)
                        : [...mode.rest, id],
                    })
                  }}
                >
                  {objectLabel(id)}
                  {isRest
                    ? mode.detail.type === 'SurveilChoice'
                      ? ' → GY'
                      : ' → bottom'
                    : ' → top'}
                </button>
                {!isRest && (
                  <>
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                      onClick={() =>
                        setMode({
                          ...mode,
                          order: moveInOrder(mode.order, index, -1),
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === mode.order.length - 1}
                      className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                      onClick={() =>
                        setMode({
                          ...mode,
                          order: moveInOrder(mode.order, index, 1),
                        })
                      }
                    >
                      ↓
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          disabled={
            busy ||
            !libraryBipartReady(
              mode.detail,
              mode.order.filter((id) => !mode.rest.includes(id)),
            )
          }
          className="self-start rounded bg-cyan-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmLibraryBipart}
        >
          Confirm {mode.detail.type === 'SurveilChoice' ? 'surveil' : 'scry'}
        </button>
      </div>
    ) : mode.kind === 'reorderCards' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-indigo-400/40 bg-indigo-950/50 px-3 py-2 text-sm text-indigo-50">
        <span>
          {mode.detail.type === 'RippleBottomOrder'
            ? 'Order for library bottom'
            : mode.detail.type === 'RevealUntilBottomOrder'
              ? 'Order revealed cards (bottom)'
              : mode.detail.type === 'DigRestSplitChoice'
                ? `Split dig rest · top ${mode.detail.topCount ?? '?'}${
                    mode.detail.orderOnly ? ' (order only)' : ''
                  }`
                : `Arrange planar top · keep ${mode.detail.exactKeepCount ?? 0}`}
        </span>
        {mode.detail.type === 'ArrangePlanarDeckTopChoice' && (
          <div className="flex flex-wrap gap-1">
            {mode.detail.cards.map((id) => {
              const on = mode.order.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  className={[
                    'rounded border px-2 py-1 text-xs disabled:opacity-40',
                    on
                      ? 'border-indigo-400 bg-indigo-900/80'
                      : 'border-indigo-800/60 bg-indigo-950/60',
                  ].join(' ')}
                  onClick={() => {
                    const keep = mode.detail.exactKeepCount ?? 0
                    if (on) {
                      setMode({
                        ...mode,
                        order: mode.order.filter((x) => x !== id),
                      })
                    } else if (mode.order.length < keep) {
                      setMode({ ...mode, order: [...mode.order, id] })
                    }
                  }}
                >
                  {objectLabel(id)}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {(mode.detail.type === 'ArrangePlanarDeckTopChoice'
            ? mode.order
            : mode.order
          ).map((id, index) => (
            <div
              key={`${id}-${index}`}
              className="flex items-center gap-1 rounded border border-indigo-700/60 bg-indigo-950/70 px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">
                {index + 1}. {objectLabel(id)}
                {mode.detail.type === 'DigRestSplitChoice' &&
                mode.detail.topCount != null &&
                index < mode.detail.topCount
                  ? ' · top'
                  : mode.detail.type === 'DigRestSplitChoice'
                    ? ' · bottom'
                    : ''}
              </span>
              <button
                type="button"
                disabled={busy || index === 0}
                className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                onClick={() =>
                  setMode({
                    ...mode,
                    order: moveInOrder(mode.order, index, -1),
                  })
                }
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || index === mode.order.length - 1}
                className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                onClick={() =>
                  setMode({
                    ...mode,
                    order: moveInOrder(mode.order, index, 1),
                  })
                }
              >
                ↓
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !reorderCardsReady(mode.detail, mode.order)}
          className="self-start rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmReorderCards}
        >
          Confirm order
        </button>
      </div>
    ) : mode.kind === 'cardPick' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-emerald-400/40 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-50">
        <span>
          {mode.detail.type === 'SearchChoice'
            ? 'Search'
            : mode.detail.type === 'SearchPartitionChoice'
              ? 'Search partition'
              : mode.detail.type === 'DigChoice'
                ? 'Dig'
                : mode.detail.type === 'RevealChoice'
                  ? 'Reveal'
                  : 'Choose from zone'}
          {' · '}
          {mode.detail.optional
            ? 'optional'
            : mode.detail.upTo
              ? `up to ${mode.detail.count}`
              : mode.detail.count}
          {mode.detail.ordered ? ' · order matters' : ''} · {mode.selected.length}{' '}
          selected
        </span>
        <div className="flex max-h-56 flex-wrap gap-1 overflow-auto">
          {mode.detail.cards.map((id) => {
            const on = mode.selected.includes(id)
            return (
              <button
                key={id}
                type="button"
                disabled={busy}
                className={[
                  'rounded border px-2 py-1 text-xs disabled:opacity-40',
                  on
                    ? 'border-emerald-400 bg-emerald-900/80'
                    : 'border-emerald-800/60 bg-emerald-950/60',
                ].join(' ')}
                onClick={() => {
                  if (on) {
                    setMode({
                      ...mode,
                      selected: mode.selected.filter((x) => x !== id),
                    })
                    return
                  }
                  if (mode.selected.length >= mode.detail.count) return
                  setMode({ ...mode, selected: [...mode.selected, id] })
                }}
              >
                {objectLabel(id)}
              </button>
            )
          })}
        </div>
        {mode.detail.ordered && mode.selected.length > 1 && (
          <div className="flex max-h-40 flex-col gap-1 overflow-auto">
            {mode.selected.map((id, index) => (
              <div
                key={id}
                className="flex items-center gap-1 rounded border border-emerald-700/50 bg-emerald-950/60 px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  {index + 1}. {objectLabel(id)}
                </span>
                <button
                  type="button"
                  disabled={busy || index === 0}
                  className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                  onClick={() =>
                    setMode({
                      ...mode,
                      selected: moveInOrder(mode.selected, index, -1),
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy || index === mode.selected.length - 1}
                  className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                  onClick={() =>
                    setMode({
                      ...mode,
                      selected: moveInOrder(mode.selected, index, 1),
                    })
                  }
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !cardPickReady(mode.detail, mode.selected)}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            onClick={confirmCardPick}
          >
            Confirm
          </button>
          {mode.detail.optional && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
              onClick={() => {
                setMode({ kind: 'idle' })
                onSubmit(buildSelectCards([]))
              }}
            >
              Decline
            </button>
          )}
        </div>
      </div>
    ) : mode.kind === 'orderTriggers' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <span>Order triggered abilities (top resolves first)</span>
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {mode.order.map((ti, index) => {
            const t = mode.detail.triggers[ti]
            return (
              <div
                key={`${ti}-${index}`}
                className="flex items-center gap-1 rounded border border-orange-700/60 bg-orange-950/70 px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  {index + 1}. {t?.sourceName || t?.sourceId || `trigger ${ti}`}
                  {t?.description ? ` — ${t.description}` : ''}
                </span>
                <button
                  type="button"
                  disabled={busy || index === 0}
                  className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                  onClick={() =>
                    setMode({
                      ...mode,
                      order: moveIndexOrder(mode.order, index, -1),
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy || index === mode.order.length - 1}
                  className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                  onClick={() =>
                    setMode({
                      ...mode,
                      order: moveIndexOrder(mode.order, index, 1),
                    })
                  }
                >
                  ↓
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          disabled={busy || mode.order.length !== mode.detail.triggers.length}
          className="self-start rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmOrderTriggers}
        >
          Confirm order
        </button>
      </div>
    ) : mode.kind === 'replacement' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-lime-400/40 bg-lime-950/50 px-3 py-2 text-sm text-lime-50">
        <span>
          Replacement ({mode.detail.kindType}
          {mode.detail.lastAppliedDecides ? ' · last decides' : ''}) ·{' '}
          {mode.detail.candidateCount} candidate
          {mode.detail.candidateCount === 1 ? '' : 's'}
        </span>
        {isReplacementOrderMode(mode.detail) ? (
          <div className="flex max-h-56 flex-col gap-1 overflow-auto">
            {mode.order.map((ci, index) => {
              const c = mode.detail.candidates[ci]
              return (
                <div
                  key={`${ci}-${index}`}
                  className="flex items-center gap-1 rounded border border-lime-700/60 bg-lime-950/70 px-2 py-1 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {index + 1}.{' '}
                    {c?.sourceName || c?.description || `candidate ${ci}`}
                    {c?.description && c.sourceName
                      ? ` — ${c.description}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                    onClick={() =>
                      setMode({
                        ...mode,
                        order: moveIndexOrder(mode.order, index, -1),
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === mode.order.length - 1}
                    className="rounded bg-slate-700 px-1.5 py-0.5 disabled:opacity-30"
                    onClick={() =>
                      setMode({
                        ...mode,
                        order: moveIndexOrder(mode.order, index, 1),
                      })
                    }
                  >
                    ↓
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(
              { length: Math.max(mode.detail.candidateCount, mode.detail.candidates.length) },
              (_, i) => {
                const c = mode.detail.candidates[i]
                const on = mode.order[0] === i
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={busy}
                    className={[
                      'rounded border px-2 py-1 text-xs disabled:opacity-40',
                      on
                        ? 'border-lime-400 bg-lime-900/80'
                        : 'border-lime-800/60 bg-lime-950/60',
                    ].join(' ')}
                    onClick={() => setMode({ ...mode, order: [i] })}
                  >
                    {c?.sourceName || c?.description || `Option ${i + 1}`}
                  </button>
                )
              },
            )}
          </div>
        )}
        {mode.detail.canRemember && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={mode.remember}
              disabled={busy}
              onChange={(e) =>
                setMode({ ...mode, remember: e.target.checked })
              }
            />
            Remember for identical events
          </label>
        )}
        <button
          type="button"
          disabled={busy || mode.order.length === 0}
          className="self-start rounded bg-lime-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmReplacement}
        >
          Confirm replacement
        </button>
      </div>
    ) : mode.kind === 'payAmount' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-yellow-400/40 bg-yellow-950/50 px-3 py-2 text-sm text-yellow-50">
        <span>
          Pay {mode.detail.resourceType} ({mode.detail.min}
          {mode.detail.max !== mode.detail.min ? `–${mode.detail.max}` : ''})
          {mode.detail.sourceId
            ? ` · ${objectLabel(mode.detail.sourceId)}`
            : ''}
        </span>
        <input
          type="number"
          className="w-20 rounded border border-yellow-700 bg-yellow-950 px-2 py-1 text-sm text-white"
          min={mode.detail.min}
          max={mode.detail.max}
          value={mode.value}
          disabled={busy || mode.detail.min > mode.detail.max}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            setMode({ ...mode, value: n })
          }}
        />
        <button
          type="button"
          disabled={busy || !payAmountInRange(mode.detail, mode.value)}
          className="rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmPayAmount}
        >
          Confirm amount
        </button>
      </div>

    ) : mode.kind === 'crewLike' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-950/50 px-3 py-2 text-sm text-sky-50">
        <span>
          {mode.detail.type === 'CrewVehicle' ? 'Crew' : 'Saddle'}{' '}
          <strong>{objectLabel(mode.detail.subjectId)}</strong> · need{' '}
          {mode.detail.need} · contrib{' '}
          {selectedContributionTotal(
            mode.detail.eligible,
            mode.detail.contributions,
            mode.selected,
          )}
          /{mode.detail.need} · {mode.selected.length} tapped
        </span>
        <button
          type="button"
          disabled={busy || !crewLikeReady(mode.detail, mode.selected)}
          className="rounded bg-sky-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmCrewLike}
        >
          Confirm
        </button>
        {cancelCast && (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => onSubmit(cancelCast)}
          >
            Cancel
          </button>
        )}
      </div>
    ) : mode.kind === 'attachPick' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-950/50 px-3 py-2 text-sm text-sky-50">
        <span>
          {mode.detail.type === 'EquipTarget' ? 'Equip' : 'Station'}{' '}
          <strong>{objectLabel(mode.detail.subjectId)}</strong> — tap a glowing
          creature
        </span>
        {cancelCast && (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => onSubmit(cancelCast)}
          >
            Cancel
          </button>
        )}
      </div>
    ) : mode.kind === 'optionalCost' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-fuchsia-400/40 bg-fuchsia-950/50 px-3 py-2 text-sm text-fuchsia-50">
        <span>
          Optional cost ({mode.detail.origin}
          {mode.detail.timesKicked > 0
            ? ` · kicked ×${mode.detail.timesKicked}`
            : ''}
          ): {mode.detail.costLabel}
        </span>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-fuchsia-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildDecideOptionalCost(true))
          }}
        >
          Pay
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildDecideOptionalCost(false))
          }}
        >
          Don&apos;t pay
        </button>
      </div>
    ) : mode.kind === 'unlessPayment' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <span>
          Pay {mode.detail.costLabel} to prevent
          {mode.detail.effectDescription
            ? ` “${mode.detail.effectDescription}”`
            : ' the effect'}
          ?
        </span>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildPayUnlessCost(true))
          }}
        >
          Pay
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildPayUnlessCost(false))
          }}
        >
          Decline
        </button>
      </div>
    ) : mode.kind === 'unlessChooseCost' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <span>
          Choose a cost to prevent
          {mode.detail.effectDescription
            ? ` “${mode.detail.effectDescription}”`
            : ' the effect'}
          , or decline
        </span>
        <div className="flex flex-wrap gap-1.5">
          {mode.detail.costLabels.map((label, i) => (
            <button
              key={i}
              type="button"
              disabled={busy}
              className="rounded border border-orange-600 bg-orange-900/70 px-2 py-1 text-xs font-semibold disabled:opacity-40"
              onClick={() => {
                setMode({ kind: 'idle' })
                onSubmit(
                  buildChooseUnlessCostBranch({
                    type: 'Pay',
                    data: { index: i },
                  }),
                )
              }}
            >
              Pay: {label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
            onClick={() => {
              setMode({ kind: 'idle' })
              onSubmit(buildChooseUnlessCostBranch({ type: 'Decline' }))
            }}
          >
            Decline
          </button>
        </div>
      </div>
    ) : mode.kind === 'optionalEffect' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-400/40 bg-violet-950/50 px-3 py-2 text-sm text-violet-50">
        <span>
          {mode.detail.description}
          {mode.detail.sourceId
            ? ` · ${objectLabel(mode.detail.sourceId)}`
            : ''}
        </span>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildDecideOptionalEffect(true))
          }}
        >
          {mode.detail.type === 'TributeChoice' ? 'Pay tribute' : 'Accept'}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
          onClick={() => {
            setMode({ kind: 'idle' })
            onSubmit(buildDecideOptionalEffect(false))
          }}
        >
          {mode.detail.type === 'TributeChoice' ? 'Decline tribute' : 'Decline'}
        </button>
      </div>
    ) : mode.kind === 'targetStep' ? (
      <div className="flex flex-col gap-2 rounded-lg border border-rose-400/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-50">
        <span>
          Choose target
          {mode.detail.slotCount > 1
            ? ` (${mode.detail.currentSlot + 1}/${mode.detail.slotCount})`
            : ''}
          {mode.detail.modeLabel ? ` · ${mode.detail.modeLabel}` : ''}
          {mode.detail.description ? ` — ${mode.detail.description}` : ''}
          {mode.detail.optional ? ' (optional)' : ''}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {mode.detail.legal
            .filter((t) => t.kind === 'Player')
            .map((t) => (
              <button
                key={`p${t.id}`}
                type="button"
                disabled={busy}
                className="rounded border border-rose-500 bg-rose-900/70 px-2 py-1 text-xs font-semibold disabled:opacity-40"
                onClick={() => {
                  setMode({ kind: 'idle' })
                  onSubmit(buildChooseTarget(t))
                }}
              >
                Player {t.id}
              </button>
            ))}
          {mode.detail.optional && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
              onClick={() => {
                setMode({ kind: 'idle' })
                onSubmit(buildChooseTarget(null))
              }}
            >
              Skip
            </button>
          )}
          {cancelCast && mode.detail.type === 'TargetSelection' && (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-700 px-2 py-1 text-xs disabled:opacity-40"
              onClick={() => onSubmit(cancelCast)}
            >
              Cancel cast
            </button>
          )}
        </div>
        <span className="text-[11px] text-rose-200/70">
          Board glow = legal object targets — tap to choose
        </span>
      </div>
    ) : mode.kind === 'multiTarget' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-50">
        <span>
          Choose targets ({mode.detail.minTargets}
          {mode.detail.maxTargets !== mode.detail.minTargets
            ? `–${mode.detail.maxTargets}`
            : ''}
          ) · {mode.selected.length} selected
        </span>
        <button
          type="button"
          disabled={busy || !multiTargetReady(mode.detail, mode.selected)}
          className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          onClick={confirmMultiTarget}
        >
          Confirm
        </button>
      </div>
    ) : mode.kind === 'objectPick' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-950/50 px-3 py-2 text-sm text-cyan-50">
        <span>
          {mode.detail.type === 'PairChoice'
            ? 'Choose Soulbond partner'
            : mode.detail.type === 'CopyTargetChoice'
              ? 'Choose copy target'
              : 'Choose damage source'}
          {mode.detail.sourceId
            ? ` · ${objectLabel(mode.detail.sourceId)}`
            : ''}{' '}
          — tap a glowing permanent
          {mode.detail.choices.length === 0 ? ' (none legal)' : ''}
        </span>
        {mode.detail.allowSkip && (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-slate-700 px-3 py-1 text-xs disabled:opacity-40"
            onClick={() => {
              setMode({ kind: 'idle' })
              if (mode.detail.type === 'PairChoice') {
                onSubmit(buildChoosePair(null))
              } else {
                onSubmit(buildChooseTarget(null))
              }
            }}
          >
            Skip
          </button>
        )}
      </div>
    ) : waitingDetail?.kind === 'MulliganDecision' &&
      (mulliganActs.keep || mulliganActs.mulligan) ? (

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-400/40 bg-violet-950/50 px-3 py-2 text-sm text-violet-50">
        <span>Opening hand — keep or mulligan?</span>
        {mulliganActs.keep && (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            onClick={() => onSubmit(mulliganActs.keep!)}
          >
            Keep
          </button>
        )}
        {mulliganActs.mulligan && (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            onClick={() => onSubmit(mulliganActs.mulligan!)}
          >
            Mulligan
          </button>
        )}
      </div>
    ) : null

  function renderChip(
    c: PhaseObjectView,
    size: 'board' | 'boardLg' | 'land' | 'hand' | 'command' | 'tiny',
  ) {
    const g = chipGlow(c.objectId)
    return (
      <CardChip
        key={c.objectId}
        card={c.card}
        size={size}
        hideName
        tapped={c.tapped}
        faceDown={c.faceDown}
        highlighted={g.highlighted}
        glow={g.glow}
        selected={g.selected}
        onClick={() => onCardTap(c)}
        onInspect={() => onCardInspect(c)}
      />
    )
  }

  if (!you) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center text-sm text-slate-500">
        Waiting for Phase seats…
      </div>
    )
  }

  return (
    <div className="relative flex flex-col gap-2">
      <PhaseRail
        phase={view.phase}
        turnNumber={view.turnNumber}
        activeName={
          view.activePlayer === 0
            ? 'You'
            : `Seat ${view.activePlayer}`
        }
        yourTurn={view.priorityPlayer === 0}
        lastAutoNote={
          view.waitingFor
            ? `waiting: ${view.waitingFor}`
            : view.autoPass
              ? 'engine recommends pass'
              : null
        }
        stops={railStops}
        combatEntered={
          view.phase.startsWith('combat') ||
          waitingDetail?.kind === 'DeclareAttackers' ||
          waitingDetail?.kind === 'DeclareBlockers' ||
          waitingDetail?.kind === 'AssignCombatDamage' ||
          waitingDetail?.kind === 'AssignBlockerDamage'
        }
        attackersDeclared={
          view.phase === 'combat_blockers' ||
          view.phase === 'combat_damage' ||
          waitingDetail?.kind === 'DeclareBlockers' ||
          waitingDetail?.kind === 'AssignCombatDamage' ||
          waitingDetail?.kind === 'AssignBlockerDamage'
        }
        onPass={() => {
          if (passAction && (mode.kind === 'idle' || mode.kind === 'manaPay')) {
            onSubmit(passAction)
          }
        }}
        onToggleStop={() => {
          /* display-only stops from engine WaitingFor — no client authority */
        }}
        dock
      />

      {showPriorityBanner && (
        <div
          className={
            stackNonempty
              ? 'flex flex-wrap items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-950/50 px-3 py-2 text-xs text-violet-50'
              : 'flex flex-wrap items-center gap-2 rounded-xl border border-sky-400/35 bg-sky-950/45 px-3 py-2 text-xs text-sky-50'
          }
        >
          <span className="font-semibold uppercase tracking-wide">
            {stackNonempty ? 'Respond' : 'Your priority'}
          </span>
          <span className="min-w-0 flex-1 text-white/70">
            {stackNonempty
              ? `Stack has ${view.stackCount} · glow = legal responses · Pass to let it resolve`
              : boardResponses || respondableCount > 0
                ? 'Glow marks legal plays/activates · Pass to advance'
                : 'Nothing else legal · Pass to continue'}
          </span>
        </div>
      )}
      <div className="hidden items-center gap-3 sm:flex">
        {paymentBar}
        {manaPoolReadout()}
      </div>
      <div className="hidden sm:block">{modeBanner}</div>

      <div
        className="arena-board relative overflow-hidden rounded-3xl border-4 border-amber-950/80 pb-16 shadow-2xl shadow-black/50 sm:pb-0"
        style={{
          backgroundColor: '#0d3b2e',
          backgroundImage:
            'radial-gradient(ellipse at center, #1a6b4f 0%, #0a2f24 55%, #061a14 100%)',
          minHeight: '28rem',
        }}
      >
        <div className="relative flex min-h-[28rem] flex-col gap-2 p-2 sm:p-3">
          {opponents.length > 0 && (
            <div
              className={
                opponents.length === 1
                  ? 'flex flex-wrap items-start justify-center gap-3'
                  : 'grid gap-2 ' +
                    (opponents.length === 2
                      ? 'grid-cols-1 sm:grid-cols-2'
                      : 'grid-cols-1 sm:grid-cols-3')
              }
            >
              {opponents.map((opp) => (
                <div
                  key={`seat-${opp.id}`}
                  className={
                    'flex flex-wrap items-center justify-center gap-2 rounded-xl border px-2 py-1.5 ' +
                    (view.priorityPlayer === opp.id
                      ? 'border-violet-400/45 bg-violet-950/35'
                      : view.activePlayer === opp.id
                        ? 'border-amber-400/35 bg-amber-950/25'
                        : 'border-white/10 bg-black/35')
                  }
                >
                  <div className="flex items-center gap-2 text-[11px] text-emerald-100/80">
                    <div className="text-center">
                      <div className="font-semibold">
                        Seat {opp.id}
                        {opp.isEliminated ? ' ✕' : ''}
                        {view.priorityPlayer === opp.id ? ' · P' : ''}
                        {view.activePlayer === opp.id && view.priorityPlayer !== opp.id
                          ? ' · A'
                          : ''}
                      </div>
                      <div className="text-lg font-bold tabular-nums text-white">
                        {opp.life}
                      </div>
                      <div className="text-[10px] text-emerald-200/50">
                        H{opp.hand.length} · L{opp.libraryCount}
                      </div>
                    </div>
                    <SeatStatusBadges
                      poison={opp.poison}
                      commanderDamage={opp.commanderDamage}
                    />
                  </div>
                  {opp.hand.length > 0 && (
                    <div className="flex max-w-[10rem] flex-wrap justify-center gap-0.5">
                      {Array.from({
                        length: Math.min(opp.hand.length, opponents.length > 1 ? 7 : 10),
                      }).map((_, i) => (
                        <div
                          key={`opp-${opp.id}-h-${i}`}
                          className="h-7 w-[1.25rem] rounded-sm border border-slate-600/80 bg-gradient-to-b from-slate-800 to-slate-950 shadow"
                          title={`Seat ${opp.id} hand`}
                        />
                      ))}
                      {opp.hand.length > (opponents.length > 1 ? 7 : 10) && (
                        <span className="self-center text-[9px] text-emerald-100/40">
                          +{opp.hand.length - (opponents.length > 1 ? 7 : 10)}
                        </span>
                      )}
                    </div>
                  )}
                  {opp.command.length > 0 && (
                    <div className="flex gap-1">
                      {opp.command.map((c) => renderChip(c, 'command'))}
                    </div>
                  )}
                  {opp.battlefield.length > 0 && (
                    <div className="flex max-w-full flex-wrap justify-center gap-1">
                      {opp.nonLands
                        .slice(0, opponents.length > 1 ? 8 : 12)
                        .map((c) => renderChip(c, 'board'))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="combat-lane mx-4 h-px bg-gradient-to-r from-transparent via-rose-400/50 to-transparent" />

          <div className="min-h-[8rem] flex-1 rounded-xl border border-emerald-400/15 bg-black/20 p-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-100/45">
                Battlefield
              </span>
              <span className="text-[10px] tabular-nums text-emerald-100/35">
                {you.nonLands.length} · {you.lands.length} lands
                {view.stackCount > 0 ? ` · stack ${view.stackCount}` : ''}
              </span>
            </div>
            {you.nonLands.length === 0 ? (
              <p className="p-3 text-center text-xs text-emerald-100/30">
                Empty — cyan = legal · rose = target/discard · orange = combat · amber =
                mana
              </p>
            ) : (
              <div className="flex flex-wrap content-start items-end gap-2">
                {you.nonLands.map((c) => renderChip(c, 'boardLg'))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-emerald-400/10 bg-black/25 px-2 py-1.5">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-100/40">
              Lands
            </div>
            {you.lands.length === 0 ? (
              <p className="text-[10px] text-emerald-100/25">No lands</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                {you.lands.map((c) => renderChip(c, 'land'))}
              </div>
            )}
          </div>

          <div className="mt-auto grid grid-cols-[auto_1fr] items-end gap-2 sm:grid-cols-[auto_1fr_auto]">
            <div className="flex flex-col items-center gap-1">
              <LifeBadge
                life={you.life}
                size="lg"
                active={view.priorityPlayer === 0}
                lost={you.isEliminated}
              />
              <div className="text-[9px] text-emerald-100/50">L{you.libraryCount}</div>
              <SeatStatusBadges
                poison={you.poison}
                commanderDamage={you.commanderDamage}
              />
              {manaPoolReadout()}
            </div>

            <div className="flex min-h-[7.5rem] flex-wrap items-end justify-center gap-1 pb-1">
              {you.hand.map((c, i) => (
                <div
                  key={c.objectId}
                  style={{
                    marginLeft: i === 0 ? 0 : -10,
                    zIndex: i,
                    transform: `rotate(${(i - (you.hand.length - 1) / 2) * 2.2}deg)`,
                  }}
                >
                  {renderChip(c, 'hand')}
                </div>
              ))}
              {you.hand.length === 0 && (
                <p className="text-xs text-emerald-100/30">Hand empty</p>
              )}
            </div>

            <div className="col-span-2 flex flex-wrap justify-end gap-2 sm:col-span-1 sm:flex-col">
              {you.command.map((c) => {
                const acts = view.actionsByObject[c.objectId] ?? []
                const castable = acts.some(isCastFamily)
                const costLabel = formatSpellCostLabel(view.spellCosts[c.objectId])
                return (
                  <div key={c.objectId} className="relative flex flex-col items-center gap-0.5">
                    {renderChip(c, 'command')}
                    {castable && (
                      <span className="absolute -right-1 -top-1 rounded bg-cyan-400 px-1 text-[8px] font-bold uppercase text-cyan-950 shadow">
                        Cast
                      </span>
                    )}
                    {costLabel && (
                      <span
                        className={
                          castable
                            ? 'rounded bg-cyan-950/80 px-1 text-[9px] font-semibold tabular-nums text-cyan-100 ring-1 ring-cyan-400/50'
                            : 'rounded bg-black/50 px-1 text-[9px] tabular-nums text-emerald-100/55'
                        }
                        title="Effective cost from Phase (includes commander tax)"
                      >
                        {costLabel}
                      </span>
                    )}
                  </div>
                )
              })}
              <div className="flex gap-1 text-[10px] text-emerald-100/45">
                <span>GY {you.graveyard.length}</span>
                <span>Ex {you.exile.length}</span>
              </div>
            </div>
          </div>
        </div>

        {(view.stackGroups?.length ?? 0) > 0 && (
          <div className="pointer-events-auto absolute right-3 top-3 z-20 flex max-h-[70%] w-[9.5rem] flex-col-reverse gap-1.5 overflow-y-auto rounded-xl border border-violet-400/35 bg-black/70 p-1.5 shadow-xl shadow-violet-950/40 backdrop-blur-sm">
            <div className="px-1 pb-0.5 text-center text-[9px] font-semibold uppercase tracking-wider text-violet-200/70">
              Stack · {view.stackCount}
            </div>
            {[...(view.stackGroups ?? [])].reverse().map((g) => (
              <div
                key={g.representativeId + '-' + g.memberIds.join(',')}
                className={[
                  'relative flex flex-col gap-0.5 rounded-lg border px-1.5 py-1',
                  g.isTop
                    ? 'border-violet-300 bg-violet-600/40 ring-2 ring-violet-300/70'
                    : 'border-violet-500/30 bg-violet-950/50',
                ].join(' ')}
                title={[g.name, g.kindLabel, g.description, ...g.targetLabels]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {g.chip ? (
                  <div className="flex justify-center">{renderChip(g.chip, 'tiny')}</div>
                ) : (
                  <div className="truncate text-center text-[10px] font-semibold text-violet-50">
                    {g.name}
                  </div>
                )}
                <div className="truncate text-center text-[9px] text-violet-100/80">
                  {g.kindLabel}
                  {g.count > 1 ? ` ×${g.count}` : ''}
                </div>
                {g.isTop && (
                  <div className="absolute -left-1 -top-1 rounded bg-violet-300 px-1 text-[8px] font-bold uppercase text-violet-950">
                    Top
                  </div>
                )}
                {g.targetLabels.length > 0 && (
                  <div className="truncate text-center text-[8px] text-violet-200/55">
                    → {g.targetLabels[0]}
                    {g.targetLabels.length > 1 ? '…' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Desktop Pass FAB — phone uses sticky dock below */}
        <button
          type="button"
          disabled={busy || !canPass}
          onClick={() =>
            passAction &&
            (mode.kind === 'idle' || mode.kind === 'manaPay') &&
            onSubmit(passAction)
          }
          className="absolute bottom-3 right-3 z-20 hidden rounded-full bg-gradient-to-b from-sky-400 to-sky-700 px-5 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-xl shadow-sky-900/50 ring-2 ring-white/30 disabled:opacity-40 sm:inline-flex"
        >
          {mode.kind === 'manaPay'
            ? 'Confirm'
            : stackNonempty && yourPriority
              ? 'Pass priority'
              : 'Pass'}
        </button>
      </div>

      {/* Sticky bottom chrome: wizards + Pass stay reachable on narrow screens */}
      <div className="sticky bottom-0 z-30 -mx-2 border-t border-slate-700/80 bg-slate-950/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md sm:hidden">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {paymentBar}
          {manaPoolReadout()}
        </div>
        {modeBanner ? (
          <div className="mb-2 max-h-[36vh] overflow-y-auto overscroll-contain">
            {modeBanner}
          </div>
        ) : null}
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            disabled={busy || !canPass}
            onClick={() =>
              passAction &&
              (mode.kind === 'idle' || mode.kind === 'manaPay') &&
              onSubmit(passAction)
            }
            className="min-h-12 flex-1 rounded-xl bg-gradient-to-b from-sky-400 to-sky-700 px-4 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-sky-900/40 ring-1 ring-white/25 disabled:opacity-40"
          >
            {stackNonempty && yourPriority ? 'Pass priority' : 'Pass'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDriveAi}
            className="min-h-12 rounded-xl bg-slate-800 px-3 text-xs font-medium text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700 disabled:opacity-40"
          >
            AI
          </button>
          {onRematch && (
            <button
              type="button"
              disabled={busy}
              onClick={onRematch}
              className="min-h-12 rounded-xl bg-emerald-900 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100 ring-1 ring-emerald-700/50 disabled:opacity-40"
            >
              Rematch
            </button>
          )}
          {onConcede && (
            <button
              type="button"
              disabled={busy}
              onClick={onConcede}
              className="min-h-12 rounded-xl bg-rose-950 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-rose-100 ring-1 ring-rose-700/50 disabled:opacity-40"
            >
              Concede
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span className="font-mono">
          {view.phaseRaw} · turn {view.turnNumber} · priority P{view.priorityPlayer}
          {view.waitingFor ? ` · ${view.waitingFor}` : ''}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onDriveAi}
          className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          AI step
        </button>
        {onRematch && (
          <button
            type="button"
            disabled={busy}
            onClick={onRematch}
            className="rounded bg-emerald-900 px-2 py-1 text-xs font-medium text-emerald-100 ring-1 ring-emerald-700/40 disabled:opacity-40"
          >
            Rematch
          </button>
        )}
        {onConcede && (
          <button
            type="button"
            disabled={busy}
            onClick={onConcede}
            className="rounded bg-rose-950 px-2 py-1 text-xs font-medium text-rose-100 ring-1 ring-rose-700/40 disabled:opacity-40"
          >
            Concede
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowAllActions((v) => !v)}
          className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
        >
          {showAllActions ? 'Hide' : 'Show'} all actions ({view.flatActions.length})
        </button>
      </div>

      {showAllActions && (
        <div className="flex max-h-48 flex-col gap-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2">
          {view.flatActions.length === 0 && (
            <p className="text-xs text-slate-500">No legal actions</p>
          )}
          {view.flatActions.map((a, i) => (
            <button
              key={`${a.type}-${i}`}
              type="button"
              disabled={busy}
              onClick={() => {
                setMode({ kind: 'idle' })
                onSubmit(a)
              }}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-left text-xs text-cyan-100 hover:border-cyan-500/50 disabled:opacity-50"
            >
              {summarizeAction(a)}
            </button>
          ))}
        </div>
      )}

      {picker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center"
          onClick={() => setPicker(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-cyan-500/40 bg-slate-950 p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-sm font-semibold text-white">
              {picker.name} — choose action
            </p>
            <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto sm:max-h-64">
              {picker.actions.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPicker(null)
                    if (
                      mode.kind === 'manaPay' ||
                      mode.kind === 'manaSource' ||
                      a.type === 'TapLandForMana' ||
                      a.type === 'ActivateManaSource'
                    ) {
                      onSubmit(a)
                      return
                    }
                    if (needsTargetingWizard([a]) || needsTargetingWizard(picker.actions)) {
                      if (needsTargetingWizard(picker.actions)) {
                        setMode({
                          kind: 'targeting',
                          sourceName: picker.name,
                          objectId: picker.objectId,
                          variants: picker.actions,
                          selected: [],
                        })
                        return
                      }
                    }
                    submitWithManaPreview(a)
                  }}
                  className="min-h-11 rounded border border-slate-700 px-2 py-2.5 text-left text-sm text-cyan-100 hover:border-cyan-400"
                >
                  {summarizeAction(a)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-lg bg-slate-800 text-sm text-slate-200 ring-1 ring-slate-600"
              onClick={() => setPicker(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {inspect && (
        <CardDetailOverlay card={inspect.card} onClose={() => setInspect(null)} />
      )}
    </div>
  )
}
