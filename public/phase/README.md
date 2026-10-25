# Self-hosted Phase artifacts

Place build outputs here (gitignored binaries):

- `engine_wasm_bg.wasm`
- `engine_wasm.js` (also copied into `src/engine/phase/` by the build script)
- `card-data.json` (or `card-data-<hash>.json` named in manifest)
- `manifest.json` (written by `scripts/build-phase-engine.sh`)

Play prefers these over the CDN pin when the files exist. See `docs/ENGINE_FIDELITY.md`.

```bash
# From commander-lab:
./scripts/build-phase-engine.sh /workspace/phase release
```
