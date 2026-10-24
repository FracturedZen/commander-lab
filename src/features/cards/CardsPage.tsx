import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getCardDbMeta,
  syncScryfallCards,
  type CardDbMeta,
  type SyncProgress,
} from '@/lib/scryfall/sync'
import { CardSearch } from '@/components/CardSearch'
import type { CardRef } from '@/types/card'

export function CardsPage() {
  const [meta, setMeta] = useState<CardDbMeta | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<CardRef | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    setMeta(await getCardDbMeta())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onSync() {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'meta', message: 'Starting…', fraction: 0 })
    abortRef.current = new AbortController()
    try {
      const next = await syncScryfallCards(
        (p) => setProgress(p),
        abortRef.current.signal,
      )
      setMeta(next)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setProgress({ phase: 'error', message: 'Sync cancelled.' })
      } else {
        setError(e instanceof Error ? e.message : 'Sync failed')
        setProgress({
          phase: 'error',
          message: e instanceof Error ? e.message : 'Sync failed',
        })
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function onCancel() {
    abortRef.current?.abort()
  }

  const pct = Math.round((progress?.fraction ?? 0) * 100)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Card database</h1>
        <p className="mt-1 text-sm text-slate-400">
          Offline-first: tap <strong className="text-slate-200">Sync cards</strong> once
          while online. We download Scryfall <code className="text-emerald-300">oracle_cards</code>{' '}
          as gzipped JSONL (~25&nbsp;MB compressed), decompress in-browser, and index
          trimmed fields into IndexedDB. Search then works offline. Art uses Scryfall CDN
          when online; offline falls back to name/text. Starter decks on the table work
          even before sync.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Rate limits: catalog once, short pause, then one bulk file download. Progress shows
          catalog → download → decompress/index. Errors surface in red below the button.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-300">
            {meta ? (
              <>
                <p>
                  <span className="font-semibold text-emerald-300">
                    {meta.cardCount.toLocaleString()}
                  </span>{' '}
                  cards · {meta.bulkType}
                </p>
                <p className="text-xs text-slate-500">
                  Synced {new Date(meta.updatedAt).toLocaleString()}
                  {meta.scryfallUpdatedAt
                    ? ` · Scryfall file ${new Date(meta.scryfallUpdatedAt).toLocaleDateString()}`
                    : ''}
                </p>
              </>
            ) : (
              <p className="text-amber-200">Not synced yet — search and imports need this.</p>
            )}
          </div>
          <div className="flex gap-2">
            {busy ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md bg-slate-800 px-4 py-2.5 text-sm text-slate-200 ring-1 ring-slate-600"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void onSync()}
                className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
              >
                {meta ? 'Re-sync cards' : 'Sync cards'}
              </button>
            )}
          </div>
        </div>

        {progress && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] text-slate-400">
              <span><span className="mr-1 uppercase text-emerald-500/80">{progress.phase}</span>{progress.message}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Try local search
        </h2>
        <CardSearch onSelect={setPreview} placeholder="e.g. Sol Ring, Cyclonic Rift…" />
        {preview && (
          <div className="mt-4 flex gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            {preview.imageNormal && typeof navigator !== 'undefined' && navigator.onLine ? (
              <img
                src={preview.imageNormal}
                alt={preview.name}
                className="h-40 w-28 rounded object-cover"
              />
            ) : (
              <div className="flex h-40 w-28 items-center justify-center rounded bg-slate-800 text-xs text-slate-500">
                Offline / no art
              </div>
            )}
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-white">{preview.name}</p>
              <p className="text-amber-200/90">{preview.manaCost ?? '—'}</p>
              <p className="text-slate-400">{preview.typeLine}</p>
              <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">
                {preview.oracleText ?? 'No oracle text cached.'}
              </p>
              <p className="mt-2 text-[11px] text-slate-500">
                CI: {(preview.colorIdentity ?? []).join('') || 'C'} · legality:{' '}
                {preview.commanderLegality ?? '?'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
