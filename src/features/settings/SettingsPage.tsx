import { useEffect, useState, type FormEvent } from 'react'
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

  useEffect(() => {
    void (async () => {
      const k = await getSetting<string>(SETTINGS_KEYS.openRouterApiKey)
      const m = await getSetting<string>(SETTINGS_KEYS.openRouterModel)
      setHasKey(Boolean(k))
      setApiKey(k ? '••••••••••••' : '')
      if (m) setModel(m)
    })()
  }, [])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (apiKey && !apiKey.startsWith('••')) {
      await setSetting(SETTINGS_KEYS.openRouterApiKey, apiKey.trim())
      setHasKey(true)
      setApiKey('••••••••••••')
    }
    await setSetting(SETTINGS_KEYS.openRouterModel, model.trim() || DEFAULT_OPENROUTER_MODEL)
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
            Default: <code className="text-emerald-300">{DEFAULT_OPENROUTER_MODEL}</code> (cheap + solid).
            Any OpenRouter model id works.
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
        AI advice lives on the Decks / Builder pages. Without a key (or offline), you still get
        local heuristic tips (lands, curve, size).
      </p>
    </div>
  )
}
