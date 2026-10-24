import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CardSearch } from '@/components/CardSearch'
import {
  addCardToList,
  commanderColorIdentity,
  removeCardFromList,
  validateCommanderDeck,
} from '@/lib/deck/legality'
import {
  detectFormat,
  resolveImport,
  tryFetchMoxfield,
} from '@/lib/deck/import'
import { createDeck, getDeck, updateDeck } from '@/lib/storage/decks'
import { adviseDeck } from '@/lib/ai/openrouter'
import type { CardRef } from '@/types/card'
import type { Deck } from '@/types/deck'

export function BuilderPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editId = params.get('id')

  const [name, setName] = useState('New Commander Deck')
  const [commander, setCommander] = useState<CardRef | undefined>()
  const [partner, setPartner] = useState<CardRef | undefined>()
  const [cards, setCards] = useState<CardRef[]>([])
  const [notes, setNotes] = useState('')
  const [deckId, setDeckId] = useState<string | null>(editId)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [advice, setAdvice] = useState<string | null>(null)
  const [pickMode, setPickMode] = useState<'main' | 'commander' | 'partner'>('main')

  useEffect(() => {
    if (!editId) return
    void getDeck(editId).then((d) => {
      if (!d) return
      setDeckId(d.id)
      setName(d.name)
      setCommander(d.commander)
      setPartner(d.partner)
      setCards(d.cards)
      setNotes(d.notes ?? '')
    })
  }, [editId])

  const draft: Deck = useMemo(
    () => ({
      id: deckId ?? 'draft',
      name,
      commander,
      partner,
      cards,
      notes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    [deckId, name, commander, partner, cards, notes],
  )

  const validity = useMemo(() => validateCommanderDeck(draft), [draft])
  const ci = useMemo(
    () => commanderColorIdentity(commander, partner),
    [commander, partner],
  )

  const onPick = useCallback(
    (card: CardRef) => {
      if (pickMode === 'commander') {
        setCommander({ ...card, isCommander: true, quantity: 1 })
        setPickMode('main')
        return
      }
      if (pickMode === 'partner') {
        setPartner({ ...card, isCommander: true, quantity: 1 })
        setPickMode('main')
        return
      }
      setCards((prev) => addCardToList(prev, card, 1))
    },
    [pickMode],
  )

  async function onSave() {
    setBusy(true)
    setMessage(null)
    try {
      if (deckId) {
        await updateDeck(deckId, { name, commander, partner, cards, notes })
        setMessage('Deck saved.')
      } else {
        const created = await createDeck({ name, commander, partner, cards, notes })
        setDeckId(created.id)
        setMessage('Deck created.')
        navigate(`/builder?id=${created.id}`, { replace: true })
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function onImportPaste() {
    setBusy(true)
    setMessage(null)
    try {
      const format = detectFormat(importText)
      const result = await resolveImport(importText, {
        treatFirstLegendaryAsCommander: !/commander:/i.test(importText),
      })
      if (result.commander) setCommander(result.commander)
      if (result.partner) setPartner(result.partner)
      setCards(result.cards)
      setMessage(
        `Imported (${format}): ${result.cards.length} unique main cards` +
          (result.unresolved.length
            ? `, ${result.unresolved.length} unresolved — sync cards or fix names`
            : ''),
      )
      if (result.unresolved.length) {
        setNotes((n) =>
          [n, 'Unresolved:', ...result.unresolved.slice(0, 30)].filter(Boolean).join('\n'),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function onImportUrl() {
    setBusy(true)
    setMessage(null)
    try {
      const text = await tryFetchMoxfield(importUrl.trim())
      if (!text) {
        setMessage(
          'Could not fetch that URL (likely CORS). Open Moxfield → Export → paste the text below.',
        )
        return
      }
      setImportText(text)
      setMessage('Fetched deck text — review and tap Import text.')
    } finally {
      setBusy(false)
    }
  }

  async function onAdvise() {
    setBusy(true)
    setAdvice(null)
    try {
      const result = await adviseDeck(draft)
      setAdvice(
        `[${result.source}${result.model ? ` · ${result.model}` : ''}]\n\n${result.text}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const sorted = useMemo(
    () =>
      [...cards].sort((a, b) => {
        const al = a.typeLine?.includes('Land') ? 1 : 0
        const bl = b.typeLine?.includes('Land') ? 1 : 0
        if (al !== bl) return al - bl
        return a.name.localeCompare(b.name)
      }),
    [cards],
  )

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Deck builder</h1>
          <p className="text-sm text-slate-400">
            Search synced cards, set commander/partner, import lists, check legality.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ValidityBadge ok={validity.ok} total={validity.totalCards} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAdvise()}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-600 hover:bg-slate-700"
          >
            Advise
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Save deck
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-4">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Deck name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>

          <div className="flex flex-wrap gap-2 text-xs">
            {(
              [
                ['main', 'Add to deck'],
                ['commander', 'Set commander'],
                ['partner', 'Set partner'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPickMode(mode)}
                className={[
                  'rounded-full px-3 py-1.5',
                  pickMode === mode
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          <CardSearch
            onSelect={onPick}
            commandersOnly={pickMode !== 'main'}
            withinColorIdentity={
              pickMode === 'main' && ci.length > 0 ? ci : undefined
            }
            placeholder={
              pickMode === 'commander'
                ? 'Search commander…'
                : pickMode === 'partner'
                  ? 'Search partner…'
                  : ci.length
                    ? `Search within ${ci.join('')}…`
                    : 'Search cards…'
            }
          />

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-xs text-slate-400">
              Commander:{' '}
              <span className="text-emerald-200">
                {commander?.name ?? '—'}
              </span>
              {partner ? (
                <>
                  {' '}
                  · Partner:{' '}
                  <span className="text-emerald-200">{partner.name}</span>
                </>
              ) : null}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Color identity: {ci.join('') || '(set a commander)'} ·{' '}
              {validity.issues[0] ?? 'Looking good so far'}
            </p>
            {validity.issues.length > 1 && (
              <ul className="mt-2 max-h-24 list-disc overflow-y-auto pl-4 text-[11px] text-amber-200/90">
                {validity.issues.slice(0, 12).map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </div>

          <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-200">
              Import decklist
            </summary>
            <div className="mt-3 space-y-3">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Moxfield URL (optional — CORS often blocks; paste export if so)
                <div className="flex gap-2">
                  <input
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="https://moxfield.com/decks/…"
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={busy || !importUrl.trim()}
                    onClick={() => void onImportUrl()}
                    className="rounded-md bg-slate-800 px-3 py-2 text-xs text-white ring-1 ring-slate-600"
                  >
                    Fetch
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Paste text (MTGO / Arena / Moxfield / Archidekt / Mana Box)
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={8}
                  placeholder={'COMMANDER: 1 Aesi, Tyrant of Gyre Strait\n1 Sol Ring\n1 Command Tower\n…'}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-emerald-500"
                />
              </label>
              <button
                type="button"
                disabled={busy || !importText.trim()}
                onClick={() => void onImportPaste()}
                className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                Import text
              </button>
            </div>
          </details>

          {advice && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-200">
                Advice
              </h2>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-200">
                {advice}
              </pre>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Maindeck ({cards.reduce((s, c) => s + (c.quantity ?? 1), 0)} cards)
            </h2>
            <button
              type="button"
              className="text-[11px] text-slate-500 hover:text-rose-300"
              onClick={() => setCards([])}
            >
              Clear
            </button>
          </div>
          <ul className="max-h-[70vh] divide-y divide-slate-800/80 overflow-y-auto">
            {sorted.length === 0 ? (
              <li className="p-4 text-sm text-slate-500">
                Add cards via search or import.
              </li>
            ) : (
              sorted.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="w-6 tabular-nums text-slate-500">
                    {c.quantity ?? 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-slate-100">{c.name}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {c.manaCost ?? ''} {c.typeLine ?? ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                    onClick={() =>
                      setCards((prev) => addCardToList(prev, c, 1))
                    }
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/40"
                    onClick={() =>
                      setCards((prev) =>
                        removeCardFromList(prev, c.oracleId ?? c.id, 1),
                      )
                    }
                  >
                    −
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

function ValidityBadge({ ok, total }: { ok: boolean; total: number }) {
  return (
    <span
      className={[
        'rounded-full px-3 py-1 text-xs font-medium',
        ok
          ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
          : 'bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30',
      ].join(' ')}
    >
      {total}/100 {ok ? 'legal' : 'issues'}
    </span>
  )
}
