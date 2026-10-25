# Engine fidelity roadmap (Arena bar)

Commander Lab’s **rules authority** is [Phase](https://github.com/phase-rs/phase) (Apache-2.0 / MIT). We are **not** greenfielding a new MTG rules engine. We **are** forking and improving Phase so Play approaches Arena-like card behavior as closely as open-source work allows.

Companion doc: [PHASE_ENGINE.md](./PHASE_ENGINE.md) (boot, adapter, legal-submit gate, UX coverage).

## The bar (honest)

| Claim | Status |
|-------|--------|
| “Good enough CDN Phase” | **Rejected** as a product goal |
| Arena-near: legal moves only, stack/priority/combat/SBAs, most Commander cards work | **Target** — continuous improvement |
| Arena parity / “mostly flawless / 100% of every card forever” | **Not claimed.** Arena is closed + years of Wizards QA. Open engines publish coverage badges; gaps remain |

Practical “as close to 100% as we can”:

1. Drive **Commander legal-card coverage** toward Phase’s own badge ceiling, then past it via patches we contribute upstream when possible.
2. Zero **illegal submits** from our UI (already gated — see `assertLegalSubmit.ts`).
3. Close **high-ROI misparses** (wrong targets, missed triggers, empty filters) that break real EDH decks.
4. Never invent rules in TypeScript that Phase did not authorize.

Upstream badges (live): [https://data.phase-rs.dev/badges/](https://data.phase-rs.dev/badges/) — historically ~88% cards / ~93% Commander. Those numbers move as Phase lands fixes; our fork tracks and extends them.

## Why fork Phase (not Forge / not a new Rust engine)

- Phase is already **WASM-embeddable** and wired into Commander Lab Play.
- Forge is strong for desktop bots but a poor PWA embed (size, Graal/JVM path).
- Card JSON (MTGJSON / Scryfall) is **oracle text + metadata**, not Comprehensive Rules + interaction encoding. Dumping every card does **not** create Arena fidelity by itself.
- Phase already builds its rules DB from MTGJSON-shaped data; the gap is **parser + semantics**, which Phase’s AI-CONTRIBUTOR ladder is designed to close.

## Strategy

```
phase-rs/phase (upstream)
        │  track / PR when Gate A/B clean
        ▼
FracturedZen/phase (our fork)  ←── continuous fidelity patches
        │  scripts/build-phase-engine.sh
        ▼
commander-lab public/phase/   (optional self-hosted WASM + card-data)
        │  prefer local → else CDN pin
        ▼
Play (/engine) + legal-submit gate
```

1. **Fork** (`FracturedZen/phase`) — land fidelity commits here first; open upstream PRs when they meet [AI-CONTRIBUTOR.md](https://github.com/phase-rs/phase/blob/main/docs/AI-CONTRIBUTOR.md) Frontier gates.
2. **Build pipeline** — `scripts/build-phase-engine.sh` builds `engine-wasm` + card-data from a Phase checkout and copies artifacts into `public/phase/` (gitignored binaries; manifest + README committed).
3. **Loader prefer-local** — `loadPhaseWasm` / `cardDataCache` prefer `public/phase/*` when present; otherwise keep the pinned CDN pair in `src/engine/config.ts`.
4. **Measure** — Phase coverage badges + `parser-misparse-backlog.md` root causes + local `cargo test` on touched parser tests; Lab `npm run test:legal-submit` stays green.
5. **Ship** — Lab version bumps when Play/boot changes; Phase fidelity commits live on the fork (and upstream PRs when ready).

## Patch workflow (AI-CONTRIBUTOR ladder)

Prefer this order (from Phase `docs/AI-CONTRIBUTOR.md` + `docs/parser-misparse-backlog.md`):

1. Pick a **root-cause** misparse (many cards) or a high-visibility EDH bug issue.
2. Add a **failing unit test** that pins the expected `TargetFilter` / effect IR.
3. Fix with **combinator-pure** grammar changes (Gate A) and **Anchored** CR cites (Gate B) when required.
4. Run focused `cargo test -p phase-engine …` then broader gates before upstream PR.
5. Mirror the commit on `FracturedZen/phase`; Lab only needs a rebuild when we want the fix in Play without waiting for CDN.

First Lab-tracked fidelity win (fork): **prenominal “exiled” / “face-up” type-phrase prefixes** (Phase issue [#10281](https://github.com/phase-rs/phase/issues/10281) — Pull from Eternity, Riftsweeper, Runic Repetition, Blade of the Swarm). Previously those targets collapsed to empty `Typed {}` so legal targets looked like players.

**Landed on `FracturedZen/phase` branch `fix/prenominal-exiled-card-10281` (`c96a124`):** `parse_combat_status_prefix` emits `InZone{Exile}` / `Not{FaceDown}`; `parse_keyword_match` treats `warp` as `KeywordKind::Warp` (parameterized like flashback). Verified with `cargo test -p phase-engine --test prenominal_exiled_10281` (4/4). In-crate unit tests added beside the same root cause (full `--lib` suite needs more RAM than this box). Rebuild Play WASM via `scripts/build-phase-engine.sh` when you want the fix offline without waiting for upstream CDN.

## What we will not do

- Claim Arena parity in marketing or UI copy.
- Disable or weaken the **legal-submit gate**.
- Hand-author a parallel rules engine in TS/Rust “from card JSON.”
- Force-push `phase-rs/phase`.

## Pin / hash

| Source | Where recorded |
|--------|----------------|
| CDN WASM + card-data (default Pages) | `src/engine/config.ts` `PHASE_CDN`, `public/engine/manifest.json` |
| Local / fork build | `public/phase/manifest.json` (written by build script; includes Phase git SHA + card-data hash) |

When both exist, **local `public/phase` wins**.

## Path forward (coverage)

1. Keep closing misparse backlog root causes on the fork; PR upstream clean ones.
2. Rebuild + optionally host `public/phase` artifacts for Lab (or GH Releases / R2) when Pages size allows — otherwise keep CDN fallback.
3. Track Commander coverage badge deltas after each rebuild.
4. File/fix remaining WaitingFor UX only when Phase exposes candidates (banding, vote, draft).

Updated: 2026-10-25
