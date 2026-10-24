import type { PendingAction } from '@/lib/rules/moveLegality'

/**
 * Arena-inspired stack chrome. Real priority/stack engine is deferred —
 * pendingActions show here as queued effects.
 */
type Props = {
  pendingActions: PendingAction[]
}

export function StackStub({ pendingActions }: Props) {
  return (
    <aside className="stack-stub rounded-xl border border-violet-500/25 bg-slate-950/80 p-2 text-[11px] text-violet-100/90">
      <header className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-300/90">
          Stack
        </span>
        <span className="text-[9px] text-violet-200/50">stub</span>
      </header>
      {pendingActions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-violet-500/20 px-2 py-3 text-center text-violet-200/40">
          Empty — spells &amp; triggers will land here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {[...pendingActions].reverse().map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-violet-400/30 bg-violet-950/50 px-2 py-1.5"
            >
              <span className="font-medium text-violet-50">
                {a.label ?? a.type}
              </span>
              <span className="ml-1 text-violet-200/70">×{a.count}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
