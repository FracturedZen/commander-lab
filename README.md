# Commander Lab

Offline-first **Commander (EDH)** digital tabletop, deck builder, bulk testing, and AI coaching app.

**v0.5.1** — Arena-inspired table UX (cyan activatable glow, phase rail, hand fan, card detail, stack stub) + full card art (one printing per `oracle_id`).

**v0.4.2** — Arena-style cyan glow on cards with a legal action now (play / tap / effect target).

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

### Table zone rules (Arena-style)
Zone moves always go through `checkZoneMove` — sandbox only shows debug **Grant** buttons, it does not unlock free library/GY/exile cheats. Auto draw-step draws still work. See `src/lib/rules/moveLegality.ts` for the from→to matrix; run `npm run test:rules`.



### Cards (Scryfall sync)
1. Open **Cards** → **Sync cards** (needs network once; ~25&nbsp;MB gzipped JSONL).
2. App decompresses in-browser and indexes trimmed fields into IndexedDB (chunked writes).
3. Progress: catalog → download → decompress/index; failures show the real error string.
4. Local fuzzy name search works offline afterward.
5. Art: Scryfall `normal`/`large` (DFC front face); **one art per `oracle_id`** (reprints collapsed; prefer non-digital + newest).
6. Images lazy-load from CDN when online; card-shaped name fallback offline. Re-sync after upgrade to refresh oracle keys.
7. **Starter decks work without sync** (stub names until you sync — then real art resolves).

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
- Drag-and-drop to move; **tap a card to read** (full art + oracle); overlay has Select for move / Tap·Untap.
- Bundled starters: **Krenko, Mob Boss** and **Aesi, Tyrant of Gyre Strait**.
- Save / restore session; custom background blob; local AI step heuristic.


## Inspired by MTG Arena (adopted vs deferred)

**Adopted in v0.5.1**
- Soft cyan/white **glow** on cards with a legal action right now (playable hand, castable commander, untapped permanents as tap stand-in, pending-effect targets).
- **Phase rail** (Beg / Main / Combat / Main / End) with orange “your turn” / blue opponent styling cues.
- **Hand fan** bottom dock with overlap + lift on hover/select.
- **Full card preview** on long-press, context menu, or **i** (Scryfall normal/large art + oracle text).
- **Stack chrome stub** listing queued `pendingActions` (mill/discard/etc.).
- Full **card images** on table zones (lazy-loaded CDN URLs; text fallback offline).

**Deferred**
- Real stack / priority / Full Control / phase stops.
- Combat attacker/blocker arrows and declaration UI.
- True activated-ability parsing from Oracle text.
- Prefetching every card image at sync time (we keep URL refs + browser cache).
- Digital-arena 3D table / emotes.

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
