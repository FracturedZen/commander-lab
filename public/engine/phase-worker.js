/**
 * Phase boot Web Worker — fetch + WebAssembly.compile off the UI thread.
 *
 * Full game authority stays on the main-thread PhaseAdapter (sync submit /
 * legal / AI drive). Wasm-bindgen glue binds imports to the instantiating
 * realm, so we only offload download+compile here and post the Module back.
 *
 * Protocol:
 *   → { id, type: 'compileWasm', wasmUrl }
 *   ← { id, type: 'progress', stage, message, bytesReceived?, bytesTotal?, fraction? }
 *   ← { id, type: 'compileWasm', ok: true, module: WebAssembly.Module }
 *   ← { id, ok: false, error }
 *   → { id, type: 'ping' } → { id, ok: true, type: 'ping' }
 */
function reply(id, payload) {
  self.postMessage({ id, ...payload })
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

async function fetchBytes(url, onBytes) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + url)
  const lenHeader = res.headers.get('content-length')
  const totalNum = lenHeader ? Number(lenHeader) : null
  const total = totalNum && Number.isFinite(totalNum) && totalNum > 0 ? totalNum : null

  if (!res.body) {
    const buf = await res.arrayBuffer()
    onBytes(buf.byteLength, buf.byteLength)
    return buf
  }

  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.byteLength
      onBytes(received, total)
    }
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  onBytes(received, total ?? received)
  return out.buffer
}

self.onmessage = async (ev) => {
  const msg = ev.data || {}
  const { id, type } = msg
  try {
    if (type === 'ping') {
      reply(id, { ok: true, type: 'ping' })
      return
    }
    if (type === 'compileWasm') {
      const wasmUrl = msg.wasmUrl
      if (!wasmUrl) throw new Error('compileWasm requires wasmUrl')
      reply(id, {
        type: 'progress',
        stage: 'wasm',
        message: 'Worker downloading WASM…',
        bytesReceived: 0,
        bytesTotal: null,
        fraction: 0,
      })
      const bytes = await fetchBytes(wasmUrl, (received, total) => {
        const frac = total && total > 0 ? Math.min(1, received / total) : received > 0 ? 0.5 : 0
        reply(id, {
          type: 'progress',
          stage: 'wasm',
          message:
            total && total > 0
              ? 'Worker downloading WASM… ' + formatBytes(received) + ' / ' + formatBytes(total)
              : 'Worker downloading WASM… ' + formatBytes(received),
          bytesReceived: received,
          bytesTotal: total,
          fraction: frac,
        })
      })
      reply(id, {
        type: 'progress',
        stage: 'init',
        message: 'Worker compiling WASM…',
        bytesReceived: bytes.byteLength,
        bytesTotal: bytes.byteLength,
        fraction: 0,
      })
      const module = await WebAssembly.compile(bytes)
      reply(id, {
        type: 'progress',
        stage: 'init',
        message: 'WASM module compiled in worker',
        fraction: 1,
      })
      // WebAssembly.Module is structured-cloneable
      reply(id, { ok: true, type: 'compileWasm', module })
      return
    }
    throw new Error('Unknown worker message type: ' + type)
  } catch (err) {
    reply(id, { ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
