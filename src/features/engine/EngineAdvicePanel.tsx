import { Link } from 'react-router-dom'
import type { AdviceResult } from '@/lib/ai/openrouter'
import type { CoachGlowMatch } from '@/engine/coachGlow'

type Props = {
  open: boolean
  loading: boolean
  result: AdviceResult | null
  matches?: CoachGlowMatch[]
  focusedKey?: string | null
  onClose: () => void
  onRefresh: () => void
  /** Highlight matching board glows — never submits. */
  onFocusMatch?: (match: CoachGlowMatch) => void
}

function matchKey(m: CoachGlowMatch): string {
  return m.objectIds.join(',') + '|' + m.actionTypes.join(',')
}

export function EngineAdvicePanel({
  open,
  loading,
  result,
  matches = [],
  focusedKey = null,
  onClose,
  onRefresh,
  onFocusMatch,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-stretch sm:justify-end">
      <button
        type="button"
        aria-label="Close advice"
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Coach advice"
        className="relative z-[61] flex max-h-[78vh] w-full flex-col rounded-t-2xl border border-slate-700 bg-slate-950 shadow-2xl sm:h-full sm:max-h-none sm:w-[min(24rem,100vw)] sm:rounded-none sm:border-l sm:border-t-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-slate-100">Coach advice</p>
            <p className="text-[10px] text-slate-500">
              Informational only — never auto-submits. Tap a match to glow the
              board; confirm via Pass / legal actions.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-violet-200">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400" />
              Asking OpenRouter…
            </div>
          )}

          {!loading && result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span
                  className={
                    result.source === 'openrouter'
                      ? 'rounded bg-violet-950 px-1.5 py-0.5 font-medium text-violet-200 ring-1 ring-violet-700/50'
                      : 'rounded bg-slate-800 px-1.5 py-0.5 font-medium text-slate-300 ring-1 ring-slate-600'
                  }
                >
                  {result.source === 'openrouter' ? 'OpenRouter' : 'Local tips'}
                </span>
                {result.model ? (
                  <span className="truncate text-slate-500">{result.model}</span>
                ) : null}
                {result.error === 'no-key' ? (
                  <Link
                    to="/settings"
                    className="rounded bg-amber-950/80 px-1.5 py-0.5 font-medium text-amber-200 ring-1 ring-amber-700/50"
                  >
                    Open Settings
                  </Link>
                ) : null}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-200">
                {result.text}
              </pre>
              {matches.length > 0 && onFocusMatch ? (
                <div className="space-y-1.5 rounded-lg border border-violet-500/30 bg-violet-950/30 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-200/80">
                    Matched legal glows — tap to highlight
                  </p>
                  <div className="flex flex-col gap-1">
                    {matches.map((m) => {
                      const key = matchKey(m)
                      const active = focusedKey === key
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onFocusMatch(m)}
                          className={
                            active
                              ? 'rounded-md bg-violet-600 px-2 py-2 text-left text-xs text-white ring-2 ring-violet-300'
                              : 'rounded-md bg-slate-900 px-2 py-2 text-left text-xs text-violet-100 ring-1 ring-violet-700/40 hover:bg-slate-800'
                          }
                        >
                          {m.label}
                          <span className="mt-0.5 block text-[10px] text-violet-200/60">
                            {m.objectIds.length
                              ? `${m.objectIds.length} object${m.objectIds.length === 1 ? '' : 's'}`
                              : 'action type'}
                            {m.actionTypes.length
                              ? ` · ${m.actionTypes.slice(0, 2).join(', ')}`
                              : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {!loading && !result && (
            <p className="text-sm text-slate-500">Tap Refresh to request advice.</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-800 px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="min-h-11 flex-1 rounded-xl bg-violet-700 px-3 text-sm font-semibold text-white ring-1 ring-violet-400/30 hover:bg-violet-600 disabled:opacity-50"
          >
            {loading ? '…' : result ? 'Refresh advice' : 'Get advice'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl bg-slate-800 px-3 text-sm text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700"
          >
            Done
          </button>
        </div>
      </aside>
    </div>
  )
}
