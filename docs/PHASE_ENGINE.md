# Phase rules engine (Commander Lab)

Fidelity / fork roadmap: **[ENGINE_FIDELITY.md](./ENGINE_FIDELITY.md)** (Arena bar, FracturedZen/phase, local `public/phase` builds, coverage path). Do not claim Arena parity.

## Decision

**Rules authority for engine mode:** [Phase](https://github.com/phase-rs/phase) (`phase-rs/phase`, Apache-2.0 / MIT).

| Option | Why not first embed |
|--------|---------------------|
| **Phase** (chosen) | Rust→WASM, ~93% Commander coverage, stack/priority/combat/SBAs, built-in AI, React WasmAdapter pattern, preview at https://preview.phase-rs.dev/ |
| Manabrew / Forge | Heavier Graal/Forge WASM stack; harder PWA footprint |
| Open Gathering | TypeScript but only code-mapped cards — not full oracle |

YGOPro works because every Yu-Gi-Oh card is scripted. MTG has no single drop-in JS equivalent; Phase is the closest embeddable full rules core for a browser Commander lab.

## Architecture

```
Commander Lab shell (decks, Scryfall sync, stats, Arena-ish UI)
        │
        ▼
src/engine/PhaseAdapter  ←── rules authority when ENGINE_MODE=phase
        │
        ▼
public/engine/engine_wasm.js (vendored glue)
        + prefer public/phase/ WASM+card-data when built (fork)
        + else CDN WASM (~39 MB) + card-data (~96 MB, IndexedDB cache)
```

Local rebuild: `./scripts/build-phase-engine.sh [../phase] [release|wasm-dev]` → stages `public/phase/` + updates glue. See ENGINE_FIDELITY.md.

- **UI only submits engine-legal actions** (`get_legal_actions_for_viewer_js` → client `assertActionSubmittable` gate → `submit_action`). Phase WASM remains the final rejector.
- Legacy table (`/` · nav **Legacy**) keeps lighter zone/mana rules for offline sandboxes; **Play** nav (`/engine`) is the Phase-backed real play path.
- Feature default: `ENGINE_MODE_DEFAULT = 'phase'` (`src/engine/config.ts`). If WASM boot fails, Engine page shows a banner and Legacy table remains usable.

## Runtime assets (not in git)

Too large for GitHub Pages / git:

| Asset | Size | Source |
|-------|------|--------|
| `engine_wasm_bg-*.wasm` | ~39 MB | `https://data.phase-rs.dev/staging/wasm/…` |
| `card-data-*.json` | ~96 MB | **Pinned** `card-data-b238f3af63cb27cf.json` (matches WASM `fa2a9156…` / preview client). Do **not** blindly follow `card-data-meta.json` — it can advance ahead of the WASM and fail to parse. |
| Glue JS | ~25 KB | Vendored: `public/engine/engine_wasm.js` |

Manifest: `public/engine/manifest.json`.

First boot downloads WASM + pinned card-data (card-data CDN is already brotli ~7 MB on the wire). Card-data is stored in IndexedDB (`commander-lab-phase`) as ArrayBuffer (new) or legacy text; Service worker CacheFirst caches WASM. Boot prefers Worker download+compile; instantiate + UTF-8 assemble + `load_card_database` stay on the main thread (with yields around the sync hitch).

Headless goldfish defaults to 100-card basic-land stubs (Krenko / Aesi / Selvala / Purphoros — one per seat up to 4) so Commander legality always passes; Engine setup can pass IndexedDB decks instead. Lab sample decks are sanitized (strip known bans / off-identity lands, pad basics) before `initialize_game`.

## Local Phase clone / build (optional)

Clone sibling (preferred):

```bash
cd /workspace
git clone https://github.com/phase-rs/phase.git
cd phase
```

Toolchain (as of Phase scripts):

```bash
# rustup + nightly pinned by Phase (see scripts/build-wasm.sh)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
rustup toolchain install nightly-2026-04-19
rustup target add wasm32-unknown-unknown --toolchain nightly-2026-04-19
cargo install wasm-bindgen-cli --version 0.2.121 --locked
```

Generate card data + WASM:

```bash
# From Phase repo — names vary slightly by commit; prefer their scripts:
./scripts/gen-card-data.sh          # if present
./scripts/build-wasm.sh wasm-dev    # debug/dev profile (do not pass bare "debug")
# or: ./scripts/build-wasm.sh release
```

Outputs land under Phase `target/` / `client` dist; copy into Commander Lab only if you want offline vendoring:

```bash
mkdir -p /workspace/commander-lab/public/engine
cp path/to/engine_wasm_bg.wasm /workspace/commander-lab/public/engine/
# Update src/engine/config.ts PHASE_CDN.wasmUrl to local /engine/… if vendoring
```

**Spike note:** Commander Lab ships against the **staging CDN** prebuilts so GH Pages stays under size limits. A local `wasm-dev` compile may run in parallel for verification; it is not required to play.

## Adapter API (`src/engine/`)

| File | Role |
|------|------|
| `PhaseAdapter.ts` | boot, load DB, startGame, legal, submit (gated), AI, driveOpponents |
| `assertLegalSubmit.ts` | Client gate: pool match (payment_mode-tolerant) or WaitingFor allowlist or Concede |
| `loadPhaseWasm.ts` | glue + WASM instantiate |
| `cardDataCache.ts` | meta fetch + IndexedDB |
| `deckMap.ts` | Lab decks → Phase name-only `DeckList` (`toPhaseDeckList` 1v1; `toPhaseMultiDeckList` 2–4) |
| `goldfishDecks.ts` | Basics stubs for 2–4 seats (`goldfishStubDecksForCount`) + `sanitizePhasePlayer` |
| `headlessGoldfish.ts` | N-step AI vs AI without UI; optional IndexedDB decks + `playerCount` |
| `phaseStateView.ts` | ClientGameState → Arena board view + art hydrate |
| `engineInteraction.ts` | Targeting / combat / mana / discard / mode helpers (display-only) |
| `phaseGameLog.ts` | ActionResult `log_entries` / events → compact UI lines; mana pool aggregates; Concede builder |
| `boardAdviceSummary.ts` | Compact live-board text for OpenRouter coach |
| `engineSave.ts` | IDB mid-game Phase snapshot + deck picks |
| `coachGlow.ts` | Match coach text → legal object ids / action types |
| `config.ts` | `ENGINE_MODE`, CDN URLs |
| `phase-worker.js` | Boot Worker: fetch + `WebAssembly.compile` off main; posts Module + progress |
| `../features/engine/EngineBoard.tsx` | Arena board + phone sticky action dock (WaitingFor banners + Pass); multi-seat opponent chrome; stack rail, targeting, combat, mana chrome, ActivateAbility, priority banner, command cast+spellCosts, Concede/Rematch |

## How to play (v0.7.9+)

1. Open https://fracturedzen.github.io/commander-lab/engine (or local `/engine`).
2. **Boot Phase** — staged progress (glue → WASM download/compile → instantiate → card-data download/decode/cache → Phase `load_card_database` → ready). **Worker boot** (v0.7.4): `phase-worker.js` fetch + `WebAssembly.compile` off main; main instantiates/binds. **Card-data soft boot** (v0.7.5): CDN already serves **brotli ~7.1 MB** (decoded ~95 MB); chunked UTF-8 decode with `requestIdleCallback` / `scheduler.yield` between 2 MiB slices; IDB stores ArrayBuffer for new downloads (legacy text blobs still count as cached); clear “UI may pause” stage before sync `load_card_database` (cannot split — Phase JSON string API only). No card-data split (Phase has no chunked load). **Cached** badge + “Already cached — instant boot” when SW WASM + IDB card-data warm. **Retry boot** on failure. Start also boots automatically.
3. **Seats** 2p / 3p / 4p (clamped to Phase `FormatConfig.min_players`/`max_players`). Human stays seat 0; every other seat is Phase AI. Per-seat deck selects list IndexedDB decks (builder, imports, precons/samples) with commander + size labels. Refresh / Manage decks / Builder links included. **Basics stub** is an explicit fallback. Seat count + picks persist in localStorage. → **Start Np table** (boots Phase if needed). DeckList: `player` + `opponent` + `ai_decks` for seats 2+ (`ai_difficulties` one per non-human seat).
4. Arena-style board reflects Phase zones (hand fan, BF art chips, lands, command, life). **Cyan** = legal; **rose** = targets / discard / zone / Phyrexian; **orange** = combat / OrderTriggers; **amber** = mana pay / pool pin / PayAmount; **fuchsia** = Choose X; **teal** = Assist; **cyan** = Scry/Surveil; **indigo** = reorder (Ripple/DigRest/Planar); **emerald** = Search/Dig/Reveal/zone pick; **lime** = ReplacementChoice. **Pay:** Auto | Manual | Sac-safe stamps `payment_mode` on casts (Phase APIs only). Manual / Sac-safe → `ManaPayment` / `ManaSourceSelection` with board glow + Confirm / CancelCast. **SpendPoolMana / UnspendPoolMana** pin UI from `mana_pool` + `pinned_pool_units`. **PhyrexianPayment** per-shard Mana/Life toggles → `SubmitPhyrexianChoices`. **ChooseXValue** → `ChooseX`. **AssistChoosePlayer** / **AssistPayment** → `ChooseAssistPlayer` / `CommitAssistPayment`. **ScryChoice** / **SurveilChoice** keep-on-top → `SelectCards`. **RippleBottomOrder** / **RevealUntilBottomOrder** / **DigRestSplitChoice** / **ArrangePlanarDeckTopChoice** reorder → `SelectCards`. **SearchChoice** / **SearchPartitionChoice** / **DigChoice** / **RevealChoice** / **ChooseFromZoneChoice** subset pick → `SelectCards`. **OrderTriggers** → `OrderTriggers {order}`. **ReplacementChoice** → `ChooseReplacement` / `ChooseReplacementAndRemember` (Phase candidates only). **PayAmountChoice** → `SubmitPayAmount`. **CrewVehicle/SaddleMount** board multi-select (sum Phase `contributions`) → `CrewVehicle`/`SaddleMount`. **EquipTarget/StationTarget** single glow-pick → `Equip`/`ActivateStation`. **OptionalCostChoice** Pay/Don't → `DecideOptionalCost`. **UnlessPayment** / **UnlessPaymentChooseCost** → `PayUnlessCost` / `ChooseUnlessCostBranch`. **TargetSelection/TriggerTargetSelection** slot step (object glow + player buttons, optional Skip) → `ChooseTarget`. **MultiTargetSelection** → `SelectCards`. **OptionalEffectChoice/OpponentMayChoice/TributeChoice** → `DecideOptionalEffect`. **PairChoice/CopyTargetChoice/DamageSourceChoice** glow-pick (+ Skip when Phase allows) → `ChoosePair`/`ChooseTarget`/`ChooseDamageSource`. **ActivateAbility** board glow → submit with `payment_mode` (same ManaPayment / TargetSelection / OptionalCost WaitingFor as casts; no invented costs). **Priority banner** when you hold priority with stack or legal responses (Pass vs hold). **Command zone** chips show Phase `spellCosts` (tax/reductions) + **Cast** badge when `CastSpell` is legal. Discard / mode / EffectZoneChoice glow+confirm. Multi-target attack picker. Mulligan banner. **Stack rail** (right) from `derived.stack_display_groups` + `stack_entry_details` — names/art when hydratable, **Top** highlight. **AssignCombatDamage** / **AssignBlockerDamage** board glow + amount steppers / as-though-unblocked (Phase modes only). Seat chrome: life + **poison** + **commander damage** from Phase player / `derived.commander_damage_by_attacker`. **Pass** sticky bottom dock on phone (banners/wizards scroll above Pass; desktop keeps top banners + FAB). Rail **stops** from real `waiting_for` (display-only). **Show all actions** fallback. `objectNames` map labels off-board library picks.
5. No free DnD on this page — only engine-legal submits.
6. **Headless goldfish** drives every seat with Phase Medium AI until turn/step limit. Uses the same IndexedDB / stub deck picks + seat count as the setup panel (falls back to Krenko/Aesi/… basics stubs).
7. **Game log** (collapsible) merges Phase `log_entries` from each ActionResult; falls back to summarizing `events` when entries are absent. Phone-friendly; auto-scrolls when open.
8. **Mana pool** chrome always shows seat 0 `mana_pool` (color pips + counts) on the board and sticky dock — not only during payment.
9. **Concede** submits Phase `Concede { player_id }` then clears table back to setup. **Rematch** reuses the last deck list via `startGame` (no Boot dance when WASM is already ready).
10. **Save / Resume** (v0.7.7): in-game **Save** calls Phase `export_game_state_json` and stores the opaque snapshot plus deck picks + `playerCount` + card-data hash in IndexedDB (`engineSaves` / slot `midgame`). Setup **Resume** boots if needed, `set_multiplayer_mode(false)`, `restore_game_state`, then `resume_restored_game_state`, then syncs the board. Hash mismatch vs `PHASE_CDN.cardDataHash` blocks resume. Single-player only (Phase refuses restore in MP). Clear save from setup. Coach never auto-submits.
11. **Coach → glow** (v0.7.7): after advice, lines that mention current legal card names / action types become tappable matches; tap focuses a violet **advice** glow on matching objects — still never auto-submits.


## Headless / AI

Prefer Phase built-in AI (`get_ai_action_proposal`, difficulty `Medium`) for driving opponent seats / goldfish. **OpenRouter coach** (v0.7.6+): Engine **Coach advice** button uses the same Settings → OpenRouter API key + model (`SETTINGS_KEYS.openRouterApiKey` / `openRouterModel`); sends a compact board summary (life, seats, hand names, BF, stack top, waiting_for, legal action labels) and shows a phone-friendly drawer. **v0.7.7:** matched lines → tappable violet board glow (legal objects only); never auto-submits — human confirms via glow / Pass. No key / offline → local tips + Settings link. Not required for goldfish.

## Limits & next work

- Targeting wizard matches Phase legal CastSpell target combinations (prefix filter); does not invent targets.
- Combat: **multi-opponent DeclareAttackers** — when Phase lists multiple `AttackTarget`s (players / planeswalkers / battles), each attacker must pick an explicit Phase-legal target (banner buttons, seat chrome, or PW/Battle chip). No silent “always seat 1” default; single-target still auto-assigns. Blockers show attacker name + controller seat. **AssignCombatDamage** / **AssignBlockerDamage** when Phase opens those WaitingFor kinds (lethal hints + trample/controller steppers; no invented splits). **Banding** still submits empty `bands` — Phase does not expose band candidates; leave stubbed.
- Stack visibility from Phase `derived.stack_display_groups` / `stack_entry_details` only.
- Board UX covers Scry/Surveil, Ripple/RevealUntil/DigRest/ArrangePlanar, Search(+partition)/Dig/Reveal/ChooseFromZone, OrderTriggers, ReplacementChoice, PayAmountChoice, **CrewVehicle/SaddleMount** (Phase `contributions` sum), **EquipTarget/StationTarget**, **OptionalCostChoice**, **UnlessPayment** / **UnlessPaymentChooseCost**, **TargetSelection/TriggerTargetSelection** (`ChooseTarget` via `selection.current_legal_targets`), **MultiTargetSelection**, **OptionalEffectChoice/OpponentMayChoice/TributeChoice**, **PairChoice/CopyTargetChoice/DamageSourceChoice** from Phase `waiting_for` shapes only — never invents options. ActivateAbility reuses cast payment/target/optional WaitingFor wizards (Phase lists only). Command-zone cast uses Phase `spellCosts` + legal `CastSpell` glow — no client tax math. Remaining rarer WaitingFor (vote / draft / empty-candidate, **Banding**) still fall through to **Show all actions**.
- Phase rail stops are display-only (derived from WaitingFor); they do not gate Pass or invent phase authority.
- Engine boot picks decks from IndexedDB (v0.6.9+); stub only when chosen.
- Game log / mana chrome / Concede+Rematch (v0.7.0): Phase-authored only; rematch keeps deck picks without re-Boot when ready.
- Multi-seat Commander (v0.7.1): 2–4 seats via Phase `initialize_game` player_count; board chrome for every opponent (life / poison / cmd dmg / hand count); AI-thinking banner while `driveOpponents` runs. Vote / draft / banding still stubbed (Show all actions / empty bands).
- Multi-opponent attack targeting + 4p phone layout (v0.7.2): per-attacker AttackTarget from Phase only; opponents horizontal-scroll compact row on narrow screens (Pass dock / hand stay reachable).
- WASM boot UX + Play nav (v0.7.3): real boot stages / byte progress / Retry; nav **Play** → `/engine` (Phase rules); **Legacy** → `/` sandbox; home Legacy Table CTA points at Engine.
- Worker boot + multi-seat seat math (v0.7.4): compile-in-Worker path with main instantiate; cache-instant UX; `playerCountFromDeckList` / empty `ai_decks` on 2p stubs so rematch no longer inflates 2→3; null-seat guards on board view.
- Soft card-data boot (v0.7.5): chunked decode + idle yields; IDB ArrayBuffer; painted warning before sync `load_card_database`. Wire already br (~7 MB); Phase accepts only JSON string — no gzip-to-WASM / no cheap split.
- OpenRouter Engine coach (v0.7.6): Coach advice drawer; Settings key reuse; compact summary; no auto-submit.
- Mid-game Save/Resume + Coach→glow (v0.7.7): Phase `export_game_state_json` / `restore_game_state` / `resume_restored_game_state` → IDB with deck picks + playerCount; setup Resume; coach line matches focus violet glow (no auto-submit).
- Legal submit gate (v0.7.8): every human `submitAction` must match `get_legal_actions*` (cast/activate ignore `payment_mode`) or a WaitingFor response type for the current `waiting_for`, or Concede. Phase AI proposals may `skipLegalGate` (WASM still rejects). Coach never submits. Show all = `flatActions` only. `npm run test:legal-submit`.
- Prefer-local Phase (v0.7.9): loader prefers `public/phase` WASM + card-data when present (`scripts/build-phase-engine.sh`); else pinned CDN. Fork fidelity roadmap: ENGINE_FIDELITY.md. First fork win: prenominal exiled/face-up (#10281) on FracturedZen/phase `c96a124`.
- Full game-in-worker / off-main `load_card_database` still blocked. Vote / draft / banding still stubbed.
- Vendor WASM only if Pages bandwidth allows; document hash in `manifest.json` on upgrade.
- Local `build-wasm.sh` may take a long time on the box; CDN path is the supported deploy path.

## License

Phase: Apache-2.0 / MIT (see Phase `LICENSE-*`). Commander Lab remains separately licensed; we load Phase as a binary dependency at runtime.
