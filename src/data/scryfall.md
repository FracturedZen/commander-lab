# Scryfall integration

- UI: **Cards** → Sync cards.
- Catalog: `GET https://api.scryfall.com/bulk-data`
- Prefer `oracle_cards`; fall back to `default_cards`.
- **2026+ format:** Scryfall ships `jsonl_download_uri` (`.jsonl.gz`) only — no legacy `download_uri` JSON array.
- Client: fetch gzip → `DecompressionStream` → parse JSONL line-by-line → IndexedDB batches of ~80.
- Service worker: **NetworkOnly** for `api.scryfall.com` / `*.scryfall.io` (never cache bulk).
- Images: CDN URLs when online.
