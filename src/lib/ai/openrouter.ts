import {
  DEFAULT_OPENROUTER_MODEL,
  SETTINGS_KEYS,
  getSetting,
} from '@/lib/storage/settings'
import { localDeckTips } from '@/lib/stats/goldfish'
import { validateCommanderDeck } from '@/lib/deck/legality'
import type { Deck } from '@/types/deck'

export type AdviceResult = {
  source: 'openrouter' | 'local'
  text: string
  model?: string
  error?: string
}

async function resolveOpenRouterAuth(): Promise<{
  apiKey: string | undefined
  model: string
}> {
  const apiKey = await getSetting<string>(SETTINGS_KEYS.openRouterApiKey)
  const model =
    (await getSetting<string>(SETTINGS_KEYS.openRouterModel)) ||
    DEFAULT_OPENROUTER_MODEL
  return { apiKey, model }
}

async function openRouterChat(opts: {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}): Promise<AdviceResult> {
  const { apiKey, model } = await resolveOpenRouterAuth()

  if (!apiKey) {
    return {
      source: 'local',
      error: 'no-key',
      text: '',
    }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      source: 'local',
      model,
      error: 'offline',
      text: '',
    }
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof location !== 'undefined' ? location.origin : '',
        'X-Title': 'Commander Lab',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 900,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        source: 'local',
        model,
        error: `OpenRouter HTTP ${res.status}`,
        text: body.slice(0, 240),
      }
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) {
      return {
        source: 'local',
        model,
        error: 'empty',
        text: '',
      }
    }
    return { source: 'openrouter', model, text }
  } catch (e) {
    return {
      source: 'local',
      model,
      error: e instanceof Error ? e.message : 'Network error',
      text: '',
    }
  }
}

function deckSummary(deck: Deck): string {
  const validity = validateCommanderDeck(deck)
  const lines: string[] = [
    `Deck: ${deck.name}`,
    `Commander: ${deck.commander?.name ?? '(none)'}`,
    deck.partner ? `Partner: ${deck.partner.name}` : '',
    `Size: ${validity.totalCards}/100`,
    `Issues: ${validity.issues.length ? validity.issues.join('; ') : 'none'}`,
    '',
    'Maindeck:',
  ]
  for (const c of deck.cards) {
    const q = c.quantity ?? 1
    lines.push(`${q} ${c.name}`)
  }
  if (deck.commander) lines.push(`1 ${deck.commander.name} (commander)`)
  return lines.filter(Boolean).join('\n')
}

export async function adviseDeck(deck: Deck): Promise<AdviceResult> {
  const tips = localDeckTips(deck)
  const localBlock = tips.map((t) => `• ${t}`).join('\n')

  const result = await openRouterChat({
    system: 'You are a helpful Commander format coach. Be concise.',
    user: `You are an experienced Magic: The Gathering Commander (EDH) coach.
Give concise, actionable advice (bullet points) on this deck: mana base, curve, interaction, wincons, and easy upgrades.
Stay within Commander rules. Do not invent banned cards.

${deckSummary(deck)}

Local heuristics already noted:
${tips.map((t) => `- ${t}`).join('\n')}
`,
    maxTokens: 900,
  })

  if (result.source === 'openrouter') return result

  if (result.error === 'no-key') {
    return {
      source: 'local',
      text:
        'No OpenRouter API key saved. Local heuristic tips:\n\n' + localBlock,
    }
  }
  if (result.error === 'offline') {
    return {
      source: 'local',
      model: result.model,
      text: 'Offline — OpenRouter unavailable. Local tips:\n\n' + localBlock,
    }
  }
  return {
    source: 'local',
    model: result.model,
    error: result.error,
    text:
      (result.error
        ? `OpenRouter error (${result.error}). Falling back to local tips.\n${result.text ? result.text + '\n\n' : ''}`
        : 'Could not reach OpenRouter. Local tips:\n\n') + localBlock,
  }
}

/** Short local heuristics from a compact Engine board summary string. */
export function localEnginePlayTips(summary: string): string[] {
  const tips: string[] = []
  const lower = summary.toLowerCase()
  if (lower.includes('legal: pass') || lower.includes('\n- pass')) {
    tips.push('Pass is legal — only pass if you are done developing / responding.')
  }
  if (lower.includes('stack top:') || lower.includes('stack (1') || /stack \(\d+\)/.test(lower)) {
    tips.push('Something is on the stack — check whether you can / should respond before Pass.')
  }
  if (lower.includes('waiting:')) {
    tips.push('Phase is waiting on a choice — finish that wizard (targets / combat / mana) before freestyle plays.')
  }
  if (lower.includes('your hand:') || lower.includes('hand (you)')) {
    tips.push('Prioritize land drops early; look for on-curve spells and interaction.')
  }
  if (tips.length === 0) {
    tips.push('Scan life totals, your hand, and glowing legal cards; tap a glow to act — advice never auto-submits.')
  }
  tips.push('Advice is informational only — confirm every action via the board glow / Pass dock.')
  return tips
}

/**
 * In-game coach advice for Engine play. Reuses Settings OpenRouter key/model.
 * Never submits Phase actions — caller shows text only.
 */
export async function adviseEnginePlay(boardSummary: string): Promise<AdviceResult> {
  const tips = localEnginePlayTips(boardSummary)
  const localBlock = tips.map((t) => `• ${t}`).join('\n')

  const result = await openRouterChat({
    system:
      'You are a concise Magic: The Gathering Commander coach watching a live game. ' +
      'Give short, actionable advice (3–6 bullets). Name concrete cards/actions when possible. ' +
      'Never claim you submitted a game action. Do not invent cards not listed. Stay within Commander rules.',
    user: `Live Commander table (compact Phase snapshot). Suggest what seat 0 (You) should consider next.
Do NOT invent legal actions beyond the listed labels — Phase is sole rules authority.

${boardSummary}

Remind the player they must confirm plays on the board (glow / Pass); you only advise.`,
    maxTokens: 420,
    temperature: 0.5,
  })

  if (result.source === 'openrouter') return result

  if (result.error === 'no-key') {
    return {
      source: 'local',
      error: 'no-key',
      text:
        'No OpenRouter API key in Settings. Local tips:\n\n' +
        localBlock +
        '\n\nAdd a key under Settings → OpenRouter to get live coach advice.',
    }
  }
  if (result.error === 'offline') {
    return {
      source: 'local',
      model: result.model,
      error: 'offline',
      text: 'Offline — OpenRouter unavailable. Local tips:\n\n' + localBlock,
    }
  }
  return {
    source: 'local',
    model: result.model,
    error: result.error,
    text:
      `Coach unavailable (${result.error ?? 'network'}). Local tips:\n\n` + localBlock,
  }
}
