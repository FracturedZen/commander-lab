import {
  PHASE_LABEL,
  RAIL_SEGMENTS,
  passButtonCopy,
  phaseToRailSegment,
  type Phase,
  type RailSegmentId,
} from '@/lib/rules/turnMachine'

type Props = {
  phase: Phase
  turnNumber: number
  activeName: string
  yourTurn: boolean
  lastAutoNote?: string | null
  stops: ReadonlySet<RailSegmentId>
  combatEntered: boolean
  attackersDeclared: boolean
  /** Primary Arena Pass — auto-advances to next decision. */
  onPass: () => void
  /** Single micro-step (advanced). */
  onStep?: () => void
  /** Toggle a phase stop on the mini ladder. */
  onToggleStop: (id: RailSegmentId) => void
  /** Tap Combat while on Main 1 → enter combat. */
  onEnterCombat?: () => void
  /** Compact dock mode: mini ladder + big Pass (no huge header). */
  dock?: boolean
}

export function PhaseRail({
  phase,
  turnNumber,
  activeName,
  yourTurn,
  lastAutoNote,
  stops,
  combatEntered,
  attackersDeclared,
  onPass,
  onStep,
  onToggleStop,
  onEnterCombat,
  dock = true,
}: Props) {
  const currentSeg = phaseToRailSegment(phase)
  const copy = passButtonCopy({
    phase,
    stops,
    combatEntered,
    attackersDeclared,
  })

  function onRailTap(id: RailSegmentId) {
    if (id === 'combat' && phase === 'main1' && onEnterCombat) {
      onEnterCombat()
      return
    }
    onToggleStop(id)
  }

  const ladder = (
    <div className="phase-ladder flex items-center gap-1" role="list">
      {RAIL_SEGMENTS.map((step) => {
        const active = step.id === currentSeg
        const stopped = stops.has(step.id)
        const idx = RAIL_SEGMENTS.findIndex((s) => s.id === step.id)
        const curIdx = RAIL_SEGMENTS.findIndex((s) => s.id === currentSeg)
        const passed = idx < curIdx
        return (
          <button
            key={step.id}
            type="button"
            role="listitem"
            title={`${step.label}${stopped ? ' · stop set' : ' · tap to set stop'}${
              step.id === 'combat' && phase === 'main1'
                ? ' · tap to enter combat'
                : ''
            }`}
            aria-label={`${step.label}${active ? ', current' : ''}${
              stopped ? ', stop' : ''
            }`}
            aria-pressed={stopped}
            onClick={() => onRailTap(step.id)}
            className={[
              'phase-ladder__hole relative flex h-7 min-w-[2.35rem] flex-1 flex-col items-center justify-center rounded-full border text-[9px] font-semibold uppercase tracking-wide transition sm:min-w-[2.6rem] sm:text-[10px]',
              active
                ? yourTurn
                  ? 'border-amber-300 bg-amber-500/35 text-amber-50 shadow-[0_0_10px_rgba(251,191,36,0.45)]'
                  : 'border-sky-300 bg-sky-500/35 text-sky-50 shadow-[0_0_10px_rgba(56,189,248,0.45)]'
                : passed
                  ? 'border-slate-700/70 bg-slate-900/60 text-slate-500'
                  : 'border-slate-700 bg-black/40 text-slate-400',
              stopped && !active
                ? 'ring-2 ring-sky-400/70 ring-offset-1 ring-offset-slate-950'
                : '',
            ].join(' ')}
          >
            <span className="leading-none">{step.short}</span>
            {stopped && (
              <span
                className={[
                  'absolute -bottom-0.5 h-1.5 w-1.5 rounded-full',
                  active ? 'bg-white' : 'bg-sky-300',
                ].join(' ')}
              />
            )}
          </button>
        )
      })}
    </div>
  )

  if (dock) {
    return (
      <div className="phase-dock pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-2 z-30 flex max-w-[11.5rem] flex-col items-stretch gap-1.5 sm:right-4">
        <div className="pointer-events-auto rounded-2xl border border-sky-500/30 bg-slate-950/92 px-2 py-1.5 shadow-xl shadow-black/50 backdrop-blur-md">
          <div className="mb-1 flex items-baseline justify-between gap-1 px-0.5">
            <p className="truncate text-[9px] uppercase tracking-wider text-sky-300/75">
              {yourTurn ? 'You' : activeName} · T{turnNumber}
            </p>
            <p className="truncate text-[10px] font-semibold text-white/90">
              {PHASE_LABEL[phase]}
            </p>
          </div>
          {ladder}
          {lastAutoNote && (
            <p className="mt-1 truncate px-0.5 text-[10px] text-amber-200/85">
              {lastAutoNote}
            </p>
          )}
        </div>
        <button
          type="button"
          className={[
            'pointer-events-auto pass-btn min-h-[3.25rem] rounded-2xl px-3 py-2 text-left shadow-lg transition active:scale-[0.98]',
            yourTurn
              ? 'bg-gradient-to-br from-amber-400 to-orange-600 text-slate-950 shadow-amber-900/40'
              : 'bg-gradient-to-br from-sky-400 to-blue-700 text-white shadow-sky-900/40',
          ].join(' ')}
          onClick={onPass}
        >
          <span className="block text-base font-black leading-tight tracking-wide">
            {copy.label}
          </span>
          <span
            className={[
              'block text-[11px] font-medium leading-tight',
              yourTurn ? 'text-amber-950/75' : 'text-sky-100/85',
            ].join(' ')}
          >
            {copy.hint}
          </span>
        </button>
        {onStep && (
          <button
            type="button"
            className="pointer-events-auto self-end rounded-lg bg-slate-900/80 px-2 py-1 text-[10px] text-slate-400 ring-1 ring-slate-700"
            onClick={onStep}
            title="Advance one phase step"
          >
            Step
          </button>
        )}
      </div>
    )
  }

  // Non-dock fallback (setup / desktop strip)
  return (
    <div className="phase-rail w-full rounded-xl border border-sky-500/25 bg-slate-950/90 px-2 py-2 shadow-lg shadow-black/40">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-1 px-1">
        <p className="text-[10px] uppercase tracking-wider text-sky-300/80">
          {yourTurn ? 'Your turn' : 'Turn'} · {activeName}
        </p>
        <p className="text-xs font-semibold text-white">
          Turn {turnNumber}
          <span className="ml-2 font-normal text-sky-200/90">
            {PHASE_LABEL[phase]}
          </span>
        </p>
      </div>
      {ladder}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={[
            'pass-btn min-h-11 flex-[2] rounded-xl px-3 text-sm font-bold',
            yourTurn
              ? 'bg-amber-500 text-slate-950'
              : 'bg-sky-600 text-white',
          ].join(' ')}
          onClick={onPass}
        >
          {copy.label}
          <span className="ml-1 text-xs font-medium opacity-80">
            {copy.hint}
          </span>
        </button>
        {onStep && (
          <button
            type="button"
            className="min-h-11 flex-1 rounded-xl bg-slate-800 px-2 text-xs font-medium text-slate-100"
            onClick={onStep}
          >
            Step
          </button>
        )}
      </div>
    </div>
  )
}
