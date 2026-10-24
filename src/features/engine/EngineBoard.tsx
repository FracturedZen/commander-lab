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
  buildDeclareAttackersAction,
  buildDeclareBlockersAction,
  buildDeclareNoneAttackers,
  buildDeclareNoneBlockers,
  ensureAutoPayment,
  findMulliganActions,
  matchCastVariant,
  needsTargetingWizard,
  nextSlotTargets,
  parseWaitingFor,
  pickUntargetedCast,
  type WaitingCombatAttackers,
  type WaitingCombatBlockers,
  type WaitingDetail,
} from '@/engine/engineInteraction'

type Props = {
  view: PhaseBoardView
  busy: boolean
  onSubmit: (action: PhaseGameAction) => void
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
    }
  | {
      kind: 'blockers'
      detail: WaitingCombatBlockers
      pendingBlocker: string | null
      assignments: Array<[string, string]>
    }

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

export function EngineBoard({ view, busy, onSubmit, onDriveAi, onPreviewMana }: Props) {
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

  const waitingDetail: WaitingDetail = useMemo(
    () => parseWaitingFor(view.waitingRaw ?? view.waitingFor),
    [view.waitingRaw, view.waitingFor],
  )

  const glowing = useMemo(
    () => new Set(Object.keys(view.actionsByObject)),
    [view.actionsByObject],
  )

  const passAction = view.flatActions.find((a) => a.type === 'PassPriority')
  const canPass = Boolean(passAction) && mode.kind === 'idle'
  const mulliganActs = useMemo(
    () => findMulliganActions(view.flatActions),
    [view.flatActions],
  )

  // Auto-enter combat modes from engine waiting_for (viewer seat 0).
  useEffect(() => {
    if (waitingDetail?.kind === 'DeclareAttackers' && waitingDetail.player === 0) {
      const detail = waitingDetail
      setMode({ kind: 'attackers', detail, selected: [] })
      setPicker(null)
      return
    }
    if (waitingDetail?.kind === 'DeclareBlockers' && waitingDetail.player === 0) {
      const detail = waitingDetail
      setMode({
        kind: 'blockers',
        detail,
        pendingBlocker: null,
        assignments: [],
      })
      setPicker(null)
      return
    }
    setMode((m) =>
      m.kind === 'attackers' || m.kind === 'blockers' ? { kind: 'idle' } : m,
    )
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
    if (mode.kind === 'attackers') return new Set(mode.detail.validAttackerIds)
    if (mode.kind === 'blockers') {
      if (mode.pendingBlocker) {
        return new Set(mode.detail.validBlockTargets[mode.pendingBlocker] ?? [])
      }
      return new Set(mode.detail.validBlockerIds)
    }
    return new Set<string>()
  }, [mode])

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
    return {
      highlighted: glowing.has(objectId),
      glow: 'legal',
      selected: false,
    }
  }

  function submitWithManaPreview(action: PhaseGameAction) {
    const paid = ensureAutoPayment(action)
    if (onPreviewMana) {
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

    // Targeting wizard: pick next target
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
        // Dead end — reset selection but keep wizard
        setMode({ ...mode, selected: [] })
        return
      }
      setMode({ ...mode, selected: next })
      return
    }

    // Declare attackers: toggle
    if (mode.kind === 'attackers') {
      if (!mode.detail.validAttackerIds.includes(card.objectId)) {
        setInspect(card)
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

    // Declare blockers: pick blocker then attacker
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
        // Retap same blocker to cancel, or pick another blocker
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

    const acts = view.actionsByObject[card.objectId]
    if (acts && acts.length > 0) {
      const untargeted = pickUntargetedCast(acts)
      if (untargeted && acts.filter((a) => a.type === untargeted.type).length === 1 && acts.length === 1) {
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
      if (primary && !needsTargetingWizard([primary]) && acts.every((a) => a.type === primary.type) === false) {
        // Mixed types — picker
        setPicker({ objectId: card.objectId, name: card.card.name, actions: acts })
        return
      }
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

  if (!view.ok || !you) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
        {view.reason ?? 'Board map incomplete'} — use the action list below.
      </div>
    )
  }

  const modeBanner =
    mode.kind === 'targeting' ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-50">
        <span>
          Choose target{mode.selected.length ? `s (${mode.selected.length})` : ''} for{' '}
          <strong>{mode.sourceName}</strong>
          {targetGlow.size ? ` · ${targetGlow.size} legal` : ''}
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
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-400/40 bg-orange-950/50 px-3 py-2 text-sm text-orange-50">
        <span>
          Declare attackers · tap creatures ({mode.selected.length} selected)
        </span>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          onClick={confirmAttackers}
        >
          {mode.selected.length === 0 ? 'Declare none' : `Attack (${mode.selected.length})`}
        </button>
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
          {mode.assignments.length === 0 ? 'Declare none' : `Confirm blocks (${mode.assignments.length})`}
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
    ) : waitingDetail?.kind === 'MulliganDecision' && (mulliganActs.keep || mulliganActs.mulligan) ? (
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

  function renderChip(c: PhaseObjectView, size: 'board' | 'boardLg' | 'land' | 'hand' | 'command' | 'tiny') {
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
        stops={new Set()}
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
          if (passAction && mode.kind === 'idle') onSubmit(passAction)
        }}
        onToggleStop={() => {
          /* engine owns phases — stops are display-only here */
        }}
        dock
      />

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
          {/* Opponent */}
          {opp && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-1 text-center text-[11px] text-emerald-100/80">
                <div className="font-semibold">AI{opp.isEliminated ? ' ✕' : ''}</div>
                <div className="text-lg font-bold tabular-nums text-white">{opp.life}</div>
                <div className="text-[10px] text-emerald-200/50">
                  H{opp.hand.length} · L{opp.libraryCount}
                </div>
              </div>
              {/* Face-down hand stubs */}
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

          {/* Your BF */}
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
                Empty — cyan = legal · rose = target · orange = combat
              </p>
            ) : (
              <div className="flex flex-wrap content-start items-end gap-2">
                {you.nonLands.map((c) => renderChip(c, 'boardLg'))}
              </div>
            )}
          </div>

          {/* Lands */}
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

          {/* Bottom: life + piles + hand */}
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

        {/* Big Pass FAB */}
        <button
          type="button"
          disabled={busy || !canPass}
          onClick={() => passAction && mode.kind === 'idle' && onSubmit(passAction)}
          className="absolute bottom-3 right-3 z-20 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 px-5 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-xl shadow-sky-900/50 ring-2 ring-white/30 disabled:opacity-40"
        >
          Pass
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

      {picker && mode.kind === 'idle' && (
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
                    if (needsTargetingWizard([a]) || needsTargetingWizard(picker.actions)) {
                      // Prefer wizard over raw list when targets differ
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
