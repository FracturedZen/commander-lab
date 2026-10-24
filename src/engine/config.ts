/** Engine mode: Phase WASM is the rules authority when available. */
export type EngineMode = 'phase' | 'legacy'

export const ENGINE_MODE_DEFAULT: EngineMode = 'phase'

export const ENGINE_SETTINGS_KEY = 'engineMode'

/** Phase CDN + local glue paths (see public/engine/manifest.json). */
export const PHASE_CDN = {
  metaUrl: 'https://data.phase-rs.dev/staging/card-data-meta.json',
  wasmUrl:
    'https://data.phase-rs.dev/staging/wasm/engine_wasm_bg-fa2a9156e8e62943.wasm',
  /** Relative to Vite base; also hardcoded inside engine_wasm.js as fallback. */
  gluePath: 'engine/engine_wasm.js',
  manifestPath: 'engine/manifest.json',
  /** Pinned to match WASM fa2a9156… (preview client); meta.json can drift. */
  cardDataUrl:
    'https://data.phase-rs.dev/staging/card-data-b238f3af63cb27cf.json',
  cardDataHash: 'b238f3af63cb27cf',
} as const

export const PHASE_AI_DIFFICULTY = 'Medium' as const
