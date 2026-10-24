import type { CardRef } from '@/types/card'

const ARCHETYPES = [
  'Sol Ring',
  'Arcane Signet',
  'Command Tower',
  'Cultivate',
  'Rampant Growth',
  'Swords to Plowshares',
  'Counterspell',
  'Beast Within',
  'Rhystic Study',
  'Smothering Tithe',
  'Cyclonic Rift',
  'Demonic Tutor',
  'Eternal Witness',
  'Lightning Greaves',
  'Swiftfoot Boots',
  'Reliquary Tower',
  'Exotic Orchard',
  'Path of Ancestry',
  'Farseek',
  'Kodama\'s Reach',
]

/** Build a deterministic mock 100-card Commander library for local play stubs. */
export function createPlaceholderLibrary(
  commanderName = 'Placeholder Commander',
): CardRef[] {
  const cards: CardRef[] = [
    {
      id: 'cmd-placeholder',
      name: commanderName,
      typeLine: 'Legendary Creature — Avatar',
      manaCost: '{2}{G}{U}',
      isCommander: true,
    },
  ]

  for (let i = 1; i < 100; i++) {
    const base = ARCHETYPES[i % ARCHETYPES.length]
    cards.push({
      id: `ph-${i.toString().padStart(3, '0')}`,
      name: `${base} #${i}`,
      typeLine: i % 7 === 0 ? 'Land' : 'Artifact',
      manaCost: i % 7 === 0 ? undefined : `{${(i % 5) + 1}}`,
    })
  }

  return cards
}

export function createPlaceholderDeckCards(): CardRef[] {
  return createPlaceholderLibrary().filter((c) => !c.isCommander)
}
