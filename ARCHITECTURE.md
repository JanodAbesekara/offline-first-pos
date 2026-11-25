# Offline-First Boutique POS: Architecture

Stack: **Next.js (PWA) + Dexie.js (IndexedDB) + Supabase (Postgres)**, deployed on Vercel/Cloudflare Pages.

---

## 1. Tech Stack & Offline Sync Engine

### Why these choices

| Layer         | Choice                     | Reason                                                                                                                            |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| UI            | Next.js + React + CSS Vars | Runs in any browser/tablet (non-Windows), light & dark themes, easy deploy                                                        |
| Offline shell | Custom Service Worker      | Cache-first for `/_next/static/` chunks and network-first with `/` shell fallback so reloads work 100% offline                    |
| Local storage | **Dexie.js on IndexedDB**  | Indexed lookups on SKU/barcode in ms, handles 4,000+ variants, live queries, no WASM or browser quirks                            |
| Cloud DB      | **Supabase Postgres**      | Real relational constraints, unique keys, atomic SQL functions (RPC), built-in auth/RLS, generous free tier, daily backups on Pro |

SQLite-WASM, RxDB and PouchDB were considered: more moving parts than a 2-terminal shop needs.

### Sync architecture (outbox pattern)

1. **Every write is local first.** Checkout writes one Dexie transaction: `sales` + `stock_movements` + an `outbox` row (and deducts `variants.stock`). Local stock is updated instantly, so the UI never waits for the network.
2. **Client-generated identity.** Each sale gets a client-generated UUID (`crypto.randomUUID()` locally; UUIDv7 in production for time-sorted B-tree indexes) and a human receipt number (`T1-20261124-0001`: terminal + date + local counter) at creation time. IDs never depend on the server.
3. **Outbox queue.** Rows are `{seq, type: SALE|RETURN, event_id, payload, created_at, status: pending|sent, attempts, last_error}`, ordered by `seq` (chronological push).
4. **Sync worker** runs on `online` event, on app start, after checkout/return, and on a 30 s timer. It sends events one at a time, in order, to a Postgres RPC `apply_event(p jsonb)`.
5. **Zero duplicate receipts** (defence in depth):
   - `processed_events(event_id PK)`, `sales.id` (PK), and `sales.receipt_no` (`UNIQUE`) prevent double-processing.
   - `apply_event` runs `INSERT INTO processed_events(event_id) VALUES (e) ON CONFLICT DO NOTHING; IF NOT FOUND THEN RETURN 'duplicate'; END IF;` before touching `sales` or `variants`, so retrying is always safe.
   - The outbox row is only marked `sent` after the server acknowledges. If the browser refreshes or the connection drops mid-sync, the row stays `pending` and is re-sent safely.
   - The whole RPC runs in one Postgres transaction: sale, items, stock movements, and alerts all commit atomically or roll back together.
6. **Pull side.** After pushing, terminals can pull catalog/price updates (`updated_at > last_pull`) and reconciled stock snapshots into Dexie.

### Conflict resolution: stock hits -1

Principle: **a completed, paid sale is a fact and is never rejected.**

- Stock is **not** a number that gets overwritten. It is derived from an append-only `stock_movements` ledger (`SALE -1`, `RETURN +1`, `RECEIVE +n`, `ADJUST ±n`). `variants.stock_qty` is a cached sum updated atomically (`stock_qty = stock_qty + delta`), never `SET stock_qty = <client value>`, so concurrent terminals cannot overwrite each other.
- Two terminals each sell the last Medium/Black Linen Shirt offline. Both sales sync, both receipts are stored, and stock becomes `1 - 1 - 1 = -1`. There is **no CHECK (stock_qty >= 0)** constraint.
- A trigger flags the variant (`needs_reconciliation = true`) and inserts a row in `stock_alerts`. The owner's dashboard shows "Oversold: Linen Shirt M/Black (-1)" so someone can check for a missed supplier scan or unlogged return, then post an `ADJUST` movement. Nothing the customer holds is affected.

---

## 2. Database Schema (Postgres; Dexie mirrors the same tables)

```sql
products        (id uuid pk, name, brand, category, description, active, created_at, updated_at)
variants        (id uuid pk, product_id fk, sku unique, barcode unique, size, color,
                 price_cents int, cost_cents int, store_id fk, stock_qty int,   -- may go negative
                 needs_reconciliation bool, updated_at)
stores          (id uuid pk, name, tax_rate_bps int, currency)
terminals       (id uuid pk, store_id fk, name)
sales           (id uuid pk,              -- client UUIDv7 = idempotency key
                 receipt_no text unique, store_id fk, terminal_id fk, cashier_id,
                 customer_id fk null, subtotal_cents, discount_cents, tax_cents, total_cents,
                 status text check (status in ('COMPLETED','VOIDED','PARTIAL_RETURN','RETURNED')),
                 created_at (device time), synced_at (server time))
sale_items      (id uuid pk, sale_id fk, variant_id fk, qty, unit_price_cents,
                 discount_cents, tax_cents, line_total_cents)
payments        (id uuid pk, sale_id fk, method check in ('CASH','CARD'),
                 amount_cents, tendered_cents, change_cents)
returns         (id uuid pk, sale_id fk, reason, refund_method, refund_cents, created_at)
return_items    (id uuid pk, return_id fk, sale_item_id fk, qty, restock bool)
stock_movements (id uuid pk, variant_id fk, store_id fk, delta int,
                 type check in ('SALE','RETURN','RECEIVE','ADJUST'), ref_id uuid, created_at)
stock_alerts    (id uuid pk, variant_id fk, stock_qty, created_at, resolved bool)
customers       (id uuid pk, name, phone unique, email, loyalty_points int)   -- future
promotions      (id uuid pk, type, rules jsonb, starts_at, ends_at, active)   -- future
```

Notes: money is stored as integer cents (no float errors); `variants` is the sellable unit, `products` is only the parent grouping; `sale_items` stores the price at time of sale so later price changes never alter old receipts; indexes on `variants(sku)`, `variants(barcode)`, `sales(created_at)`.

Returns work offline: look up the receipt in Dexie, create `returns` + `return_items`, insert a `+qty RETURN` movement locally, queue a `RETURN` outbox event; the server validates `qty <= sold - already_returned`.

---

## 3. Deployment & Monthly Cost (1 store, 2 terminals, ~4,000 variants)

Data size: 4,000 variants + sales is far below 100 MB/year; the catalog sync is a few hundred KB.

| Line item                             | Service                                        | Monthly (USD)               |
| ------------------------------------- | ---------------------------------------------- | --------------------------- |
| Frontend hosting + CDN (PWA)          | Cloudflare Pages / Vercel (free tier)          | $0                          |
| Backend + Postgres (8 GB, no pausing) | Supabase Pro                                   | $25                         |
| Bandwidth                             | Included (catalog is tiny; sync is delta-only) | $0                          |
| Automated daily backups               | Included with Supabase Pro (daily)             | $0                          |
| Domain (optional)                     | Registrar, ~$12/year                           | ~$1 (optional)              |
| **Total**                             |                                                | **$25** (≈ $0 for the demo) |

**$0 path (demo / very tight budget):** Supabase Free + a GitHub Actions cron that runs `pg_dump` nightly and stores the artifact, plus a keep-alive ping every few days to prevent free-tier pausing. Because terminals work fully offline, a paused/slow backend never blocks selling; queued sales simply sync later.

Reliability: the shop keeps trading even if the cloud is down, since the local DB is the source of truth for the till. (Check current vendor pricing before committing; plans change.)

---

## 4. Business Empathy & Scalability

### Shop-floor decisions (checkout < 10 s, fewer mistakes)

1. **Barcode-first, always-focused input.** The search/scan field keeps focus after every action. A scanner types the SKU + Enter; an exact barcode match adds the item instantly from the local index (no network). Scanning the same item again increments quantity.
2. **Guardrails instead of confirmations.** Cash payment has quick-tender buttons (exact, $20, $50, $100) with big, live "Change due". Large discounts (>20%) and voids need a manager PIN. Checkout never blocks on connectivity: the sale completes locally and the badge shows `Offline · 4 unsynced`. Undo-last-item is one key.

### Future-proofing

- **Second store:** schema already has `store_id` on `variants` stock/`sales`/`terminals`. Next step is to split `variants.stock_qty` into a `store_stock(variant_id, store_id, qty)` table (the ledger already carries `store_id`). The catalog (`products`, `variants`) stays shared; no rewrite, only a migration and a store selector at login.
- **BOGO and promos:** pricing is a pure function `applyPromotions(cart, promotions[]) -> discounts[]` that runs on the device against locally cached `promotions` rows (`type: BOGO`, `rules: {buy: 1, get: 1, scope: category/variant}`). Results are written to `sale_items.discount_cents`, so receipts and refunds already handle them.
- **Loyalty:** `customers` + a `loyalty_ledger` (points earned = f(total), redeemed as a payment method/discount). Customer lookup by phone is cached locally; points are applied as events in the same outbox, so they sync idempotently like sales.
