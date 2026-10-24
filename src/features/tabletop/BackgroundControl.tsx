import { useRef } from 'react'

type BackgroundControlProps = {
  backgroundUrl: string | null
  onChange: (fileOrUrl: File | string | null) => void
}

export function BackgroundControl({
  backgroundUrl,
  onChange,
}: BackgroundControlProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          onChange(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="min-h-10 rounded-md bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 ring-1 ring-slate-600 hover:bg-slate-700"
      >
        Upload background
      </button>
      {backgroundUrl && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-md px-3 py-2 text-xs text-slate-400 hover:text-rose-300"
        >
          Clear
        </button>
      )}
      <span className="text-[11px] text-slate-500">Saved in IndexedDB</span>
    </div>
  )
}
