# Phase rules engine (Commander Lab)

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
        + CDN WASM (~39 MB) + card-data (~96 MB, IndexedDB cache)
```

- **UI only submits engine-legal actions** (`get_legal_actions_for_viewer_js` → `submit_action`).
- Legacy table (`/`) keeps our lighter zone/mana rules for offline sandboxes; **Engine** nav (`/engine`) is Phase-backed.
- Feature default: `ENGINE_MODE_DEFAULT = 'phase'` (`src/engine/config.ts`). If WASM boot fails, Engine page shows a banner and Legacy table remains usable.

## Runtime assets (not in git)

Too large for GitHub Pages / git:

| Asset | Size | Source |
|-------|------|--------|
| `engine_wasm_bg-*.wasm` | ~39 MB | `https://data.phase-rs.dev/staging/wasm/…` |
| `card-data-*.json` | ~96 MB | **Pinned** `card-data-b238f3af63cb27cf.json` (matches WASM `fa2a9156…` / preview client). Do **not** blindly follow `card-data-meta.json` — it can advance ahead of the WASM and fail to parse. |
| Glue JS | ~25 KB | Vendored: `public/engine/engine_wasm.js` |

Manifest: `public/engine/manifest.json`.

First boot downloads WASM + pinned card-data; card-data is stored in IndexedDB (`commander-lab-phase`). Service worker CacheFirst caches the WASM binary after first fetch.

Headless goldfish uses 100-card basic-land stubs (Krenko Mountains vs Aesi Islands/Forests) so Commander legality always passes. Lab sample decks are sanitized (strip known bans / off-identity lands, pad basics) before `initialize_game`.

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
| `PhaseAdapter.ts` | boot, load DB, startGame, legal, submit, AI, driveOpponents |
| `loadPhaseWasm.ts` | glue + WASM instantiate |
| `cardDataCache.ts` | meta fetch + IndexedDB |
| `deckMap.ts` | Lab decks → Phase name-only `DeckList` |
| `headlessGoldfish.ts` | N-step AI vs AI without UI |
| `phaseStateView.ts` | ClientGameState → Arena board view + art hydrate |
| `engineInteraction.ts` | Targeting / combat / mana / discard / mode helpers (display-only) |
| `config.ts` | `ENGINE_MODE`, CDN URLs |
| `phase-worker.js` | optional Web Worker protocol (public/) |
| `../features/engine/EngineBoard.tsx` | Arena board (stack rail, targeting, combat declare + AssignCombat/BlockerDamage, life/poison/cmd-dmg chrome, mana, phyrexian/X/assist, scry/search/triggers/replacement/pay-amount, crew/equip/saddle/station, optional/unless costs, TargetSelection step, optional-effect/tribute, pair/copy/damage-source, discard/mode, mulligan, glow → submit) |

## How to play (v0.6.7+)

1. Open https://fracturedzen.github.io/commander-lab/engine (or local `/engine`).
2. **Boot Phase** (first time: ~39 MB WASM + ~96 MB card-data).
3. Pick two decks (samples install automatically) → **Start vs AI**.
4. Arena-style board reflects Phase zones (hand fan, BF art chips, lands, command, life). **Cyan** = legal; **rose** = targets / discard / zone / Phyrexian; **orange** = combat / OrderTriggers; **amber** = mana pay / pool pin / PayAmount; **fuchsia** = Choose X; **teal** = Assist; **cyan** = Scry/Surveil; **indigo** = reorder (Ripple/DigRest/Planar); **emerald** = Search/Dig/Reveal/zone pick; **lime** = ReplacementChoice. **Pay:** Auto | Manual | Sac-safe stamps `payment_mode` on casts (Phase APIs only). Manual / Sac-safe → `ManaPayment` / `ManaSourceSelection` with board glow + Confirm / CancelCast. **SpendPoolMana / UnspendPoolMana** pin UI from `mana_pool` + `pinned_pool_units`. **PhyrexianPayment** per-shard Mana/Life toggles → `SubmitPhyrexianChoices`. **ChooseXValue** → `ChooseX`. **AssistChoosePlayer** / **AssistPayment** → `ChooseAssistPlayer` / `CommitAssistPayment`. **ScryChoice** / **SurveilChoice** keep-on-top → `SelectCards`. **RippleBottomOrder** / **RevealUntilBottomOrder** / **DigRestSplitChoice** / **ArrangePlanarDeckTopChoice** reorder → `SelectCards`. **SearchChoice** / **SearchPartitionChoice** / **DigChoice** / **RevealChoice** / **ChooseFromZoneChoice** subset pick → `SelectCards`. **OrderTriggers** → `OrderTriggers {order}`. **ReplacementChoice** → `ChooseReplacement` / `ChooseReplacementAndRemember` (Phase candidates only). **PayAmountChoice** → `SubmitPayAmount`. **CrewVehicle/SaddleMount** board multi-select (sum Phase `contributions`) → `CrewVehicle`/`SaddleMount`. **EquipTarget/StationTarget** single glow-pick → `Equip`/`ActivateStation`. **OptionalCostChoice** Pay/Don't → `DecideOptionalCost`. **UnlessPayment** / **UnlessPaymentChooseCost** → `PayUnlessCost` / `ChooseUnlessCostBranch`. **TargetSelection/TriggerTargetSelection** slot step (object glow + player buttons, optional Skip) → `ChooseTarget`. **MultiTargetSelection** → `SelectCards`. **OptionalEffectChoice/OpponentMayChoice/TributeChoice** → `DecideOptionalEffect`. **PairChoice/CopyTargetChoice/DamageSourceChoice** glow-pick (+ Skip when Phase allows) → `ChoosePair`/`ChooseTarget`/`ChooseDamageSource`. Discard / mode / EffectZoneChoice glow+confirm. Multi-target attack picker. Mulligan banner. **Stack rail** (right) from `derived.stack_display_groups` + `stack_entry_details` — names/art when hydratable, **Top** highlight. **AssignCombatDamage** / **AssignBlockerDamage** board glow + amount steppers / as-though-unblocked (Phase modes only). Seat chrome: life + **poison** + **commander damage** from Phase player / `derived.commander_damage_by_attacker`. **Pass** / Confirm FAB. Rail **stops** from real `waiting_for` (display-only). **Show all actions** fallback. `objectNames` map labels off-board library picks.
5. No free DnD on this page — only engine-legal submits.
6. **Headless goldfish** runs stub basics decks with Phase Medium AI until turn/step limit.

## Headless / AI

Prefer Phase built-in AI (`get_ai_action_proposal`, difficulty `Medium`) before OpenRouter. OpenRouter remains in Settings for future LLM coach / probe hooks Phase already exposes — not required for goldfish.

## Limits & next work

- Targeting wizard matches Phase legal CastSpell target combinations (prefix filter); does not invent targets.
- Combat: 2p attacks with optional AttackTarget picker; blocker pairs from `waiting_for`; **AssignCombatDamage** / **AssignBlockerDamage** when Phase opens those WaitingFor kinds (lethal hints + trample/controller steppers; no invented splits). **Banding** still submits empty `bands` — Phase does not expose band candidates; leave stubbed.
- Stack visibility from Phase `derived.stack_display_groups` / `stack_entry_details` only.
- Board UX covers Scry/Surveil, Ripple/RevealUntil/DigRest/ArrangePlanar, Search(+partition)/Dig/Reveal/ChooseFromZone, OrderTriggers, ReplacementChoice, PayAmountChoice, **CrewVehicle/SaddleMount** (Phase `contributions` sum), **EquipTarget/StationTarget**, **OptionalCostChoice**, **UnlessPayment** / **UnlessPaymentChooseCost**, **TargetSelection/TriggerTargetSelection** (`ChooseTarget` via `selection.current_legal_targets`), **MultiTargetSelection**, **OptionalEffectChoice/OpponentMayChoice/TributeChoice**, **PairChoice/CopyTargetChoice/DamageSourceChoice** from Phase `waiting_for` shapes only — never invents options. Remaining rarer WaitingFor (vote / draft / empty-candidate, **Banding**) still fall through to **Show all actions**.
- Phase rail stops are display-only (derived from WaitingFor); they do not gate Pass or invent phase authority.
- Lazy-load / compress card-data further; optional Worker boot path.
- Vendor WASM only if Pages bandwidth allows; document hash in `manifest.json` on upgrade.
- Local `build-wasm.sh` may take a long time on the box; CDN path is the supported deploy path.

## License

Phase: Apache-2.0 / MIT (see Phase `LICENSE-*`). Commander Lab remains separately licensed; we load Phase as a binary dependency at runtime.
