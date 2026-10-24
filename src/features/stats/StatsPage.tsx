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

  // Plain-language inputs (same math as before)
  const [librarySize, setLibrarySize] = useState(99)
  const [copiesInDeck, setCopiesInDeck] = useState(10)
  const [cardsDrawn, setCardsDrawn] = useState(7)
  const [wantAtLeast, setWantAtLeast] = useState(1)
  const [showMath, setShowMath] = useState(false)

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
    setLibrarySize(lib.length || 99)
    setCopiesInDeck(lib.filter((c) => isLand(c)).length)
  }, [deck])

  const odds = useMemo(() => {
    return {
      exact: hypergeometricExact(
        librarySize,
        copiesInDeck,
        cardsDrawn,
        wantAtLeast,
      ),
      atLeast: hypergeometricAtLeast(
        librarySize,
        copiesInDeck,
        cardsDrawn,
        wantAtLeast,
      ),
    }
  }, [librarySize, copiesInDeck, cardsDrawn, wantAtLeast])

  function onGoldfish() {
    if (!deck) return
    const r = runGoldfish(deck, {
      iterations,
      keepLandMin: keepMin,
      keepLandMax: keepMax,
    })
    setResult(r)
  }

  const cardWord = wantAtLeast === 1 ? 'card' : 'cards'
  const copiesWord =
    copiesInDeck === 1 ? '1 copy' : `${copiesInDeck} copies`

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-4">
      <div>
        <h1 className="text-xl font-semibold text-white">
          Bulk testing &amp; stats
        </h1>
        <p className="text-sm text-slate-400">
          Check opening-hand odds and mana consistency on this device — no
          internet needed once your deck is saved.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Which deck?
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
        <h2 className="text-sm font-semibold text-slate-200">
          Odds of seeing certain cards
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Defaults fill in with land count from the selected deck. Change the
          numbers to test tutors, rocks, or anything else you care about.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField
            label="Cards in library"
            value={librarySize}
            onChange={setLibrarySize}
          />
          <NumField
            label="Copies you’re looking for"
            value={copiesInDeck}
            onChange={setCopiesInDeck}
          />
          <NumField
            label="Cards you draw"
            value={cardsDrawn}
            onChange={setCardsDrawn}
          />
          <NumField
            label="How many you want (at least)"
            value={wantAtLeast}
            onChange={setWantAtLeast}
          />
        </div>

        <div className="mt-4 space-y-3 rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3">
          <p className="text-sm leading-relaxed text-emerald-50">
            Odds of seeing <strong>at least {wantAtLeast}</strong> of those{' '}
            {cardWord} in a draw of <strong>{cardsDrawn}</strong>, from a{' '}
            <strong>{librarySize}</strong>-card library that has{' '}
            <strong>{copiesWord}</strong>:{' '}
            <span className="text-xl font-bold tabular-nums text-emerald-300">
              {pct(odds.atLeast)}
            </span>
          </p>
          <p className="text-sm text-slate-300">
            Odds of seeing <strong>exactly {wantAtLeast}</strong>:{' '}
            <span className="font-semibold tabular-nums text-emerald-200">
              {pct(odds.exact)}
            </span>
          </p>
        </div>

        <details
          className="mt-3 text-xs text-slate-500"
          open={showMath}
          onToggle={(e) => setShowMath((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-slate-400 hover:text-slate-300">
            Show math
          </summary>
          <p className="mt-2 leading-relaxed">
            This uses the hypergeometric distribution: population size{' '}
            <code className="text-slate-400">N={librarySize}</code>, successes
            in the deck <code className="text-slate-400">K={copiesInDeck}</code>
            , draws <code className="text-slate-400">n={cardsDrawn}</code>,
            wanting <code className="text-slate-400">k≥{wantAtLeast}</code>.
            Same numbers as above — just the textbook labels.
          </p>
        </details>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-slate-200">
          Opening-hand goldfish
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Shuffle thousands of opening hands and see how often you’d keep them
          based on land count. Good for “does this mana base feel consistent?”
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <NumField
            label="Hands to simulate"
            value={iterations}
            onChange={setIterations}
          />
          <NumField
            label="Keep if lands ≥"
            value={keepMin}
            onChange={setKeepMin}
          />
          <NumField
            label="Keep if lands ≤"
            value={keepMax}
            onChange={setKeepMax}
          />
        </div>
        <button
          type="button"
          disabled={!deck}
          onClick={onGoldfish}
          className="mt-3 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Run opening-hand test
        </button>

        {result && (
          <div className="mt-4 space-y-4">
            <div className="space-y-2 rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3 text-sm text-emerald-50">
              <p>
                About{' '}
                <strong className="text-xl tabular-nums text-emerald-300">
                  {pct(result.keepRate)}
                </strong>{' '}
                of opening hands had{' '}
                <strong>
                  {keepMin}–{keepMax} lands
                </strong>{' '}
                (your keep range) across {result.iterations.toLocaleString()}{' '}
                shuffles.
              </p>
              <p className="text-slate-300">
                On average you saw{' '}
                <strong className="tabular-nums text-emerald-200">
                  {result.avgLandsInOpener.toFixed(1)}
                </strong>{' '}
                lands in the opener. Non-land spells in hand averaged mana value{' '}
                <strong className="tabular-nums text-emerald-200">
                  {result.avgCmcNonLandInHand.toFixed(1)}
                </strong>
                .
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <StatCard
                label="Average lands in opener"
                value={result.avgLandsInOpener.toFixed(2)}
              />
              <StatCard
                label={`Hands you’d keep (${keepMin}–${keepMax} lands)`}
                value={pct(result.keepRate)}
              />
              <StatCard
                label="Avg mana value of non-lands in hand"
                value={result.avgCmcNonLandInHand.toFixed(2)}
              />
            </div>

            <div>
              <h3 className="mb-1 text-xs font-medium text-slate-300">
                How many lands showed up?
              </h3>
              <p className="mb-2 text-[11px] text-slate-500">
                Share of the {result.iterations.toLocaleString()} test hands with
                each land count.
              </p>
              <BarTable
                data={result.landDistribution}
                total={result.iterations}
                formatLabel={(n) =>
                  n === 1 ? '1 land' : `${n} lands`
                }
              />
            </div>

            <div>
              <h3 className="mb-1 text-xs font-medium text-slate-300">
                Mana curve (non-lands in the 99)
              </h3>
              <p className="mb-2 text-[11px] text-slate-500">
                How expensive your spells are — not a hand simulation, just the
                deck list.
              </p>
              <BarTable
                data={result.manaCurve}
                total={
                  Object.values(result.manaCurve).reduce((a, b) => a + b, 0) ||
                  1
                }
                formatLabel={(n) =>
                  n >= 7 ? 'MV 7+' : `Mana value ${n}`
                }
              />
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium text-slate-300">
                Sample hands
              </h3>
              <ul className="space-y-2 text-xs text-slate-400">
                {result.sampleHands.map((h, i) => (
                  <li
                    key={i}
                    className="rounded border border-slate-800 bg-slate-950/50 p-2"
                  >
                    <span
                      className={h.kept ? 'text-emerald-300' : 'text-rose-300'}
                    >
                      {h.kept ? 'Would keep' : 'Would mulligan'} · {h.lands}{' '}
                      {h.lands === 1 ? 'land' : 'lands'}
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
      <p className="text-xl font-semibold tabular-nums text-emerald-300">
        {value}
      </p>
    </div>
  )
}

function BarTable({
  data,
  total,
  formatLabel,
}: {
  data: Record<number, number>
  total: number
  formatLabel: (n: number) => string
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
            <span className="w-28 shrink-0 text-slate-400">
              {formatLabel(key)}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full rounded bg-emerald-600/80"
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="w-16 text-right tabular-nums text-slate-500">
              {pct(count / total, 0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
