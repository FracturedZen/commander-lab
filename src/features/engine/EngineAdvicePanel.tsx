import { Link } from 'react-router-dom'
import type { AdviceResult } from '@/lib/ai/openrouter'

type Props = {
  open: boolean
  loading: boolean
  result: AdviceResult | null
  onClose: () => void
  onRefresh: () => void
}

export function EngineAdvicePanel({
  open,
  loading,
  result,
  onClose,
  onRefresh,
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
              Informational only — never auto-submits. Confirm via glow / Pass.
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
            <div className="space-y-2">
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
