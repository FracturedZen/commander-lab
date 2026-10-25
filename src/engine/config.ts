/** Engine mode: Phase WASM is the rules authority when available. */
export type EngineMode = 'phase' | 'legacy'

export const ENGINE_MODE_DEFAULT: EngineMode = 'phase'

export const ENGINE_SETTINGS_KEY = 'engineMode'

/**
 * Self-hosted / fork build under public/phase/ (see scripts/build-phase-engine.sh).
 * When wasm (+ optional card-data) exist, loaders prefer these over PHASE_CDN.
 */
export const PHASE_LOCAL = {
  manifestPath: 'phase/manifest.json',
  wasmPath: 'phase/engine_wasm_bg.wasm',
  cardDataPath: 'phase/card-data.json',
  gluePath: 'phase/engine_wasm.js',
} as const

/** Phase CDN + vendored glue paths (see public/engine/manifest.json). */
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

/** Shape written by scripts/build-phase-engine.sh into public/phase/manifest.json */
export type PhaseLocalManifest = {
  preferLocal?: boolean
  phaseCommit?: string
  phaseBranch?: string
  profile?: string
  builtAt?: string
  wasmFile?: string
  wasmSha256?: string
  cardDataFile?: string | null
  cardDataHash?: string | null
  note?: string
  source?: string
}
