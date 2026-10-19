# 05 · Where to take it next

This build is deliberately small enough to understand in an afternoon. Everything in it is
meant to be *replaced incrementally*, not rewritten. Here is the order that costs the least.

## 1 · Real payments (highest value, smallest diff)

One file knows about money movement: `server/src/orders.js`.

```js
export const providers = () => [ … ];              // what the checkout offers
export function confirmPayment(reference, …)       // what the gateway callback does
```

To go live with Telebirr / CBE Birr / chapa / Santopay:

1. Add a `checkout()` branch that, instead of writing a `created` payment row, calls the
   provider's "request to pay" API and stores the `checkout_url` it returns.
2. Add `POST /api/payments/webhook/:provider` in `api.js` that verifies the provider signature,
   finds the payment by `reference`, and calls `confirmPayment()` — which already handles the
   order status, the ledger and the event log.
3. Keep `cod` working; cash on delivery is most of the Ethiopian market and it needs no gateway.

The `payments.reference` column is `UNIQUE`, so a webhook that fires twice is harmless.

## 2 · Postgres instead of SQLite

Only three functions in the whole codebase touch the driver: `all`, `get`, `run` in
`server/src/config.js`. Swap them for a `pg` pool and make them `async`, then `await` at the
call sites (mechanical, and the compiler/`npm run check` will not catch it — run the smoke tests
in `docs/03-backend-api.md` after).

While you are there:
- `INTEGER` cents → keep them. `NUMERIC` is tempting and worse.
- `LIKE '%q%'` → `tsvector` + a GIN index, or Meilisearch if you want typo tolerance and Amharic
  tokenisation.
- Stock decrement → `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`, then
  check the row count. That is the real reason to move: many concurrent writers.

## 3 · React / Next.js for the storefront

The API is already a clean boundary — a mobile app or a Next frontend can consume it unchanged.
A low-risk path:

1. Scaffold `web/` next to `server/`, keep `public/` running as the fallback.
2. Port `core.js` almost line for line: the `api` client, `ETB()`, `t()`/`pick()` and
   `STRINGS` are framework-free already.
3. Move one route at a time (`/product/[slug]` first — it is the page that matters for SEO),
   using server components for the read and the existing endpoints for the writes.
4. Keep the admin console as it is for now. Internal tools do not need SSR.

Do this when you have a reason (SEO, a design system, a second client), not before.

## 4 · Product images that people can upload

`product_images` already supports many images per product with a `sort` column, and the admin
modal accepts a list of URLs. Missing piece:

- `POST /api/uploads` that reads the body, checks the MIME type and size, writes to
  `data/uploads/<uuid>.<ext>` (or S3/R2/Backblaze for real hosting), and returns the URL.
- Add `multipart/form-data` parsing to `http.js → readBody` — currently it accepts JSON and
  urlencoded only.
- Serve uploads through `serveStatic` with a long `Cache-Control`, and generate a 600×450 thumb
  server-side so cards stay fast.

## 5 · Security hardening before public launch

Already in place: scrypt password hashing, hashed session tokens, HttpOnly + SameSite cookies,
`Secure` in production, RBAC on `/api/admin/*`, foreign keys, a 512 KB body cap, path-traversal
guard on static files, server-side re-pricing at checkout, and stock checks inside the
transaction.

Add, in this order:
1. **CSRF** — `SameSite=Lax` blocks most of it; add a double-submit token or an
   `X-Requested-With` requirement on state-changing routes.
2. **Rate limits** — a small in-memory bucket per IP on `/api/auth/login`,
   `/api/auth/register`, `/api/checkout`, `/api/suggest`.
3. **Set `MG_SECRET`** to a long random value (it currently defaults to a dev string) and move
   config to a real secret store.
4. **Password reset** — a `password_resets` table with a hashed token and an expiry; email via
   a provider. There is no email sender yet, so pick one here too.
5. **Headers** — a CSP, `Referrer-Policy`, `Strict-Transport-Security` in `server.js`.
6. **Backups** — `sqlite3 .backup` (or `pg_dump`) on a schedule; the whole shop is one file
   today, which makes this almost embarrassingly easy.

## 6 · Features the schema is already ready for

These need UI, not migration:

- **Multi-vendor selling.** `products` has no `seller_id` yet, but `users.role` is an enum you
  can extend to `seller`, and `orders` already snapshots everything, so splitting an order into
  per-seller parcels is a later, additive change.
- **Restock notifications** — an email field plus a small table; `adjustStock()` in `admin.js`
  is the exact moment to fire them.
- **Loyalty / wallet** — `payments` and `orders.total_cents` give you the ledger to build on.
- **Delivery pricing by distance** — `delivery_zones` is a flat fee today; `eta_hours` and
  `free_over_cents` already exist, so per-kg or per-hour rules slot in beside them.
- **Recommendations that learn** — `events` records every view and cart add. "Customers who
  viewed X also bought Y" is one aggregation over `events` + `order_items`; the
  frequently-bought-together query in `catalog.js` is the template.
- **Order messages / support** — `orders.instructions` is captured and displayed; a thread table
  beside `order_id` is enough for a first support flow.

## 7 · Operations

| Need | Do this |
| --- | --- |
| Run forever | `pm2 start server/src/server.js --name meri-gebeya` or a systemd unit; the process is stateless apart from `data/` |
| Container | `FROM node:24-slim`, copy the repo, `CMD ["node","server/src/server.js"]`, mount a volume at `/app/data` |
| HTTPS | Put nginx or Caddy in front — cookies marked `Secure` require it, and so does Telebirr's callback |
| Logs | `server.js` already prints one line per request; ship stdout, do not write your own log files |
| Uptime | `/api/health` is the probe; it touches nothing, so it stays green even when the DB is busy |
| Staging data | `MG_DATA_DIR=/tmp/mg npm run reset` gives a clean seeded shop without touching your real file |

## 8 · Tests worth writing

There is no test runner in this build (zero dependencies was the point). The smoke script in
`docs/03-backend-api.md` is the current safety net. If you add tests, start with the three
places where a bug costs money:

1. `Cart.summary()` — coupon caps, min spend, expiry, re-pricing, stock caps.
2. `Orders.checkout()` — stock cannot go negative, totals match the summary, the ledger rows
   exist, the cart is converted exactly once.
3. `Orders.transition()` — every legal move, every illegal move, and that cancelling returns
   stock.

`node:test` is built in, so even that stays dependency-free.
