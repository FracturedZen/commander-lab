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
  buildSelectCards,
  buildSelectModes,
  buildSpendPoolMana,
  buildSubmitPhyrexianChoices,
  buildUnspendPoolMana,
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
  summarizeManaSourceOption,
  type CastPaymentModeType,
  type WaitingAssistChoosePlayer,
  type WaitingAssistPayment,
  type WaitingChooseX,
  type WaitingCombatAttackers,
  type WaitingCombatBlockers,
  type WaitingDetail,
  type WaitingDiscard,
  type WaitingEffectZone,
  type WaitingManaPayment,
  type WaitingManaSourceSelection,
  type WaitingModeChoice,
  type WaitingPhyrexian,
} from '@/engine/engineInteraction'

type Props = {
  view: PhaseBoardView
  busy: boolean
  onSubmit: (action: PhaseGameAction) => void
  /** Submit several engine-legal actions without AI between them (mana shortcuts). */
  onSubmitChain?: (actions: PhaseGameAction[]) => void
  onDriveAi: () => void
  /** Optional Auto-payment source preview (object ids). */
  onPreviewMana?: (action: PhaseGameAction) => string[]
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
}: Props) {
  const you = view.seats[0]
  const opp = view.seats[1]
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
    setMode((m) => {
      if (
        m.kind === 'attackers' ||
        m.kind === 'blockers' ||
        m.kind === 'manaPay' ||
        m.kind === 'manaSource' ||
        m.kind === 'phyrexian' ||
        m.kind === 'chooseX' ||
        m.kind === 'assistPlayer' ||
        m.kind === 'assistPay' ||
        m.kind === 'discard' ||
        m.kind === 'modeChoice' ||
        m.kind === 'effectZone'
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
    return new Set<string>()
  }, [mode])

  const choiceGlow = useMemo(() => {
    if (mode.kind === 'discard') return new Set(mode.detail.cards)
    if (mode.kind === 'effectZone') return new Set(mode.detail.cards)
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
    if (mode.kind === 'discard' || mode.kind === 'effectZone') {
      return new Set(mode.selected)
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
    if (mode.kind === 'attackers' || mode.kind === 'blockers') {
      if (combatGlow.has(objectId) || selectedIds.has(objectId)) {
        return {
          highlighted: true,
          glow: 'combat',
          selected: selectedIds.has(objectId),
        }
      }
      return { highlighted: false, glow: 'legal', selected: false }
    }
    if (mode.kind === 'discard' || mode.kind === 'effectZone') {
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

    if (mode.kind === 'discard' || mode.kind === 'effectZone') {
      if (!mode.detail.cards.includes(card.objectId)) {
        setInspect(card)
        return
      }
      const selected = mode.selected.includes(card.objectId)
        ? mode.selected.filter((id) => id !== card.objectId)
        : [...mode.selected, card.objectId]
      // Cap exact-count selections
      if (
        !mode.detail.upTo &&
        selected.length > mode.detail.count &&
        !mode.selected.includes(card.objectId)
      ) {
        return
      }
      if (
        mode.detail.upTo &&
        selected.length > mode.detail.count &&
        !mode.selected.includes(card.objectId)
      ) {
        return
      }
      setMode({ ...mode, selected })
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
          className="ml-auto rounded bg-rose-800/80 px-2 py-1 text-xs hover:bg-rose-700"
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
            className="rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
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
          className="rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
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

  return (
    <div className="relative flex flex-col gap-2">
      <PhaseRail
        phase={view.phase}
        turnNumber={view.turnNumber}
        activeName={
          view.activePlayer === 0 ? 'You' : opp ? `AI ${opp.id}` : `P${view.activePlayer}`
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
          waitingDetail?.kind === 'DeclareBlockers'
        }
        attackersDeclared={
          view.phase === 'combat_blockers' ||
          view.phase === 'combat_damage' ||
          waitingDetail?.kind === 'DeclareBlockers'
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

      {paymentBar}
      {modeBanner}

      <div
        className="arena-board relative overflow-hidden rounded-3xl border-4 border-amber-950/80 shadow-2xl shadow-black/50"
        style={{
          backgroundColor: '#0d3b2e',
          backgroundImage:
            'radial-gradient(ellipse at center, #1a6b4f 0%, #0a2f24 55%, #061a14 100%)',
          minHeight: '28rem',
        }}
      >
        <div className="relative flex min-h-[28rem] flex-col gap-2 p-2 sm:p-3">
          {opp && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-1 text-center text-[11px] text-emerald-100/80">
                <div className="font-semibold">AI{opp.isEliminated ? ' ✕' : ''}</div>
                <div className="text-lg font-bold tabular-nums text-white">{opp.life}</div>
                <div className="text-[10px] text-emerald-200/50">
                  H{opp.hand.length} · L{opp.libraryCount}
                </div>
              </div>
              {opp.hand.length > 0 && (
                <div className="flex max-w-[12rem] flex-wrap justify-center gap-0.5">
                  {Array.from({ length: Math.min(opp.hand.length, 10) }).map((_, i) => (
                    <div
                      key={`opp-h-${i}`}
                      className="h-8 w-[1.4rem] rounded-sm border border-slate-600/80 bg-gradient-to-b from-slate-800 to-slate-950 shadow"
                      title="Opponent hand"
                    />
                  ))}
                  {opp.hand.length > 10 && (
                    <span className="self-center text-[9px] text-emerald-100/40">
                      +{opp.hand.length - 10}
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
                <div className="flex max-w-full flex-wrap justify-center gap-1.5">
                  {opp.nonLands.slice(0, 12).map((c) => renderChip(c, 'board'))}
                </div>
              )}
            </div>
          )}

          <div className="combat-lane mx-4 h-px bg-gradient-to-r from-transparent via-rose-400/50 to-transparent" />

          <div className="min-h-[8rem] flex-1 rounded-xl border border-emerald-400/15 bg-black/20 p-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-100/45">
                Battlefield
              </span>
              <span className="text-[10px] tabular-nums text-emerald-100/35">
                {you.nonLands.length} · {you.lands.length} lands · stack {view.stackCount}
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
              {you.command.map((c) => renderChip(c, 'command'))}
              <div className="flex gap-1 text-[10px] text-emerald-100/45">
                <span>GY {you.graveyard.length}</span>
                <span>Ex {you.exile.length}</span>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || !canPass}
          onClick={() =>
            passAction &&
            (mode.kind === 'idle' || mode.kind === 'manaPay') &&
            onSubmit(passAction)
          }
          className="absolute bottom-3 right-3 z-20 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 px-5 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-xl shadow-sky-900/50 ring-2 ring-white/30 disabled:opacity-40"
        >
          {mode.kind === 'manaPay' ? 'Confirm' : 'Pass'}
        </button>
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
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center"
          onClick={() => setPicker(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-cyan-500/40 bg-slate-950 p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-sm font-semibold text-white">
              {picker.name} — choose action
            </p>
            <div className="flex max-h-64 flex-col gap-1 overflow-auto">
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
                  className="rounded border border-slate-700 px-2 py-1.5 text-left text-xs text-cyan-100 hover:border-cyan-400"
                >
                  {summarizeAction(a)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-slate-400 underline"
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
