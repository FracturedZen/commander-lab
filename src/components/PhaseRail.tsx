import {
  PHASE_LABEL,
  PHASE_ORDER,
  type Phase,
} from '@/lib/rules/turnMachine'

/** Compact Arena-like phase ladder. Combat steps collapse under Combat. */
const RAIL: { id: string; label: string; phases: Phase[] }[] = [
  { id: 'beg', label: 'Beg', phases: ['untap', 'upkeep', 'draw'] },
  { id: 'm1', label: 'Main', phases: ['main1'] },
  {
    id: 'cbt',
    label: 'Combat',
    phases: [
      'combat_begin',
      'combat_attackers',
      'combat_blockers',
      'combat_damage',
      'combat_end',
    ],
  },
  { id: 'm2', label: 'Main', phases: ['main2'] },
  { id: 'end', label: 'End', phases: ['end'] },
]

type Props = {
  phase: Phase
  turnNumber: number
  activeName: string
  yourTurn: boolean
  lastAutoNote?: string | null
  onNextPhase: () => void
  onEndTurn: () => void
}

export function PhaseRail({
  phase,
  turnNumber,
  activeName,
  yourTurn,
  lastAutoNote,
  onNextPhase,
  onEndTurn,
}: Props) {
  const idx = PHASE_ORDER.indexOf(phase)

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
      <div className="flex items-stretch gap-1">
        {RAIL.map((step) => {
          const active = step.phases.includes(phase)
          const passed = step.phases.every(
            (p) => PHASE_ORDER.indexOf(p) < idx,
          )
          return (
            <div
              key={step.id}
              className={[
                'flex min-h-9 flex-1 flex-col items-center justify-center rounded-lg border px-0.5 text-center transition',
                active
                  ? yourTurn
                    ? 'border-amber-400/80 bg-amber-500/25 text-amber-50 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
                    : 'border-sky-400/80 bg-sky-500/25 text-sky-50 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                  : passed
                    ? 'border-slate-700/60 bg-slate-900/50 text-slate-500'
                    : 'border-slate-800 bg-black/30 text-slate-400',
              ].join(' ')}
              title={step.phases.map((p) => PHASE_LABEL[p]).join(' → ')}
            >
              <span className="text-[10px] font-semibold leading-tight sm:text-[11px]">
                {step.label}
              </span>
              {active && step.id === 'cbt' && (
                <span className="text-[8px] text-amber-100/80">
                  {PHASE_LABEL[phase].replace('Combat ', '').replace('Declare ', '')}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {lastAutoNote && (
        <p className="mt-1 truncate px-1 text-[11px] text-amber-200/90">
          {lastAutoNote}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="min-h-9 flex-1 rounded-lg bg-slate-800 px-2 text-xs font-medium text-slate-100"
          onClick={onNextPhase}
        >
          Next phase
        </button>
        <button
          type="button"
          className="min-h-9 flex-1 rounded-lg bg-sky-700/90 px-2 text-xs font-semibold text-white"
          onClick={onEndTurn}
        >
          End turn
        </button>
      </div>
    </div>
  )
}
