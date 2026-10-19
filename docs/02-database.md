# 02 · The database

One file defines everything: **`db/schema.sql`** (19 tables). It is applied at every boot by
`migrate()` in `server/src/config.js`, and every statement is `CREATE TABLE IF NOT EXISTS` /
`CREATE INDEX IF NOT EXISTS`, so running it a hundred times is harmless. There is no separate
migration tool — for a project this size, an idempotent schema plus `npm run reset` is simpler
and honest. When you need real migrations, see §7.

```bash
npm run reset    # drop → recreate → seed
npm start        # migrate() ensures the schema exists even on a blank data dir
```

## 1. The three rules that shape everything

**Money is an INTEGER number of cents.** `price_cents`, `total_cents`, `fee_cents` … never
REAL. Floats round; cents do not. The only places a decimal appears are `rating_avg` (not
money) and the UI, where `ETB(cents)` divides by 100 for display. Admin forms take ETB and
convert with `toCents()` on the way in.

**Timestamps are ISO-8601 UTC strings** (`2026-10-19T13:36:40.997Z`) written by `nowIso()`.
SQLite has no date type; an ISO string sorts correctly as text, so `ORDER BY placed_at DESC`
just works and the values survive any JSON round-trip.

**Anything that can be referenced later is snapshotted.** `order_items` stores
`name_snapshot`, `sku_snapshot`, `image_url`, `unit_price_cents` and `line_total_cents`. Rename
or delete a product and old orders still print correctly. Same idea for the shipping address:
it is copied onto the order row rather than joined to `addresses`.

## 2. Table map

| # | Table | Read it as |
| --- | --- | --- |
| 1 | `users` | shoppers and staff; `role` is `customer`/`admin`, `lang` is `en`/`am` |
| 2 | `sessions` | one row per signed-in device; stores only the **HMAC of the token** |
| 3 | `addresses` | saved delivery addresses, `is_default` per user |
| 4 | `categories` | self-referencing tree (`parent_id`), bilingual, `slug` unique |
| 5 | `products` | the catalogue: price, stock, status, flags, rating roll-ups |
| 6 | `product_images` | ordered gallery per product |
| 7 | `carts` | open or converted; guest carts keyed by `token`, account carts by `user_id` |
| 8 | `cart_items` | one line per product with a **price snapshot** |
| 9 | `coupons` | percent/fixed, min spend, cap, window, usage limit |
| 10 | `delivery_zones` | fee, free-over threshold, ETA |
| 11 | `orders` | the money record + the shipping address copy + two status columns |
| 12 | `order_items` | immutable lines |
| 13 | `payments` | provider, unique `reference`, capture timestamps |
| 14 | `inventory_movements` | append-only stock ledger |
| 15 | `reviews` | one per customer per product, moderated |
| 16 | `wishitems` | (user, product) pairs |
| 17 | `events` | views, cart adds, orders, coupon uses — the "smart" fuel |
| 18 | `settings` | key/value store for shop name, tagline, support phone |
| 19 | *(indexes)* | listed in §5 |

## 3. Why stock is both a column and a ledger

`products.stock` is the number the storefront needs in one indexed read.
`inventory_movements` is the audit trail explaining *why* it is that number:

```sql
reason ∈ ('sale','restock','return','adjust','cancel','import')
```

Every path that changes stock writes a row in the same transaction: checkout writes `sale`,
cancelling writes `return`/`cancel`, the admin's +/- buttons write `adjust`, restocking writes
`restock`, and the seed writes `import`. Product detail pages show the last 20 movements, so a
disappearing unit is always explainable. If you ever doubt the column, this recomputes it:

```sql
SELECT p.id, p.stock, COALESCE(SUM(m.delta),0) AS ledger
FROM products p LEFT JOIN inventory_movements m ON m.product_id = p.id
GROUP BY p.id HAVING p.stock <> COALESCE(SUM(m.delta),0);
```

## 4. Two statuses, one machine

An order carries `status` (fulfilment) and `payment_status` (money). Keeping them separate is
what lets cash-on-delivery sit at `pending` + `unpaid` for a day without being "failed".

```
pending → confirmed → packing → shipped → delivered → refunded
   └─────────── cancel allowed until shipped ───────────┘
```

`STATUS_FLOW` in `server/src/orders.js` is the single source of truth. `transition()` refuses
anything else with a 409 that *tells the caller what is allowed next*:

```json
{ "error": "Cannot move an order from packing to delivered",
  "fields": { "status": "Allowed next: shipped, cancelled" } }
```

On the way in, it also: returns stock when an order is cancelled before shipping, marks the
payment `refunded` when the order is refunded, sets `delivered_at` on arrival, and decrements
the coupon's `used_count` when a paid order is cancelled.

## 5. Indexes and why each one exists

```
users(email)                       unique — login, and the only lookup on every request
sessions(token_hash)               unique — the hot path: cookie → user
sessions(user_id)                  "sign this device out", "sign them all out"
products(category_id, status)      category pages always filter by both
products(status, featured, price)  home page, "on sale", price sorting
products(name, name_am)            search / suggest (LIKE '%q%' cannot use it, but the
                                   covering scan stays cheap at catalogue size)
cart_items(cart_id, product_id)    UNIQUE — makes "add 2 more of what I already have" an upsert
carts(user_id, status)             resolveCart(): my one open cart
order_items(order_id)              printing an order
order_items(product_id)            frequently-bought-together self-join
inventory_movements(product_id, created_at)  the ledger on the product page
reviews(product_id, status)        published reviews + the rating roll-up
events(type, created_at)           dashboard counters
```

`PRAGMA journal_mode = WAL` lets readers and one writer overlap, `foreign_keys = ON` makes
`ON DELETE CASCADE` actually fire (sessions, cart items, images, order items all rely on it),
and `busy_timeout = 5000` absorbs the moment two writes collide.

## 6. How the app keeps money correct

`Cart.summary(cartId)` is the only function that decides what a basket costs. It re-prices
lines whose snapshot differs from the live price, caps quantity at current stock, applies the
coupon through `evaluateCoupon()` (active flag → start/end window → usage cap → min spend →
percent or fixed → max discount cap), and returns `can_checkout`. Checkout re-runs the same
rules **inside** the transaction and re-checks stock with a live `SELECT`, so a price or a
stock change between "review" and "place order" cannot slip through. The client never sends a
total — only `zone_id`, `payment_method` and the address.

## 7. Growing past SQLite

The SQL here is standard; the gaps are types and concurrency.

| Now | Later | What changes |
| --- | --- | --- |
| `node:sqlite` `DatabaseSync` | `pg` + a pool, or Drizzle/Prisma | `all/get/run` become async — the only functions the domain modules call |
| `INTEGER` cents | `NUMERIC(12,2)` or keep cents (recommended) | nothing |
| ISO text | `timestamptz` | `nowIso()` → `new Date().toISOString()` still works |
| `LIKE '%q%'` | `to_tsvector` + GIN index, or Meilisearch/Typesense | `catalog.js` search block only |
| one writer | many writers | stock decrement becomes `UPDATE … WHERE stock >= ?` and you read the row count |
| `data/*.db` file | managed Postgres, backups, replicas | `MG_DATA_DIR` → `DATABASE_URL` |

Add a real migration tool (`node-pg-migrate`, Prisma Migrate, or Flyway) the moment more than
one person changes the schema; until then, editing `schema.sql` and running `npm run reset`
is the fastest loop that exists.
