import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteDeck, listDecks } from '@/lib/storage/decks'
import { installSampleDecks, SAMPLE_DECK_DEFS } from '@/lib/sample-decks/install'
import { validateCommanderDeck } from '@/lib/deck/legality'
import { adviseDeck } from '@/lib/ai/openrouter'
import type { Deck } from '@/types/deck'

export function DecksPage() {
  const [decks, setDecks] = useState<Deck[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [advice, setAdvice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const rows = await listDecks()
    setDecks(rows)
  }, [])

  useEffect(() => {
    void refresh().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Failed to load decks')
    })
  }, [refresh])

  async function onDelete(id: string) {
    setBusy(true)
    try {
      await deleteDeck(id)
      if (selectedId === id) setSelectedId(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const selected = decks.find((d) => d.id === selectedId) ?? null
  const validity = selected ? validateCommanderDeck(selected) : null

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Decks</h1>
          <p className="text-sm text-slate-400">
            Local IndexedDB decks. Use the builder to edit, import, and validate.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void installSampleDecks()
                .then(() => refresh())
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : 'Starter install failed'),
                )
                .finally(() => setBusy(false))
            }}
            className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Install starter decks
          </button>
          <Link
            to="/builder"
            className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            New / Builder
          </Link>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Saved decks ({decks.length})
          </div>
          {decks.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              No decks yet. Tap <strong className="text-slate-300">Install starter decks</strong>{' '}
              ({SAMPLE_DECK_DEFS.map((d) => d.commander).join(' · ')}) or{' '}
              <Link to="/builder" className="text-emerald-300 underline">
                open the builder
              </Link>
              . Sync on Cards is optional for starters.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {decks.map((d) => {
                const v = validateCommanderDeck(d)
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(d.id)
                        setAdvice(null)
                      }}
                      className={[
                        'flex w-full items-start justify-between gap-2 px-3 py-3 text-left hover:bg-slate-800/50',
                        selectedId === d.id ? 'bg-emerald-950/40' : '',
                      ].join(' ')}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-100">{d.name}</p>
                        <p className="text-xs text-slate-500">
                          {d.commander?.name ?? 'No commander'} · {v.totalCards}
                          /100 ·{' '}
                          <span
                            className={
                              v.ok ? 'text-emerald-400' : 'text-amber-300'
                            }
                          >
                            {v.ok ? 'legal' : `${v.issues.length} issues`}
                          </span>
                        </p>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          void onDelete(d.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation()
                            void onDelete(d.id)
                          }
                        }}
                        className="rounded px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/50"
                      >
                        Delete
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Deck detail
          </h2>
          {!selected ? (
            <p className="text-sm text-slate-500">Select a deck to inspect.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-lg font-semibold text-white">{selected.name}</p>
                <p className="text-slate-400">
                  Commander:{' '}
                  <span className="text-emerald-200">
                    {selected.commander?.name ?? '—'}
                  </span>
                  {selected.partner ? (
                    <>
                      {' '}
                      · Partner:{' '}
                      <span className="text-emerald-200">
                        {selected.partner.name}
                      </span>
                    </>
                  ) : null}
                </p>
                {validity && (
                  <p className="mt-1 text-xs text-slate-500">
                    {validity.totalCards}/100 ·{' '}
                    {validity.ok
                      ? 'Passes basic Commander checks'
                      : validity.issues.slice(0, 3).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/builder?id=${selected.id}`}
                  className="rounded-md bg-emerald-700 px-3 py-2 text-xs text-white"
                >
                  Edit in builder
                </Link>
                <Link
                  to="/"
                  className="rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-600"
                >
                  Open table (load from there)
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void adviseDeck(selected)
                      .then((r) =>
                        setAdvice(
                          `[${r.source}${r.model ? ` · ${r.model}` : ''}]\n\n${r.text}`,
                        ),
                      )
                      .finally(() => setBusy(false))
                  }}
                  className="rounded-md bg-indigo-800/80 px-3 py-2 text-xs text-indigo-100"
                >
                  Advise
                </button>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase text-slate-500">
                  Cards ({selected.cards.length} unique)
                </p>
                <ul className="max-h-64 space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/50 p-2 font-mono text-[11px] text-slate-400">
                  {selected.cards.map((c) => (
                    <li key={c.id}>
                      {c.quantity ?? 1} {c.name}
                    </li>
                  ))}
                </ul>
              </div>
              {advice && (
                <pre className="whitespace-pre-wrap rounded border border-indigo-500/30 bg-indigo-950/20 p-3 font-sans text-xs text-slate-200">
                  {advice}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
