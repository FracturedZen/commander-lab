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
  const apiKey = await getSetting<string>(SETTINGS_KEYS.openRouterApiKey)
  const model =
    (await getSetting<string>(SETTINGS_KEYS.openRouterModel)) ||
    DEFAULT_OPENROUTER_MODEL

  if (!apiKey) {
    return {
      source: 'local',
      text:
        'No OpenRouter API key saved. Local heuristic tips:\n\n' +
        tips.map((t) => `• ${t}`).join('\n'),
    }
  }

  if (!navigator.onLine) {
    return {
      source: 'local',
      text:
        'Offline — OpenRouter unavailable. Local tips:\n\n' +
        tips.map((t) => `• ${t}`).join('\n'),
    }
  }

  const prompt = `You are an experienced Magic: The Gathering Commander (EDH) coach.
Give concise, actionable advice (bullet points) on this deck: mana base, curve, interaction, wincons, and easy upgrades.
Stay within Commander rules. Do not invent banned cards.

${deckSummary(deck)}

Local heuristics already noted:
${tips.map((t) => `- ${t}`).join('\n')}
`

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
          {
            role: 'system',
            content: 'You are a helpful Commander format coach. Be concise.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 900,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        source: 'local',
        model,
        error: `OpenRouter HTTP ${res.status}`,
        text:
          `OpenRouter error (${res.status}). Falling back to local tips.\n${body.slice(0, 200)}\n\n` +
          tips.map((t) => `• ${t}`).join('\n'),
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
        text: 'Empty model response. Local tips:\n\n' + tips.map((t) => `• ${t}`).join('\n'),
      }
    }
    return { source: 'openrouter', model, text }
  } catch (e) {
    return {
      source: 'local',
      model,
      error: e instanceof Error ? e.message : 'Network error',
      text:
        'Could not reach OpenRouter. Local tips:\n\n' +
        tips.map((t) => `• ${t}`).join('\n'),
    }
  }
}
