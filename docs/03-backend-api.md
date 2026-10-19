# 03 · Backend API reference

Base URL `http://127.0.0.1:4000`. Everything is JSON under `/api/*`. There is no API key:
identity travels in the `mg_session` HttpOnly cookie, so requests must send credentials
(`fetch(url, { credentials: "include" })` — which `core.js → api` does for you).

## Conventions

| Thing | Rule |
| --- | --- |
| Money | integer cents in every payload; format at the edge |
| Dates | ISO-8601 UTC strings |
| Success | the handler's return value; `200` unless the route sets `ctx.status = 201` |
| Failure | thrown `HttpError` → `{ "error": "message", "fields": { field: "hint" } }` |
| Statuses | 400 validation · 401 not signed in · 403 not allowed · 404 missing · 409 conflict (stock, duplicates, illegal status move) |
| Paging | `?page=1&per=12` → `{ items, total, page, per, pages, bounds }` |
| Caching | API responses are `no-store`; static files are `no-cache` in dev, `max-age=3600` in production |

```json
{ "error": "Check the highlighted fields", "fields": { "email": "Invalid email" } }
```

## Public catalogue

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, service, time, currency, env }` |
| GET | `/api/meta` | everything the shell needs in one call: currency, zones, payment providers, price bounds, category tree |
| GET | `/api/home` | `hero` (best sellers), `featured`, `newArrivals`, `onSale`, `categories` |
| GET | `/api/products` | see filters below |
| GET | `/api/products/:slug` | product + `images[]` + published `reviews[]` + `related[]` + `also_bought[]` + `in_cart_qty` + `wished` |
| GET | `/api/categories` | flat tree with `product_count` |
| GET | `/api/suggest?q=` | ≤6 products + ≤3 categories, for the search dropdown |

`GET /api/products` accepts `q`, `category` (slug), `min`, `max` (cents), `inStock=1`,
`onSale=1`, `featured=1`, `sort` ∈ `newest|popular|price_asc|price_desc|rating|name`,
`page`, `per`.

```bash
curl 'http://127.0.0.1:4000/api/products?category=coffee-tea&sort=price_asc&per=2'
```
```json
{ "items": [ { "id": 4, "slug": "tea-leaf-congo", "name": "Congo Tea Leaves 250g",
               "name_am": "…", "price_cents": 12000, "stock": 96,
               "image_url": "/img/tea-leaf-congo.svg", "rating_avg": 0, "…": "…" } ],
  "total": 4, "page": 1, "per": 2, "pages": 2,
  "bounds": { "min": 8500, "max": 420000 } }
```

`GET /api/products/yirg-cheleki` returns `{ product, related, also_bought, in_cart_qty, wished }`
where `product` also carries `images[]` and `reviews[]` (published only, newest first, with the
author's first name).

## Cart

The cart exists for guests too — the first write issues a `mg_cart` cookie holding a random
token. Signing in merges the guest cart into the account cart.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/cart` | — | cart summary |
| POST | `/api/cart/items` | `{ product_id, qty }` | cart summary |
| PATCH | `/api/cart/items/:productId` | `{ qty }` (0 removes) | cart summary |
| DELETE | `/api/cart/items/:productId` | — | cart summary |
| DELETE | `/api/cart` | — | empty summary |
| POST | `/api/cart/coupon` | `{ code }` (`""` clears) | summary, or 400 with the reason |
| GET | `/api/coupon/check?code=&zone=` | — | `{ code, discount, reason, next }` without applying |
| GET | `/api/shipping` | — | active zones |

```json
{ "cart_id": 10,
  "items": [ { "product_id": 1, "slug": "yirg-cheleki", "name": "Yirgacheffe Cheleki Coffee Beans 500g",
               "name_am": "የኢርጋጨፌ ቺቂ ቡና 500 ግራም", "sku": "MG-COF-YIRG-C", "unit": "pack",
               "image_url": "/img/yirg-cheleki.svg", "qty": 2, "stock": 115,
               "unit_price_cents": 34000, "line_total_cents": 68000,
               "price_changed": false, "low_stock": false } ],
  "item_count": 2, "subtotal_cents": 68000, "discount_cents": 6800,
  "coupon_code": "MERI10", "coupon_reason": null, "total_cents": 61200,
  "issues": [], "can_checkout": true, "zone_estimate": null }
```

`issues` is how the server talks back about stock: `"Only 3 left in stock — quantity adjusted"`.
Over-requesting returns **409**, not a silent cap.

## Checkout, orders, payments

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/checkout` | the whole order in one transaction; returns `201 { order, pay }` and clears the cart cookie |
| GET | `/api/orders/:id` | owner or admin; a guest may pass `?email=` to prove ownership |
| GET | `/api/track/:number` | public status for `MG-YYYYMMDD-XXXXXX` |
| POST | `/api/orders/:id/cancel` | customer until it ships; admin any time before refund |
| POST | `/api/payments/:reference/confirm` | mock gateway capture; returns the **order object itself** |

```bash
curl -X POST http://127.0.0.1:4000/api/checkout -H 'Content-Type: application/json' \
  -b jar -c jar -d '{
    "email":"doc@example.com","phone":"+251911000000",
    "ship":{"name":"Doc","phone":"+251911000000","region":"Addis Ababa","city":"Addis Ababa","subcity":"Bole"},
    "zone_id":1,"payment_method":"telebirr","instructions":"press 12" }'
```
```json
{ "order": { "id": 16, "number": "MG-20261019-45DFC6", "status": "pending",
             "payment_method": "telebirr", "payment_status": "authorized",
             "subtotal_cents": 68000, "discount_cents": 6800, "delivery_cents": 7000,
             "total_cents": 68200, "coupon_code": "MERI10", "eta_hours": 4,
             "items": [ … ], "payments": [ { "provider": "telebirr",
                        "reference": "PAY-TELEBIRR-…", "status": "authorized", … } ],
             "timeline": [ { "status": "pending", "label": "Placed", "done": true, "at": "…" }, … ] },
  "pay": { "provider": "telebirr", "reference": "PAY-TELEBIRR-…", "amount_cents": 68200 } }
```

**The client never sends totals.** `ship`, `zone_id`, `payment_method`, `email`, `phone` and
`instructions` are the only inputs; subtotal, discount, delivery and total are recomputed
server-side inside the transaction, which also re-checks stock, decrements it, writes the
`sale` ledger rows, creates the payment record, bumps the coupon counter and converts the cart.
`payment_method` ∈ `cod | telebirr | cbe_birr | bank | card`.

## Accounts

| Method | Path | Body / notes |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ name, email, password, phone?, lang? }` → `201 { user, cart }`, sets the session cookie, merges the guest cart and **claims past guest orders with the same email** |
| POST | `/api/auth/login` | `{ email, password }` → `{ user, cart }` |
| POST | `/api/auth/logout` | drops the current session |
| GET | `/api/me` | `{ user: null }` or `{ user, unread_orders? }` |
| PATCH | `/api/me` | `{ name, phone, lang }` |
| POST | `/api/me/password` | `{ current, next }` — signs every other device out |
| GET/POST | `/api/addresses` · PATCH/DELETE `/api/addresses/:id` | `{ label, recipient, phone, region, city, subcity, woreda, landmark, is_default }` |
| GET | `/api/wishlist` · POST `/api/wishlist/:productId` | toggle returns `{ saved: true|false }` |
| POST | `/api/products/:id/reviews` | `{ rating, title?, body? }` — one per customer per product; re-posting replaces it and recomputes the average. Flagged `verified` when the reviewer has a delivered order containing it |
| GET | `/api/my/reviews` | the signed-in shopper's own reviews |

Passwords: scrypt with a random 16-byte salt, stored as `scrypt$salt$hash`, minimum 8
characters. Session tokens are 32 random bytes, base64url; only `HMAC-SHA256(token)` is stored,
expiry slides on each hit, and the cookie is `HttpOnly; SameSite=Lax; Path=/` (`Secure` in
production).

## Admin — `/api/admin/*`

Every route runs through `asAdmin()`: 401 when signed out, 403 when the account is not an
admin. A shopper's cookie is worthless here.

| Area | Routes |
| --- | --- |
| Dashboard | `GET /metrics` |
| Products | `GET /products?q=&status=&category=&low=1&page=&per=` · `GET/POST/PATCH/DELETE /products[/:id]` |
| Stock | `POST /inventory` `{ product_id, delta, reason, note }` · `GET /movements?product_id=` |
| Categories | `GET/POST/PATCH/DELETE /categories[/:id]` |
| Orders | `GET /orders?status=&q=` · `PATCH /orders/:id` `{ status }` |
| Customers | `GET /customers?q=` · `GET /customers/:id` · `PATCH /customers/:id` `{ active }` |
| Coupons | `GET/POST/PATCH/DELETE /coupons[/:code]` |
| Reviews | `GET /reviews?status=` · `PATCH /reviews/:id` `{ status }` |
| Activity | `GET /events` |

`GET /api/admin/metrics` returns:

```json
{ "revenue_cents": 3460000, "revenue_7d_cents": 2230000, "revenue_30d_cents": 3460000,
  "orders": 16, "orders_today": 4, "open_orders": 8, "customers": 8, "products": 35,
  "drafts": 0, "units_sold": 214, "avg_order_cents": 241000, "pending_reviews": 2,
  "low_stock": [ … ], "by_day": [ { "day": "2026-10-12", "cents": 410000, "orders": 3 }, … ],
  "top_products": [ { "name": "…", "units": 14, "cents": 193200 }, … ],
  "by_category": [ { "name": "Coffee & Tea", "cents": 1204000 }, … ],
  "recent_orders": [ … ], "events": [ … ] }
```

Product writes accept ETB (`price: "199"`) or explicit `price_cents`; validation rejects
duplicates with `409 { fields: { sku: "Already used" } }`. Deleting a product that appears in
an order **archives** it instead of destroying history. `PATCH /orders/:id` walks the status
machine and returns `409` with `fields.status = "Allowed next: shipped, cancelled"` when you
skip a step — that response is what the console renders as its button list.

## Errors worth knowing

| Situation | Code | Message |
| --- | --- | --- |
| Adding more than exists | 409 | `Only 3 left in stock` |
| Coupon below its threshold | 400 | `Add 500.00 ETB more to use this coupon` |
| Coupon expired / capped | 400 | `That coupon expired on …` / `That coupon has been fully used` |
| Empty basket at checkout | 400 | `Your cart is empty` |
| Shopper hits an admin route | 403 | `Admin only` |
| Guest reads someone else's order | 404 | `Order not found` |
| Body too large | 400 | `Request body too large` (512 KB cap) |

## Smoke-test it

```bash
npm start &
curl -s localhost:4000/api/health
curl -s -c jar -X POST localhost:4000/api/cart/items -H 'content-type: application/json' -d '{"product_id":1,"qty":2}'
curl -s -b jar -c jar -X POST localhost:4000/api/cart/coupon -H 'content-type: application/json' -d '{"code":"MERI10"}'
curl -s -b jar -c jar -X POST localhost:4000/api/checkout -H 'content-type: application/json' \
  -d '{"email":"a@b.et","phone":"+251900000000","ship":{"name":"A","phone":"+251900000000","region":"Addis Ababa","city":"Addis Ababa"},"zone_id":1,"payment_method":"cod"}'
curl -s -c jar2 -X POST localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@merigebeya.et","password":"Admin12345"}' -o /dev/null
curl -s -b jar2 localhost:4000/api/admin/metrics | head -c 200
```
