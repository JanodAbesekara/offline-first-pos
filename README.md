# Offline-First Boutique POS (`ATELIER // POS`)

Built with **Next.js (PWA) + Dexie.js (IndexedDB) + Supabase (Postgres)**. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical design, database schema, conflict resolution, cost estimate, and scalability plan.

## Key Features

- **100% Offline-First Execution:** Custom Service Worker (`public/sw.js`) caches the app shell and static chunks; IndexedDB (`Dexie`) stores products, variants, sales, returns, stock movements, and the sync outbox locally.
- **Fast Boutique Checkout (< 10s):** Auto-focused barcode/SKU scanner (`/` or `F2` shortcut), category filters, quick-add apparel cards with color swatches & size pills, percentage/fixed discounts, manager PIN (`1234`) guardrail for discounts > 20%, 10% GST calculation, Cash quick-tender chips (`Exact`, `$20`, `$50`, `$100`, `+$10`) with live change due, and Card terminal mode.
- **Product & Variant Catalog:** Pre-seeded with clothing variants (including `Summer Tee — Navy — L — TEE-NV-L — $25.00 — Qty: 12` and `Linen Shirt — Black — M — LIN-BK-M — $45.00 — Qty: 1` to test negative `-1` oversell reconciliation), plus UI to add new variants and adjust/receive stock.
- **Offline Returns & Voids:** Look up past receipts offline, process full or item-level partial returns with reason tracking and optional stock restoration, and queue idempotent `RETURN` events.
- **Resilient Outbox Sync Inspector:** Live `Online / Offline · N Unsynced` status pill and dedicated **Sync Queue** tab showing chronological events, idempotency keys (`event_id`), and JSON payloads.
- **Thermal Digital Receipt & Print:** Clean receipt modal with `window.print()` support (`@media print` forces black-on-white thermal formatting regardless of active theme).
- **Light & Dark Themes:** Toggle between **Light (Atelier Ivory)** and **Dark (Midnight Velvet)** themes in the header (`localStorage` persisted).

## Run Locally

```bash
npm install
cp .env.example .env.local   # Optional: add Supabase URL + anon key for cloud sync
npm run build && npm start   # Production build (required to test Service Worker offline caching)
```

Open `http://localhost:3000` once while online so the Service Worker caches the app shell and JS chunks, then switch **DevTools → Network → Offline** and reload.

## Supabase Setup (Optional for Cloud Sync)

Run `supabase/schema.sql` in your Supabase SQL Editor. It creates `products`, `variants`, `sales`, `sale_items`, `returns`, `return_items`, `stock_movements`, `stock_alerts`, `processed_events`, and the idempotent `apply_event(jsonb)` RPC function. Without env vars, the app works fully offline and queues all transactions locally in IndexedDB.

## Deploy (Vercel / Cloudflare Pages)

1. Initialize Git (`git init && git add . && git commit -m "Initial POS MVP"`) and push to a public GitHub repository.
2. Import the repository in **Vercel** (or **Cloudflare Pages**).
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in project environment variables (optional for offline-only demo).
4. Deploy.

## Demo Flow

1. **Fast Scan & Checkout:** Type `TEE-NV-L` (or `9300000000003`) + `Enter`, apply a discount, select Cash → `$50`, click **Complete Sale**, and test **Print Receipt**.
2. **Offline Mode:** Set DevTools Network to **Offline** and reload the page — the app loads cleanly and the badge shows `Offline`.
3. **Oversell (`-1`) Scenario:** Sell 2 units of `LIN-BK-M` (starts at Qty `1`) while offline. Checkout succeeds without blocking the customer, and a **Negative Stock Alert** appears in **Catalog & Stock** for reconciliation.
4. **Offline Return:** Open **Receipts & Returns**, select a receipt, click **Return / Void**, and confirm partial or full return — local stock updates immediately and queues a `RETURN` event in **Sync Queue**.
5. **Reconnect & Sync:** Re-enable network connectivity; pending events push chronologically to Supabase (`apply_event`).

## Production Roadmap Notes

- Add Supabase Auth + Row-Level Security (RLS) policies per store/cashier before multi-user production rollout.
- Add incremental catalog pull-sync (`updated_at > last_pull`) when multiple terminals edit prices centrally.
