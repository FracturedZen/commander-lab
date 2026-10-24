import { PHASE_CDN } from './config'
import type { PhaseWasmModule } from './types'

let cached: PhaseWasmModule | null = null
let loadPromise: Promise<PhaseWasmModule> | null = null

/**
 * Load Phase engine-wasm glue (code-split) and instantiate WASM (CDN or local).
 * Safe to call multiple times — returns the same module.
 */
export async function loadPhaseWasm(
  onProgress?: (msg: string) => void,
): Promise<PhaseWasmModule> {
  if (cached) return cached
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    onProgress?.('Loading Phase WASM glue…')
    const mod = (await import('./phase/engine_wasm.js')) as unknown as PhaseWasmModule
    onProgress?.('Fetching Phase WASM binary (~39 MB)…')
    const localWasm = `${import.meta.env.BASE_URL}engine/engine_wasm_bg.wasm`
    let wasmUrl: string = PHASE_CDN.wasmUrl
    try {
      const probe = await fetch(localWasm, { method: 'HEAD' })
      if (probe.ok) wasmUrl = new URL(localWasm, window.location.origin).href
    } catch {
      /* use CDN */
    }
    await mod.default({ module_or_path: wasmUrl })
    onProgress?.('WASM ready')
    cached = mod
    return mod
  })()

  try {
    return await loadPromise
  } catch (err) {
    loadPromise = null
    throw err
  }
}

export function getCachedPhaseWasm(): PhaseWasmModule | null {
  return cached
}
