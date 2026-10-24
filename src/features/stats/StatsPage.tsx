import { useEffect, useMemo, useState } from 'react'
import { listDecks } from '@/lib/storage/decks'
import { expandDeckCards } from '@/lib/deck/legality'
import {
  hypergeometricAtLeast,
  hypergeometricExact,
  pct,
} from '@/lib/stats/hypergeometric'
import { runGoldfish, type GoldfishResult } from '@/lib/stats/goldfish'
import { isLand } from '@/types/card'
import type { Deck } from '@/types/deck'

export function StatsPage() {
  const [decks, setDecks] = useState<Deck[]>([])
  const [deckId, setDeckId] = useState<string>('')
  const [iterations, setIterations] = useState(2000)
  const [keepMin, setKeepMin] = useState(2)
  const [keepMax, setKeepMax] = useState(5)
  const [result, setResult] = useState<GoldfishResult | null>(null)

  // Hypergeometric inputs
  const [N, setN] = useState(99)
  const [K, setK] = useState(10)
  const [n, setNDraw] = useState(7)
  const [k, setKWant] = useState(1)

  useEffect(() => {
    void listDecks().then((rows) => {
      setDecks(rows)
      if (rows[0]) setDeckId(rows[0].id)
    })
  }, [])

  const deck = decks.find((d) => d.id === deckId)

  useEffect(() => {
    if (!deck) return
    const lib = expandDeckCards(deck.cards)
    setN(lib.length || 99)
    setK(lib.filter((c) => isLand(c)).length)
  }, [deck])

  const hyper = useMemo(() => {
    return {
      exact: hypergeometricExact(N, K, n, k),
      atLeast: hypergeometricAtLeast(N, K, n, k),
    }
  }, [N, K, n, k])

  function onGoldfish() {
    if (!deck) return
    const r = runGoldfish(deck, {
      iterations,
      keepLandMin: keepMin,
      keepLandMax: keepMax,
    })
    setResult(r)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Bulk testing & stats</h1>
        <p className="text-sm text-slate-400">
          Fully offline on local deck data — hypergeometric draw odds and Monte Carlo
          opening-hand goldfish.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Deck
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
        >
          {decks.length === 0 && <option value="">No decks yet</option>}
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.commander ? ` (${d.commander.name})` : ''}
            </option>
          ))}
        </select>
      </label>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Hypergeometric draw odds</h2>
        <p className="mt-1 text-xs text-slate-500">
          Population N, K successes in deck, draw n, want at least k (defaults: lands in
          opening hand).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField label="N (deck)" value={N} onChange={setN} />
          <NumField label="K (successes)" value={K} onChange={setK} />
          <NumField label="n (draw)" value={n} onChange={setNDraw} />
          <NumField label="k (want ≥)" value={k} onChange={setKWant} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <StatCard
            label={`P(exactly ${k})`}
            value={pct(hyper.exact)}
          />
          <StatCard
            label={`P(at least ${k})`}
            value={pct(hyper.atLeast)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Goldfish / Monte Carlo</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <NumField label="Iterations" value={iterations} onChange={setIterations} />
          <NumField label="Keep lands ≥" value={keepMin} onChange={setKeepMin} />
          <NumField label="Keep lands ≤" value={keepMax} onChange={setKeepMax} />
        </div>
        <button
          type="button"
          disabled={!deck}
          onClick={onGoldfish}
          className="mt-3 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Run goldfish
        </button>

        {result && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <StatCard
                label="Avg lands in opener"
                value={result.avgLandsInOpener.toFixed(2)}
              />
              <StatCard
                label={`Keep rate (${keepMin}–${keepMax} lands)`}
                value={pct(result.keepRate)}
              />
              <StatCard
                label="Avg CMC non-lands in hand"
                value={result.avgCmcNonLandInHand.toFixed(2)}
              />
            </div>

            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-slate-500">
                Land count distribution ({result.iterations} hands)
              </h3>
              <BarTable
                data={result.landDistribution}
                total={result.iterations}
              />
            </div>

            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-slate-500">
                Mana curve (non-lands in 99)
              </h3>
              <BarTable data={result.manaCurve} total={Object.values(result.manaCurve).reduce((a, b) => a + b, 0) || 1} labelPrefix="MV " />
            </div>

            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-slate-500">
                Sample hands
              </h3>
              <ul className="space-y-2 text-xs text-slate-400">
                {result.sampleHands.map((h, i) => (
                  <li
                    key={i}
                    className="rounded border border-slate-800 bg-slate-950/50 p-2"
                  >
                    <span className={h.kept ? 'text-emerald-300' : 'text-rose-300'}>
                      {h.kept ? 'KEEP' : 'MULL'} · {h.lands} lands
                    </span>
                    <p className="mt-1 text-slate-500">{h.names.join(' · ')}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
      />
    </label>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-emerald-300">{value}</p>
    </div>
  )
}

function BarTable({
  data,
  total,
  labelPrefix = '',
}: {
  data: Record<number, number>
  total: number
  labelPrefix?: string
}) {
  const keys = Object.keys(data)
    .map(Number)
    .sort((a, b) => a - b)
  const max = Math.max(1, ...Object.values(data))
  return (
    <div className="space-y-1">
      {keys.map((key) => {
        const count = data[key] ?? 0
        const width = (count / max) * 100
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="w-12 tabular-nums text-slate-400">
              {labelPrefix}{key}{key >= 7 && labelPrefix ? '+' : ''}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full rounded bg-emerald-600/80"
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="w-16 text-right tabular-nums text-slate-500">
              {count} ({pct(count / total, 0)})
            </span>
          </div>
        )
      })}
    </div>
  )
}
