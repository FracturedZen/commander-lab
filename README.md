# Commander Lab

Offline-first **Commander (EDH)** digital tabletop, deck builder, bulk testing, and AI coaching app.

**v0.4.1** — Strict zone moves: library/GY/exile need queued effects; auto-draw + plain-English Stats unchanged.

**v0.4.0** — Strict MTG draw/turn rules (auto-draw on draw step), plain-English Stats, pendingDraws hook, decked loss.

Web-first PWA (React + TypeScript) for PC browsers and Android.

Phone / GitHub Pages build:
```bash
npm run build -- --base=/commander-lab/
```

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19 + TypeScript |
| Build | Vite 8 |
| Styles | Tailwind CSS 4 |
| Routing | `react-router-dom` |
| Offline / PWA | `vite-plugin-pwa` |
| Local DB | IndexedDB via `idb` |
| Card data | Scryfall `oracle_cards` bulk → IndexedDB |
| AI | OpenRouter (API key stored locally) |

## Quick start

```bash
cd /workspace/commander-lab
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server + HMR |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Serve production build |
| `npm run lint` | Oxlint |

## Features

### Cards (Scryfall sync)
1. Open **Cards** → **Sync cards** (needs network once; ~25&nbsp;MB gzipped JSONL).
2. App decompresses in-browser and indexes trimmed fields into IndexedDB (chunked writes).
3. Progress: catalog → download → decompress/index; failures show the real error string.
4. Local fuzzy name search works offline afterward.
5. Art uses Scryfall CDN when online; name/text fallback offline.
6. **Starter decks work without sync** (stub card names until you sync).

### Deck builder & imports
- **Builder**: search synced cards, set commander/partner, quantities, CI filter, legality badge (100 cards, singleton except basics, color identity).
- **Import**: paste MTGO / Arena / Moxfield / Archidekt / Mana Box style text (`1 Card Name`, `COMMANDER: …`).
- Optional Moxfield URL fetch — if CORS blocks, paste the export instead (never blocks the app).
- **Decks**: list / delete / advise / open in builder.

### Tabletop
- Felt-style digital table with spatial zones (hand bottom, battlefield center, piles around).
- **Start game** flow: pick 1–4 seats + decks → deal 7 → commanders in command zone.
- **Automatic turns:** End turn rotates hotseat, untaps permanents, draws 1; Next phase walks the phase wheel.
- Turn banner always shows active player + phase.
- Large tappable life totals + commander damage matrix.
- Drag-and-drop **or** tap-to-move; tap battlefield card → Tap/Untap.
- Bundled starters: **Krenko, Mob Boss** and **Aesi, Tyrant of Gyre Strait**.
- Save / restore session; custom background blob; local AI step heuristic.

### Stats
- Hypergeometric draw odds.
- Goldfish / Monte Carlo opening hands (avg lands, keep rate, mana curve).

### AI advice
- **Settings**: save OpenRouter API key + model (default `openai/gpt-4o-mini`).
- **Advise** on Decks / Builder: structured deck prompt → OpenRouter.
- Offline / no-key fallback: local heuristic tips (lands, curve, size).

## Folder structure

```
src/
├── app/                 # Shell + router
├── components/          # Header, zones, card chip, search
├── data/                # Placeholders, Scryfall notes, sample-decks/
├── features/
│   ├── tabletop/        # Play table
│   ├── decks/           # Deck list
│   ├── builder/         # Builder + import + advise
│   ├── cards/           # Scryfall sync UI
│   ├── stats/           # Hypergeo + goldfish
│   └── settings/        # OpenRouter key
├── lib/
│   ├── storage/         # IndexedDB
│   ├── scryfall/        # Sync + search
│   ├── deck/            # Legality + import
│   ├── stats/           # Math + goldfish
│   └── ai/              # OpenRouter + heuristic opponent
└── types/
```

## Design principles

1. **Offline-first** — after card sync, play / build / test without network.
2. **Commander-only** — 40 life, command zone, commander damage.
3. **Local data** — decks, settings, sessions, card DB on-device.

## Notes

- First Scryfall sync is large; document that in the Cards UI.
- Respect Scryfall: bulk download once, no per-card hammering.
- Never commit API keys.
