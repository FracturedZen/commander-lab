import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_OPENROUTER_MODEL,
  SETTINGS_KEYS,
  deleteSetting,
  getSetting,
  setSetting,
} from '@/lib/storage/settings'

export function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(DEFAULT_OPENROUTER_MODEL)
  const [saved, setSaved] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [rulesStrict, setRulesStrict] = useState(true)

  useEffect(() => {
    void (async () => {
      const k = await getSetting<string>(SETTINGS_KEYS.openRouterApiKey)
      const m = await getSetting<string>(SETTINGS_KEYS.openRouterModel)
      const strict = await getSetting<boolean>(SETTINGS_KEYS.rulesStrict)
      setHasKey(Boolean(k))
      setApiKey(k ? '••••••••••••' : '')
      if (m) setModel(m)
      if (strict === false) setRulesStrict(false)
    })()
  }, [])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (apiKey && !apiKey.startsWith('••')) {
      await setSetting(SETTINGS_KEYS.openRouterApiKey, apiKey.trim())
      setHasKey(true)
      setApiKey('••••••••••••')
    }
    await setSetting(
      SETTINGS_KEYS.openRouterModel,
      model.trim() || DEFAULT_OPENROUTER_MODEL,
    )
    await setSetting(SETTINGS_KEYS.rulesStrict, rulesStrict)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function onClearKey() {
    await deleteSetting(SETTINGS_KEYS.openRouterApiKey)
    setHasKey(false)
    setApiKey('')
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
        <p className="text-sm text-slate-400">
          Keys stay in this device&apos;s IndexedDB — never committed to the repo.
        </p>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Table rules</h2>
        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={rulesStrict}
            onChange={(e) => setRulesStrict(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-600"
          />
          <span>
            <span className="block text-sm text-white">
              Hide sandbox debug (recommended)
            </span>
            <span className="mt-0.5 block text-xs text-slate-400">
              Always enforced: one land per turn, mana payment to cast (auto-taps
              untapped lands), commander tax (+2 per prior cast), and
              library/GY/exile only via pending effects. When this is on, debug
              Grant mill / free Draw stay hidden. Turn off only to queue test
              effects.
            </span>
          </span>
        </label>
        <p className="mt-3 text-[11px] text-slate-500">
          Hit Save below to persist. Reload the table after changing if a game is
          already open.
        </p>
      </section>

      <section className="rounded-xl border border-cyan-500/20 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Phase Engine</h2>
        <p className="mt-2 text-xs text-slate-400">
          Real MTG rules (stack, priority, combat, SBAs) via Phase WASM. Open{' '}
          <Link className="text-cyan-300 underline" to="/engine">
            Engine
          </Link>{' '}
          in the nav to boot the engine, play legal-only vs AI, or run a headless
          goldfish. First boot downloads ~39&nbsp;MB WASM + ~96&nbsp;MB card data
          (cached after). Legacy Table stays available if WASM fails.
        </p>
        <p className="mt-2 text-[11px] text-slate-500">
          Docs: <code className="text-emerald-300">docs/PHASE_ENGINE.md</code>
        </p>
      </section>

      <form
        onSubmit={(e) => void onSave(e)}
        className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          OpenRouter API key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onFocus={() => {
              if (apiKey.startsWith('••')) setApiKey('')
            }}
            placeholder={hasKey ? 'Key saved — paste to replace' : 'sk-or-…'}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Model
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_OPENROUTER_MODEL}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
          />
          <span className="text-[11px] text-slate-500">
            Default:{' '}
            <code className="text-emerald-300">{DEFAULT_OPENROUTER_MODEL}</code>{' '}
            (cheap + solid). Any OpenRouter model id works.
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Save
          </button>
          {hasKey && (
            <button
              type="button"
              onClick={() => void onClearKey()}
              className="rounded-md px-4 py-2.5 text-sm text-rose-300 hover:bg-rose-950/40"
            >
              Clear API key
            </button>
          )}
          {saved && (
            <span className="self-center text-xs text-emerald-300">Saved.</span>
          )}
        </div>
      </form>

      <p className="text-xs text-slate-500">
        AI advice lives on the Decks / Builder pages. Without a key (or offline),
        you still get local heuristic tips (lands, curve, size).
      </p>
    </div>
  )
}
