import { useEffect, useState } from 'react'
import { searchCards } from '@/lib/scryfall/sync'
import type { CardRef } from '@/types/card'

type CardSearchProps = {
  onSelect: (card: CardRef) => void
  placeholder?: string
  commandersOnly?: boolean
  withinColorIdentity?: string[]
  autoFocus?: boolean
}

export function CardSearch({
  onSelect,
  placeholder = 'Search cards…',
  commandersOnly,
  withinColorIdentity,
  autoFocus,
}: CardSearchProps) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CardRef[]>([])
  const [searching, setSearching] = useState(false)
  const [emptyDb, setEmptyDb] = useState(false)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      setSearching(true)
      void searchCards(q, {
        limit: 25,
        commandersOnly,
        withinColorIdentity,
      })
        .then((rows) => {
          if (cancelled) return
          setResults(rows)
          setEmptyDb(rows.length === 0 && q.trim().length > 1)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, commandersOnly, withinColorIdentity])

  return (
    <div className="relative">
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
      />
      {searching && (
        <span className="absolute right-3 top-2.5 text-[11px] text-slate-500">
          …
        </span>
      )}
      {results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-900 shadow-xl">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-800"
                onClick={() => {
                  onSelect(c)
                  setQ('')
                  setResults([])
                }}
              >
                {c.imageSmall && typeof navigator !== 'undefined' && navigator.onLine ? (
                  <img
                    src={c.imageSmall}
                    alt=""
                    className="h-12 w-8 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-12 w-8 items-center justify-center rounded bg-slate-800 text-[8px] text-slate-500">
                    ?
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-100">{c.name}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {c.manaCost ?? '—'} · {c.typeLine ?? ''}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {emptyDb && results.length === 0 && !searching && (
        <p className="mt-1 text-[11px] text-amber-300/90">
          No matches. Sync cards from the Cards page if you have not yet.
        </p>
      )}
    </div>
  )
}
