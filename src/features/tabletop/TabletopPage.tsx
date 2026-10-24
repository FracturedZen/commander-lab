import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CardChip } from '@/components/CardChip'
import { CardDetailOverlay } from '@/components/CardDetailOverlay'
import { PhaseRail } from '@/components/PhaseRail'
import { StackStub } from '@/components/StackStub'
import { ZonePanel } from '@/components/ZonePanel'
import { BackgroundControl } from './BackgroundControl'
import { useTableSession } from './useTableSession'
import { SAMPLE_DECK_DEFS } from '@/lib/sample-decks/install'
import type { CardRef } from '@/types/card'
import type { ZoneName } from '@/types/game'

const MOVE_ZONES: ZoneName[] = [
  'hand',
  'battlefield',
  'graveyard',
  'exile',
  'command',
  'library',
]

export function TabletopPage() {
  const s = useTableSession()
  const {
    player,
    players,
    turn,
    log,
    table,
    decks,
    seatCount,
    activeSeat,
    selectedInstance,
    gameActive,
    mulliganOpen,
    pendingActions,
    moveNotice,
    busy,
    rulesStrict,
    grantPendingAction,
    getLegalDestinations,
    isCardHighlighted,
    adjustLife,
    adjustCommanderDamage,
    shuffleLibrary,
    draw,
    mulligan,
    keepHand,
    nextPhase,
    endTurn,
    moveTopLibraryTo,
    moveCard,
    toggleTap,
    setBackground,
    endGame,
    startGame,
    persistSession,
    restoreSession,
    setActiveSeat,
    setSeatCount,
    setSelectedInstance,
    runAiOpponentStep,
    installStarters,
    refreshDecks,
  } = s

  const [dragOverZone, setDragOverZone] = useState<ZoneName | null>(null)
  const [setupSeats, setSetupSeats] = useState(1)
  const [setupDecks, setSetupDecks] = useState<(string | null)[]>([null])
  const [inspect, setInspect] = useState<{
    card: CardRef
    zone: ZoneName
    instanceId: string
  } | null>(null)

  useEffect(() => {
    setSetupDecks((prev) => {
      const next = Array.from({ length: setupSeats }, (_, i) => prev[i] ?? null)
      return next
    })
  }, [setupSeats])

  function onDropTo(zone: ZoneName) {
    setDragOverZone(null)
    if (!selectedInstance || !gameActive) return
    if (selectedInstance.zone === zone) return
    moveCard(selectedInstance.zone, zone, selectedInstance.instanceId)
  }

  function zoneHandlers(zone: ZoneName) {
    return {
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        if (gameActive) setDragOverZone(zone)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        onDropTo(zone)
      },
      dropActive: dragOverZone === zone,
    }
  }

  async function onInstallStarters() {
    const next = await installStarters()
    if (next.length && !setupDecks[0]) {
      const sample = next.find((d) => d.id.startsWith('sample-'))
      if (sample) {
        setSetupDecks((prev) => {
          const copy = [...prev]
          copy[0] = sample.id
          return copy
        })
      }
    }
  }

  const activeName =
    players.find((p) => p.id === turn.activePlayerId)?.name ?? 'Player'
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 px-2 py-3 sm:px-4">
      {gameActive ? (
        <div className="sticky top-0 z-20 -mx-2 flex flex-col gap-2 border-b border-sky-500/25 bg-slate-950/95 px-2 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-3">
          <PhaseRail
            phase={turn.phase}
            turnNumber={turn.turnNumber}
            activeName={activeName}
            yourTurn={player.id === turn.activePlayerId}
            lastAutoNote={turn.lastAutoNote}
            onNextPhase={nextPhase}
            onEndTurn={endTurn}
          />
          {player.hasLost && (
            <p className="px-1 text-xs font-semibold text-rose-300">
              {player.name} lost
              {player.loseReason === 'decked'
                ? ' — decked (drew from empty library)'
                : player.loseReason === 'commander_damage'
                  ? ' — 21 commander damage'
                  : player.loseReason === 'life'
                    ? ' — life ≤ 0'
                    : ''}
            </p>
          )}
          <div className="flex flex-wrap gap-2 px-1">
            {!rulesStrict && (
              <ActionButton onClick={() => draw(1)} title="Debug free draw">
                Draw (debug)
              </ActionButton>
            )}
            {mulliganOpen && (
              <>
                <ActionButton onClick={keepHand} tone="accent">
                  Keep hand
                </ActionButton>
                <ActionButton onClick={mulligan}>Mulligan</ActionButton>
              </>
            )}
            <ActionButton onClick={shuffleLibrary}>Shuffle</ActionButton>
            <ActionButton onClick={runAiOpponentStep}>AI step</ActionButton>
            <ActionButton onClick={() => void persistSession()} tone="muted">
              Save
            </ActionButton>
            <ActionButton onClick={endGame} tone="muted">
              End game
            </ActionButton>
          </div>
          <p className="w-full px-1 text-[10px] text-slate-500">
            Cyan glow = legal play / tap / effect target. Long-press or{' '}
            <span className="text-sky-300">i</span> for full card. Stack panel is
            a stub (priority engine later).
            {rulesStrict ? ' Arena zone rules on.' : ' Debug grants on (zone rules still enforced).'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3">
          <p className="text-sm font-medium text-amber-100">
            No game started yet
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            Start a game below to deal opening hands, put commanders in the
            command zone, and track turns. Drawing happens on the draw step —
            not by spamming a Draw button.
          </p>
        </div>
      )}

      {!gameActive && (
        <div className="rounded-2xl border border-emerald-700/40 bg-gradient-to-br from-emerald-950/80 to-slate-950 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-white">Start game</h1>
              <p className="text-sm text-slate-400">
                Pick seats + decks. Starter decks work without Scryfall sync.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onInstallStarters()}
                className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Install starter decks
              </button>
              <button
                type="button"
                onClick={() => void restoreSession()}
                className="rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-600"
              >
                Restore session
              </button>
              <BackgroundControl
                backgroundUrl={table.backgroundUrl}
                onChange={(v) => void setBackground(v)}
              />
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            Seats
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setSetupSeats(n)
                  setSeatCount(n)
                }}
                className={[
                  'min-h-9 min-w-9 rounded-md font-semibold',
                  setupSeats === n
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300',
                ].join(' ')}
              >
                {n}
              </button>
            ))}
            <Link
              to="/decks"
              className="ml-auto text-emerald-300 underline"
              onClick={() => refreshDecks()}
            >
              Manage decks
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: setupSeats }, (_, i) => (
              <label
                key={i}
                className="flex flex-col gap-1 rounded-lg border border-slate-700/80 bg-black/30 p-2 text-[11px] text-slate-400"
              >
                Seat {i + 1}
                {i === 0 ? ' (you)' : ''} deck
                <select
                  value={setupDecks[i] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || null
                    setSetupDecks((prev) => {
                      const copy = [...prev]
                      copy[i] = v
                      return copy
                    })
                  }}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                >
                  <option value="">Select deck…</option>
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.commander ? ` — ${d.commander.name}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {decks.length === 0 && (
            <p className="mt-3 text-xs text-amber-200/90">
              No decks yet. Tap <strong>Install starter decks</strong> (
              {SAMPLE_DECK_DEFS.map((d) => d.commander).join(' · ')}) or open the{' '}
              <Link to="/builder" className="underline">
                builder
              </Link>
              .
            </p>
          )}

          <button
            type="button"
            disabled={busy || !setupDecks[0]}
            onClick={() =>
              void startGame({ seatCount: setupSeats, deckIds: setupDecks })
            }
            className="mt-4 w-full rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-900/40 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start game — deal hands &amp; track turns
          </button>
        </div>
      )}

      {gameActive && (
        <div
          className={[
            'grid gap-2',
            seatCount === 1
              ? 'grid-cols-1'
              : seatCount === 2
                ? 'grid-cols-2'
                : 'grid-cols-2 lg:grid-cols-4',
          ].join(' ')}
        >
          {players.map((p, i) => (
            <div
              key={p.id}
              className={[
                'rounded-xl border p-3 transition',
                p.hasLost
                  ? 'border-rose-500/50 bg-rose-950/40 opacity-80'
                  : i === activeSeat
                    ? 'border-emerald-400 bg-emerald-950/50 ring-1 ring-emerald-400/40'
                    : 'border-slate-800 bg-slate-900/60',
              ].join(' ')}
            >
              <button
                type="button"
                className="text-left text-xs font-semibold text-slate-300"
                onClick={() => setActiveSeat(i)}
              >
                {p.name}
                {p.hasLost ? ' · LOST' : i === activeSeat ? ' · playing' : ''}
                {p.deckId ? '' : ' · empty'}
              </button>
              <div className="mt-1 flex items-center justify-center gap-3">
                <button
                  type="button"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-2xl hover:bg-slate-700"
                  onClick={() => adjustLife(-1, i)}
                  aria-label="Minus life"
                >
                  −
                </button>
                <span className="min-w-[3.5rem] text-center text-4xl font-black tabular-nums text-emerald-300">
                  {p.life}
                </span>
                <button
                  type="button"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-2xl hover:bg-slate-700"
                  onClick={() => adjustLife(1, i)}
                  aria-label="Plus life"
                >
                  +
                </button>
              </div>
              {seatCount > 1 && (
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  {players
                    .filter((o) => o.id !== p.id)
                    .map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[10px] text-rose-200"
                      >
                        <span className="max-w-[4rem] truncate">{o.name}</span>
                        <button
                          type="button"
                          className="px-1"
                          onClick={() => adjustCommanderDamage(o.id, -1, i)}
                        >
                          −
                        </button>
                        <span className="tabular-nums font-bold">
                          {p.commanderDamage[o.id] ?? 0}
                        </span>
                        <button
                          type="button"
                          className="px-1"
                          onClick={() => adjustCommanderDamage(o.id, 1, i)}
                        >
                          +
                        </button>
                      </div>
                    ))}
                </div>
              )}
              {seatCount === 1 && (
                <div className="mt-2 flex items-center justify-center gap-2 text-xs text-rose-200">
                  <span>Cmd dmg</span>
                  <button
                    type="button"
                    className="h-8 w-8 rounded bg-slate-800"
                    onClick={() => adjustCommanderDamage('opp-cmd', -1)}
                  >
                    −
                  </button>
                  <span className="tabular-nums font-bold">
                    {p.commanderDamage['opp-cmd'] ?? 0}
                  </span>
                  <button
                    type="button"
                    className="h-8 w-8 rounded bg-slate-800"
                    onClick={() => adjustCommanderDamage('opp-cmd', 1)}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {moveNotice && gameActive && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/50 px-3 py-2 text-xs text-amber-100">
          {moveNotice}
        </div>
      )}

      {gameActive && (
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
          <div className="min-w-0" />
          <StackStub pendingActions={pendingActions} />
        </div>
      )}

      {selectedInstance && gameActive && (() => {
        const card = player.zones[selectedInstance.zone].find(
          (c) => c.instanceId === selectedInstance.instanceId,
        )
        const legal = getLegalDestinations(
          selectedInstance.zone,
          Boolean(card?.card.isCommander),
        )
        const legalZones = new Set(legal.map((l) => l.zone))
        return (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-100">
            <span>Move to:</span>
            {MOVE_ZONES.filter((z) => z !== selectedInstance.zone).map((z) => {
              // legalDestinations already enforces library-pending even in sandbox
              const ok = legalZones.has(z)
              return (
                <button
                  key={z}
                  type="button"
                  disabled={!ok}
                  title={
                    ok
                      ? undefined
                      : 'Needs a draw/mill/tutor/return effect'
                  }
                  className={[
                    'min-h-9 rounded px-2 py-1 capitalize',
                    ok
                      ? 'bg-emerald-800/80'
                      : 'cursor-not-allowed bg-slate-800/60 text-slate-500 line-through',
                  ].join(' ')}
                  onClick={() => {
                    if (!ok) return
                    moveCard(
                      selectedInstance.zone,
                      z,
                      selectedInstance.instanceId,
                    )
                  }}
                >
                  {z}
                </button>
              )
            })}
            {selectedInstance.zone === 'battlefield' && (
              <button
                type="button"
                className="min-h-9 rounded bg-amber-800/80 px-2 py-1"
                onClick={() => toggleTap(selectedInstance.instanceId)}
              >
                Tap / Untap
              </button>
            )}
            <button
              type="button"
              className="text-slate-400"
              onClick={() => setSelectedInstance(null)}
            >
              Cancel
            </button>
            {legal.length === 0 && (
              <span className="w-full text-[10px] text-amber-200/80">
                No legal destinations right now — needs a card effect (draw,
                mill, tutor, discard, reanimate…).
              </span>
            )}
          </div>
        )
      })()}

      <div
        className="relative overflow-hidden rounded-3xl border-4 border-amber-950/80 shadow-2xl shadow-black/50"
        style={{
          backgroundColor: '#0d3b2e',
          backgroundImage: table.backgroundUrl
            ? `linear-gradient(rgba(8,40,30,0.55), rgba(8,40,30,0.72)), url(${table.backgroundUrl})`
            : 'radial-gradient(ellipse at center, #1a6b4f 0%, #0a2f24 55%, #061a14 100%)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          minHeight: '28rem',
        }}
      >
        <div className="pointer-events-none absolute inset-0 rounded-[1.35rem] ring-1 ring-inset ring-amber-200/10" />

        {!gameActive ? (
          <div className="flex min-h-[28rem] flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="rounded-full border border-emerald-400/20 bg-black/25 px-6 py-4">
              <p className="text-lg font-semibold text-emerald-50">
                Commander table
              </p>
              <p className="mt-1 max-w-sm text-sm text-emerald-100/60">
                Start a game to deal hands and track turns. Seats will appear
                around this felt when you play hotseat multiplayer.
              </p>
            </div>
          </div>
        ) : (
          <div className="relative grid gap-3 p-3 sm:p-4">
            {seatCount > 1 && (
              <div className="flex flex-wrap justify-center gap-2">
                {players.map((p, i) =>
                  i === activeSeat ? null : (
                    <div
                      key={p.id}
                      className="rounded-lg border border-white/10 bg-black/35 px-3 py-1.5 text-center text-[11px] text-emerald-100/80"
                    >
                      <div className="font-semibold">
                        {p.name}
                        {p.hasLost ? ' ✕' : ''}
                      </div>
                      <div className="text-lg font-bold tabular-nums text-white">
                        {p.life}
                      </div>
                      <div className="text-[10px] text-emerald-200/50">
                        H{p.zones.hand.length} · L{p.zones.library.length} · BF
                        {p.zones.battlefield.length}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <ZonePanel
                title="Command"
                count={player.zones.command.length}
                compact
                className="bg-black/30"
                {...zoneHandlers('command')}
              >
                {player.zones.command.map((c) => (
                  <CardChip
                    key={c.instanceId}
                    card={c.card}
                    size="command"
                    draggable
                    selected={selectedInstance?.instanceId === c.instanceId}
                    highlighted={isCardHighlighted('command', c)}
                    onClick={() =>
                      setInspect({
                        card: c.card,
                        zone: 'command',
                        instanceId: c.instanceId,
                      })
                    }
                    onInspect={() =>
                      setInspect({
                        card: c.card,
                        zone: 'command',
                        instanceId: c.instanceId,
                      })
                    }
                    onDragStart={() =>
                      setSelectedInstance({
                        playerId: player.id,
                        zone: 'command',
                        instanceId: c.instanceId,
                      })
                    }
                  />
                ))}
              </ZonePanel>
              <ZonePanel
                title="Graveyard"
                count={player.zones.graveyard.length}
                compact
                className="bg-black/30"
                {...zoneHandlers('graveyard')}
              >
                {player.zones.graveyard.slice(-6).map((c) => (
                  <CardChip
                    key={c.instanceId}
                    card={c.card}
                    size="tiny"
                    draggable
                    selected={selectedInstance?.instanceId === c.instanceId}
                    highlighted={isCardHighlighted('graveyard', c)}
                    onClick={() =>
                      setInspect({
                        card: c.card,
                        zone: 'graveyard',
                        instanceId: c.instanceId,
                      })
                    }
                    onInspect={() =>
                      setInspect({
                        card: c.card,
                        zone: 'graveyard',
                        instanceId: c.instanceId,
                      })
                    }
                    onDragStart={() =>
                      setSelectedInstance({
                        playerId: player.id,
                        zone: 'graveyard',
                        instanceId: c.instanceId,
                      })
                    }
                  />
                ))}
              </ZonePanel>
              <ZonePanel
                title="Exile"
                count={player.zones.exile.length}
                compact
                className="bg-black/30"
                {...zoneHandlers('exile')}
              >
                {player.zones.exile.slice(-6).map((c) => (
                  <CardChip
                    key={c.instanceId}
                    card={c.card}
                    size="tiny"
                    draggable
                    selected={selectedInstance?.instanceId === c.instanceId}
                    highlighted={isCardHighlighted('exile', c)}
                    onClick={() =>
                      setInspect({
                        card: c.card,
                        zone: 'exile',
                        instanceId: c.instanceId,
                      })
                    }
                    onInspect={() =>
                      setInspect({
                        card: c.card,
                        zone: 'exile',
                        instanceId: c.instanceId,
                      })
                    }
                    onDragStart={() =>
                      setSelectedInstance({
                        playerId: player.id,
                        zone: 'exile',
                        instanceId: c.instanceId,
                      })
                    }
                  />
                ))}
              </ZonePanel>
            </div>

            <ZonePanel
              title={`${player.name} — Battlefield`}
              count={player.zones.battlefield.length}
              className="min-h-[11rem] border border-emerald-400/20 bg-black/25"
              {...zoneHandlers('battlefield')}
            >
              {player.zones.battlefield.length === 0 ? (
                <p className="p-3 text-xs text-emerald-100/35">
                  Battlefield empty — tap a card to read it, Select for move, or
                  drag.
                </p>
              ) : (
                player.zones.battlefield.map((c) => (
                  <CardChip
                    key={c.instanceId}
                    card={c.card}
                    size="board"
                    draggable
                    tapped={c.tapped}
                    selected={selectedInstance?.instanceId === c.instanceId}
                    highlighted={isCardHighlighted('battlefield', c)}
                    onClick={() =>
                      setInspect({
                        card: c.card,
                        zone: 'battlefield',
                        instanceId: c.instanceId,
                      })
                    }
                    onInspect={() =>
                      setInspect({
                        card: c.card,
                        zone: 'battlefield',
                        instanceId: c.instanceId,
                      })
                    }
                    onDragStart={() =>
                      setSelectedInstance({
                        playerId: player.id,
                        zone: 'battlefield',
                        instanceId: c.instanceId,
                      })
                    }
                  />
                ))
              )}
            </ZonePanel>

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <ZonePanel
                title="Library"
                count={player.zones.library.length}
                compact
                className="w-28 bg-black/35 sm:w-36"
                {...zoneHandlers('library')}
              >
                <div className="flex w-full flex-col gap-1">
                  <div className="flex justify-center gap-0.5">
                    {player.zones.library.slice(0, 3).map((c) => (
                      <CardChip
                        key={c.instanceId}
                        card={c.card}
                        size="tiny"
                        faceDown
                        highlighted={isCardHighlighted('library', c)}
                      />
                    ))}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {(() => {
                      const libLegal = new Set(
                        getLegalDestinations('library').map((l) => l.zone),
                      )
                      // Never show free top cheats — pending effect only (Strict on or off)
                      const showHand = libLegal.has('hand')
                      const showBf = libLegal.has('battlefield')
                      const showGy = libLegal.has('graveyard')
                      return (
                        <>
                          {showHand && (
                            <TinyButton
                              onClick={() => moveTopLibraryTo('hand')}
                            >
                              Top → Hand
                            </TinyButton>
                          )}
                          {showBf && (
                            <TinyButton
                              onClick={() => moveTopLibraryTo('battlefield')}
                            >
                              Top → BF
                            </TinyButton>
                          )}
                          {showGy && (
                            <TinyButton
                              onClick={() => moveTopLibraryTo('graveyard')}
                            >
                              Top → GY
                            </TinyButton>
                          )}
                          {!showHand && !showBf && !showGy && (
                              <p className="px-0.5 text-[9px] leading-snug text-emerald-100/45">
                                Top-of-library moves need a draw/mill/tutor
                                effect.
                              </p>
                            )}
                          {!rulesStrict && (
                            <>
                              <TinyButton
                                onClick={() =>
                                  grantPendingAction('mill', 3, 'Mill 3')
                                }
                              >
                                Grant mill 3
                              </TinyButton>
                              <TinyButton
                                onClick={() =>
                                  grantPendingAction(
                                    'discard',
                                    1,
                                    'Discard 1',
                                  )
                                }
                              >
                                Grant discard
                              </TinyButton>
                            </>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              </ZonePanel>

              <ZonePanel
                title="Hand"
                count={player.zones.hand.length}
                className="min-h-[8.5rem] bg-black/35"
                {...zoneHandlers('hand')}
              >
                {player.zones.hand.length === 0 ? (
                  <p className="p-2 text-xs text-emerald-100/35">Hand empty</p>
                ) : (
                  <div className="hand-dock w-full">
                    {player.zones.hand.map((c) => (
                      <div
                        key={c.instanceId}
                        className={[
                          'hand-dock__card',
                          selectedInstance?.instanceId === c.instanceId
                            ? 'is-selected'
                            : '',
                        ].join(' ')}
                      >
                        <CardChip
                          card={c.card}
                          size="hand"
                          draggable
                          selected={
                            selectedInstance?.instanceId === c.instanceId
                          }
                          highlighted={isCardHighlighted('hand', c)}
                          onClick={() =>
                      setInspect({
                        card: c.card,
                        zone: 'hand',
                        instanceId: c.instanceId,
                      })
                    }
                    onInspect={() =>
                      setInspect({
                        card: c.card,
                        zone: 'hand',
                        instanceId: c.instanceId,
                      })
                    }
                          onDragStart={() =>
                            setSelectedInstance({
                              playerId: player.id,
                              zone: 'hand',
                              instanceId: c.instanceId,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </ZonePanel>
            </div>
          </div>
        )}
      </div>

      {inspect && (
        <CardDetailOverlay
          card={inspect.card}
          onClose={() => setInspect(null)}
          onSelectForMove={() => {
            setSelectedInstance({
              playerId: player.id,
              zone: inspect.zone,
              instanceId: inspect.instanceId,
            })
            setInspect(null)
          }}
          onToggleTap={
            inspect.zone === 'battlefield'
              ? () => {
                  toggleTap(inspect.instanceId)
                }
              : undefined
          }
        />
      )}

      <aside className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Session log
        </h2>
        <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-400">
          {log.map((line, i) => (
            <li key={`${i}-${line.slice(0, 16)}`}>{line}</li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  tone = 'default',
  title,
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'default' | 'muted' | 'accent'
  title?: string
}) {
  const cls =
    tone === 'muted'
      ? 'min-h-9 rounded-md px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      : tone === 'accent'
        ? 'min-h-9 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-500'
        : 'min-h-9 rounded-md bg-emerald-700/90 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600'
  return (
    <button type="button" onClick={onClick} className={cls} title={title}>
      {children}
    </button>
  )
}

function TinyButton({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-7 rounded bg-black/40 px-1 py-0.5 text-[9px] text-emerald-100/80 ring-1 ring-emerald-500/20"
    >
      {children}
    </button>
  )
}
