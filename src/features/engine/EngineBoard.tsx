/**
 * Arena-style board driven purely by Phase state + legal actions.
 * No free DnD / zone moves — only engine submits.
 */
import { useMemo, useState } from 'react'
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

type Props = {
  view: PhaseBoardView
  busy: boolean
  onSubmit: (action: PhaseGameAction) => void
  onDriveAi: () => void
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

export function EngineBoard({ view, busy, onSubmit, onDriveAi }: Props) {
  const you = view.seats[0]
  const opp = view.seats[1]
  const [inspect, setInspect] = useState<PhaseObjectView | null>(null)
  const [picker, setPicker] = useState<{
    objectId: string
    name: string
    actions: PhaseGameAction[]
  } | null>(null)
  const [showAllActions, setShowAllActions] = useState(false)

  const glowing = useMemo(
    () => new Set(Object.keys(view.actionsByObject)),
    [view.actionsByObject],
  )

  const passAction = view.flatActions.find((a) => a.type === 'PassPriority')
  const canPass = Boolean(passAction)

  function onCardTap(card: PhaseObjectView) {
    const acts = view.actionsByObject[card.objectId]
    if (acts && acts.length > 0) {
      if (acts.length === 1) {
        onSubmit(acts[0]!)
        return
      }
      const primary = pickPrimaryAction(acts)
      // Multi-choice: open picker (still highlight primary)
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

  if (!view.ok || !you) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
        {view.reason ?? 'Board map incomplete'} — use the action list below.
      </div>
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
        combatEntered={view.phase.startsWith('combat')}
        attackersDeclared={view.phase === 'combat_blockers' || view.phase === 'combat_damage'}
        onPass={() => {
          if (passAction) onSubmit(passAction)
        }}
        onToggleStop={() => {
          /* engine owns phases — stops are display-only here */
        }}
        dock
      />

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
              {opp.command.length > 0 && (
                <div className="flex gap-1">
                  {opp.command.map((c) => (
                    <CardChip
                      key={c.objectId}
                      card={c.card}
                      size="command"
                      hideName
                      faceDown={c.faceDown}
                      highlighted={glowing.has(c.objectId)}
                      onClick={() => onCardTap(c)}
                      onInspect={() => onCardInspect(c)}
                    />
                  ))}
                </div>
              )}
              {opp.battlefield.length > 0 && (
                <div className="flex max-w-full flex-wrap justify-center gap-1.5">
                  {opp.nonLands.slice(0, 12).map((c) => (
                    <CardChip
                      key={c.objectId}
                      card={c.card}
                      size="board"
                      hideName
                      tapped={c.tapped}
                      faceDown={c.faceDown}
                      highlighted={glowing.has(c.objectId)}
                      onClick={() => onCardTap(c)}
                      onInspect={() => onCardInspect(c)}
                    />
                  ))}
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
                Empty — cyan glow = Phase-legal action
              </p>
            ) : (
              <div className="flex flex-wrap content-start items-end gap-2">
                {you.nonLands.map((c) => (
                  <CardChip
                    key={c.objectId}
                    card={c.card}
                    size="boardLg"
                    hideName
                    tapped={c.tapped}
                    faceDown={c.faceDown}
                    highlighted={glowing.has(c.objectId)}
                    onClick={() => onCardTap(c)}
                    onInspect={() => onCardInspect(c)}
                  />
                ))}
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
                {you.lands.map((c) => (
                  <CardChip
                    key={c.objectId}
                    card={c.card}
                    size="land"
                    hideName
                    tapped={c.tapped}
                    highlighted={glowing.has(c.objectId)}
                    onClick={() => onCardTap(c)}
                    onInspect={() => onCardInspect(c)}
                  />
                ))}
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
                  <CardChip
                    card={c.card}
                    size="hand"
                    hideName
                    faceDown={c.faceDown}
                    highlighted={glowing.has(c.objectId)}
                    onClick={() => onCardTap(c)}
                    onInspect={() => onCardInspect(c)}
                  />
                </div>
              ))}
              {you.hand.length === 0 && (
                <p className="text-xs text-emerald-100/30">Hand empty</p>
              )}
            </div>

            <div className="col-span-2 flex flex-wrap justify-end gap-2 sm:col-span-1 sm:flex-col">
              {you.command.map((c) => (
                <CardChip
                  key={c.objectId}
                  card={c.card}
                  size="command"
                  hideName
                  highlighted={glowing.has(c.objectId)}
                  onClick={() => onCardTap(c)}
                  onInspect={() => onCardInspect(c)}
                />
              ))}
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
          onClick={() => passAction && onSubmit(passAction)}
          className="absolute bottom-3 right-3 z-20 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 px-5 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-xl shadow-sky-900/50 ring-2 ring-white/30 disabled:opacity-40"
        >
          Pass
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span className="font-mono">
          {view.phaseRaw} · turn {view.turnNumber} · priority P{view.priorityPlayer}
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
              onClick={() => onSubmit(a)}
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
                    onSubmit(a)
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
