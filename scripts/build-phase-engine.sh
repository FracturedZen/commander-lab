#!/usr/bin/env bash
# Build Phase engine-wasm (+ optional card-data) and stage into commander-lab/public/phase/.
# Usage:
#   ./scripts/build-phase-engine.sh [PHASE_DIR] [PROFILE]
#     PHASE_DIR  default: ../phase or PHASE_DIR env
#     PROFILE    release | wasm-dev   (default: release)
#
# Does NOT commit large binaries. Writes public/phase/manifest.json with pin/hash.
# Glue JS is also copied to src/engine/phase/ so Vite imports match the WASM.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHASE_DIR="${1:-${PHASE_DIR:-$ROOT/../phase}}"
PROFILE="${2:-release}"
OUT="$ROOT/public/phase"
GLUE_DST="$ROOT/src/engine/phase"

if [[ ! -d "$PHASE_DIR" ]]; then
  echo "Phase checkout not found: $PHASE_DIR" >&2
  echo "Clone https://github.com/FracturedZen/phase (or phase-rs/phase) beside commander-lab." >&2
  exit 1
fi

PHASE_DIR="$(cd "$PHASE_DIR" && pwd)"
PHASE_SHA="$(git -C "$PHASE_DIR" rev-parse HEAD)"
PHASE_BRANCH="$(git -C "$PHASE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "==> Phase: $PHASE_DIR @ $PHASE_SHA ($PHASE_BRANCH)"
echo "==> Profile: $PROFILE"
echo "==> Out: $OUT"

mkdir -p "$OUT" "$GLUE_DST"

# --- WASM ---
echo "==> Building engine-wasm…"
(
  cd "$PHASE_DIR"
  # Prefer project toolchain pin
  if [[ -f rust-toolchain.toml ]]; then
    rustup show active-toolchain >/dev/null
  fi
  ./scripts/build-wasm.sh "$PROFILE"
)

WASM_SRC="$PHASE_DIR/client/src/wasm/engine_wasm_bg.wasm"
JS_SRC="$PHASE_DIR/client/src/wasm/engine_wasm.js"
DTS_SRC="$PHASE_DIR/client/src/wasm/engine_wasm.d.ts"

if [[ ! -f "$WASM_SRC" || ! -f "$JS_SRC" ]]; then
  echo "Missing WASM outputs under $PHASE_DIR/client/src/wasm/" >&2
  exit 1
fi

cp -f "$WASM_SRC" "$OUT/engine_wasm_bg.wasm"
cp -f "$JS_SRC" "$OUT/engine_wasm.js"
cp -f "$JS_SRC" "$GLUE_DST/engine_wasm.js"
# Keep public/engine glue in sync for older paths / worker probes
mkdir -p "$ROOT/public/engine"
cp -f "$JS_SRC" "$ROOT/public/engine/engine_wasm.js"
if [[ -f "$DTS_SRC" ]]; then
  cp -f "$DTS_SRC" "$GLUE_DST/engine_wasm.d.ts"
  cp -f "$DTS_SRC" "$ROOT/src/engine/phase-wasm.d.ts"
fi

WASM_SHA256="$(sha256sum "$OUT/engine_wasm_bg.wasm" | awk '{print $1}')"
WASM_BYTES="$(wc -c < "$OUT/engine_wasm_bg.wasm" | tr -d ' ')"

# --- Card data (optional if MTGJSON / AllPrintings absent) ---
CARD_FILE=""
CARD_HASH=""
CARD_BYTES=0
CARD_NOTE="skipped — run Phase ./scripts/gen-card-data.sh when AllPrintings is available"

if [[ -x "$PHASE_DIR/scripts/gen-card-data.sh" ]]; then
  # Look for an already-built card-data artifact first
  CANDIDATES=(
    "$PHASE_DIR/client/public/card-data.json"
    "$PHASE_DIR/data/card-data.json"
    "$PHASE_DIR/card-data.json"
  )
  shopt -s nullglob
  CANDIDATES+=("$PHASE_DIR"/card-data-*.json "$PHASE_DIR"/data/card-data-*.json "$PHASE_DIR"/client/public/card-data-*.json)
  shopt -u nullglob

  FOUND=""
  for c in "${CANDIDATES[@]}"; do
    if [[ -f "$c" ]]; then FOUND="$c"; break; fi
  done

  if [[ -z "$FOUND" ]]; then
    echo "==> No local card-data.json found; attempting gen-card-data.sh (may need AllPrintings)…"
    if (cd "$PHASE_DIR" && ./scripts/gen-card-data.sh); then
      for c in "${CANDIDATES[@]}"; do
        if [[ -f "$c" ]]; then FOUND="$c"; break; fi
      done
      # Also search fresh
      FOUND="$(find "$PHASE_DIR" -maxdepth 3 -name 'card-data*.json' -type f 2>/dev/null | head -1 || true)"
    else
      echo "warn: gen-card-data.sh failed — keeping CDN card-data pin at runtime" >&2
    fi
  fi

  if [[ -n "${FOUND:-}" && -f "$FOUND" ]]; then
    CARD_FILE="card-data.json"
    cp -f "$FOUND" "$OUT/$CARD_FILE"
    # Prefer filename hash if present (card-data-<16hex>.json); else sha256 short
    BASE="$(basename "$FOUND")"
    if [[ "$BASE" =~ card-data-([a-f0-9]{8,16})\.json ]]; then
      CARD_HASH="${BASH_REMATCH[1]}"
    else
      CARD_HASH="$(sha256sum "$OUT/$CARD_FILE" | awk '{print substr($1,1,16)}')"
    fi
    CARD_BYTES="$(wc -c < "$OUT/$CARD_FILE" | tr -d ' ')"
    CARD_NOTE="copied from $FOUND"
  fi
fi

# --- Manifest ---
python3 - "$OUT/manifest.json" << PY
import json, sys
path = sys.argv[1]
doc = {
  "source": "local Phase build (FracturedZen/phase or sibling checkout)",
  "preferLocal": True,
  "phaseRepo": "https://github.com/FracturedZen/phase",
  "phaseCommit": "$PHASE_SHA",
  "phaseBranch": "$PHASE_BRANCH",
  "profile": "$PROFILE",
  "builtAt": "$BUILT_AT",
  "wasmFile": "engine_wasm_bg.wasm",
  "wasmSha256": "$WASM_SHA256",
  "wasmBytes": int("$WASM_BYTES"),
  "cardDataFile": ("$CARD_FILE" or None),
  "cardDataHash": ("$CARD_HASH" or None),
  "cardDataBytes": int("$CARD_BYTES") if "$CARD_BYTES" != "0" else None,
  "cardDataNote": "$CARD_NOTE",
  "glueAlsoCopiedTo": ["src/engine/phase/engine_wasm.js", "public/engine/engine_wasm.js"],
  "note": "Commander Lab loaders prefer public/phase when wasm (+ card-data when hash set) exist; else PHASE_CDN pin.",
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
print("Wrote", path)
PY

# Sync public/engine/manifest hint
python3 - << PY
import json
from pathlib import Path
p = Path("$ROOT/public/engine/manifest.json")
doc = json.loads(p.read_text()) if p.exists() else {}
doc["localPhaseMirror"] = {
  "path": "public/phase/",
  "phaseCommit": "$PHASE_SHA",
  "preferLocal": True,
  "see": "docs/ENGINE_FIDELITY.md",
}
p.write_text(json.dumps(doc, indent=2) + "\n")
print("Updated", p)
PY

echo "==> Done."
echo "    WASM: $OUT/engine_wasm_bg.wasm ($WASM_BYTES bytes)"
if [[ -n "$CARD_FILE" ]]; then
  echo "    Card-data: $OUT/$CARD_FILE hash=$CARD_HASH ($CARD_BYTES bytes)"
else
  echo "    Card-data: (none staged — runtime uses CDN pin)"
fi
echo "    Manifest: $OUT/manifest.json"
echo
echo "CI notes:"
echo "  - Cache cargo + Phase target/; pin nightly-2026-04-19 + wasm-bindgen 0.2.121"
echo "  - Do not commit *.wasm / card-data.json (see .gitignore)"
echo "  - Optional: upload artifacts to GH Releases / object storage; Pages may exceed size limits"
echo "  - After build, npm run build && deploy as usual; hard-refresh /engine"
