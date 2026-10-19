# 01 · Arranging the code

This document explains *why* the files sit where they do and how a request moves through them.
Read this first if you intend to add features.

## The one-sentence version

`db/schema.sql` defines the data · `server/src/*.js` owns the rules · `api.js` exposes them as
HTTP · `public/assets/*.js` renders whatever the API returns.

## Three layers, one direction of dependency

```
        browser                              process
 ┌─────────────────────┐            ┌───────────────────────────────┐
 │ public/             │  fetch     │ server/src/                   │
 │  index.html         │ ─────────► │  server.js  (boot + dispatch) │
 │  admin.html         │  JSON      │  api.js     (routes + auth)   │
 │  assets/core.js     │ ◄───────── │    │                          │
 │  assets/app.js      │            │    ▼                          │
 │  assets/admin.js    │            │  catalog · cart · orders ·    │
 │  styles.css         │            │  users · admin  (domain)      │
 └─────────────────────┘            │    │                          │
        no SQL                      │    ▼                          │
        no secrets                  │  config.js (db handle, tx)    │
                                    │  http.js · security.js (plumb)│
                                    └───────────────────────────────┘
                                              │
                                              ▼
                                       data/meri-gebeya.db
```

Nothing in `public/` imports anything from `server/`, and no domain module imports `api.js`.
That single rule is what keeps a 5,600-line project from turning into spaghetti: you can test
`orders.checkout()` without a browser, and you can restyle the cart without touching SQL.

## What each backend file is for

| File | Owns | Deliberately does NOT contain |
| --- | --- | --- |
| `config.js` | env vars, paths, the `DatabaseSync` handle, `migrate()`, `tx()`, `all/get/run`, `nowIso`, `setting/setSetting`, `logEvent` | business rules |
| `security.js` | scrypt password hash/verify, random tokens, HMAC token hashing, cookie serialise/parse | SQL, HTTP |
| `http.js` | `Router`, request context, body reading, JSON/error responses, static file serving, field validators | any domain knowledge |
| `catalog.js` | read queries for the shop: listing + filtering + sorting, product detail, related, frequently-bought-together, best sellers, price bounds, view counting | writes |
| `cart.js` | cart resolution and merging, line edits with stock caps, coupon maths, delivery zones, `summary()` (the single source of truth for what a basket costs) | HTTP cookies |
| `orders.js` | `checkout()` as one transaction, `getOrder/listOrders`, the status machine, mock payment providers | anything about the UI |
| `users.js` | accounts, sessions, addresses, wishlist, reviews, rating recomputation, guest-order claiming | routes |
| `admin.js` | product CRUD + validation, stock adjustments, category/coupon CRUD, customer lookup, review moderation, dashboard metrics | auth checks (that is `api.js`) |
| `api.js` | the route table, `authenticate`, `needUser`/`needAdmin`, guest-cart cookie, mapping bodies onto module calls | SQL |
| `server.js` | boot, migrate, dispatch, request logging, 404 page, graceful shutdown | handlers |
| `seed.js` | demo data and procedural SVG product tiles | anything the app calls at runtime |

**Adding a rule?** It goes in a domain module and gets called from `api.js`.
**Adding an endpoint?** It goes in `api.js` and stays short — parse, authorise, delegate.

## Lifecycle of one request

`POST /api/cart/items` with `{ product_id: 1, qty: 2 }`:

1. `server.js` receives it, `buildContext()` (in `http.js`) parses the URL, cookies and JSON
   body into `ctx`, and overrides `ctx.cookie()` so any cookie a handler sets is appended to
   the response.
2. `authenticate(ctx)` looks up the `mg_session` cookie, hashes it, joins `sessions`+`users`,
   refreshes the expiry, and puts `ctx.user` in place (or leaves it null for a guest).
3. `api.js` matches the route, calls `cartOf(ctx)` which resolves the cart — the user's open
   cart if signed in, otherwise the guest cart from the `mg_cart` cookie, creating one and
   issuing the cookie if needed.
4. The handler calls `Cart.addItem(cart.id, product_id, qty)`. That module re-reads the stock,
   caps the quantity, upserts the line and snapshots the current price.
5. The handler returns `Cart.summary(cart.id)` — a plain object.
6. `server.js` sees the value and writes `200 application/json`. If a handler throws
   `HttpError`, `sendError` turns it into the right status with `{ error, fields }`.

Two conventions make step 6 possible: **handlers return data, never write responses**, and
**handlers throw, never return error objects**. The only exception is `ctx.status = 201` for
created resources.

## Lifecycle of a page render

`http://127.0.0.1:4000/#/product/yirg-cheleki`

1. The server has only one file to serve for that URL: `public/index.html` (`/` and unknown
   static paths fall through `serveStatic`; `/admin` maps to `admin.html`).
2. `app.js` boots: `loadShell()` fetches `/api/meta` + `/api/me` + `/api/cart`, paints the
   header (badge, account menu, category nav), then `router()` runs the handler for the hash.
3. `Product({ params })` fetches `/api/products/yirg-cheleki` and writes HTML into `#view`.
4. Because the route is in the hash, back/forward and refresh work without any server routing,
   and the API stays a clean JSON boundary you could point a mobile app at later.

## How to add a feature (worked example: "notify me when back in stock")

1. **Data** — add `back_in_stock_alerts` to `db/schema.sql`. `CREATE TABLE IF NOT EXISTS` is
   fine; `migrate()` runs at every boot.
2. **Domain** — in `catalog.js` (read side) or a new `notify.js`, write
   `subscribe(productId, email)` and `unsubscribe(...)`. Pure SQL, no `ctx`.
3. **Route** — `api.post("/api/notify/:id", (ctx) => { ... })` in `api.js`, validating the
   email with `isEmail` from `http.js`.
4. **UI** — a button on the PDP in `app.js` that calls `api.post("/notify/" + p.id, { email })`
   and shows a `toast`.
5. **Trigger** — in `admin.js → adjustStock`, when stock crosses from 0 to >0, look up
   subscribers and log an `events` row (`type: 'notify.sent'`). The admin Activity page already
   renders any event type, so you get visibility for free.

You never edited more than one file per layer, and nothing needed a build step.

## Conventions used throughout

- **Money is integer cents**, formatted only at the edge (`ETB()` in `core.js`, `moneyInput()`
  in the admin forms).
- **Timestamps are ISO-8601 UTC strings** produced by `nowIso()`. Display uses local time.
- **Bilingual columns** are `name` / `name_am`, `description` / `description_am`, etc. The
  frontend uses `pick(row, "name")` so a missing translation falls back to English.
- **Slug in URLs, id in bodies.** Public reads use slugs (`/api/products/yirg-cheleki`);
  writes use ids.
- **Errors carry field names**: `throw badRequest("Check the highlighted fields", { email:
  "Invalid email" })` and `paintErrors(root, fields)` on the client lights up that input.
- **Every mutation logs an event** via `logEvent(type, { userId, productId, payload })`. That
  single table powers the dashboard, "sold this week" badges and future recommendations.
