/**
 * Phase engine Web Worker — owns WASM + card DB off the UI thread.
 * Message protocol (request/response with id):
 *   { id, type: 'boot' }
 *   { id, type: 'startGame', decks, seed, playerCount, firstPlayer }
 *   { id, type: 'getState', viewerId }
 *   { id, type: 'getLegalActions', viewerId }
 *   { id, type: 'submitAction', actor, action }
 *   { id, type: 'aiProposal', playerId, difficulty }
 *   { id, type: 'pass', actor }
 *
 * Note: dynamic import of glue uses absolute URL passed from main thread.
 */
let wasm = null
let formatConfig = null

function reply(id, payload) {
  self.postMessage({ id, ...payload })
}

function unwrapInit(raw) {
  if (raw && typeof raw === 'object' && 'status' in raw) {
    const r = raw
    if (r.status === 'error' || r.status === 'rejected' || r.status === 'occupied') {
      throw new Error(r.error || (r.reasons && r.reasons.join('; ')) || r.status)
    }
    return r.result ?? raw
  }
  return raw
}

self.onmessage = async (ev) => {
  const msg = ev.data || {}
  const { id, type } = msg
  try {
    if (type === 'boot') {
      const glueUrl = msg.glueUrl
      const wasmUrl = msg.wasmUrl
      const cardDataText = msg.cardDataText
      if (!glueUrl || !wasmUrl || !cardDataText) throw new Error('boot requires glueUrl, wasmUrl, cardDataText')
      wasm = await import(glueUrl)
      await wasm.default({ module_or_path: wasmUrl })
      wasm.load_card_database(cardDataText)
      const registry = wasm.getFormatRegistry()
      const commander = registry.find((f) => f.format === 'Commander')
      if (!commander) throw new Error('Commander format missing')
      formatConfig = commander.default_config
      reply(id, { ok: true, type: 'boot' })
      return
    }
    if (!wasm || !formatConfig) throw new Error('Worker not booted')

    if (type === 'startGame') {
      wasm.clear_game_state()
      const raw = wasm.initialize_game(
        msg.decks,
        msg.seed ?? 1,
        formatConfig,
        msg.matchConfig ?? { match_type: 'Bo1' },
        msg.playerCount ?? 2,
        msg.firstPlayer ?? 0,
      )
      reply(id, { ok: true, type: 'startGame', result: unwrapInit(raw) })
      return
    }
    if (type === 'getState') {
      reply(id, { ok: true, type: 'getState', result: wasm.get_filtered_game_state(msg.viewerId ?? 0) })
      return
    }
    if (type === 'getLegalActions') {
      reply(id, {
        ok: true,
        type: 'getLegalActions',
        result: wasm.get_legal_actions_for_viewer_js(msg.viewerId ?? 0),
      })
      return
    }
    if (type === 'submitAction') {
      const raw = wasm.submit_action(msg.actor ?? 0, msg.action)
      reply(id, { ok: true, type: 'submitAction', result: raw })
      return
    }
    if (type === 'pass') {
      const raw = wasm.submit_action(msg.actor ?? 0, { type: 'PassPriority' })
      reply(id, { ok: true, type: 'pass', result: raw })
      return
    }
    if (type === 'aiProposal') {
      const raw = wasm.get_ai_action_proposal(msg.difficulty || 'Medium', msg.playerId ?? 1)
      reply(id, { ok: true, type: 'aiProposal', result: raw })
      return
    }
    throw new Error(`Unknown worker message type: ${type}`)
  } catch (err) {
    reply(id, { ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
