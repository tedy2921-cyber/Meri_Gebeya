# Meri Gebeya · መሪ ገበያ

A complete, working e-commerce marketplace for the Ethiopian market: customer storefront,
guest and account checkout, mock Telebirr/CBE Birr payments, order tracking, and a full
seller/admin console — plus the "smart" bits (search that understands Amharic, suggestions,
frequently-bought-together, best sellers, low-stock alerts, live dashboard metrics).

**Zero npm dependencies.** The backend is Node 22.5+ built-ins only (`node:http`,
`node:sqlite`, `node:crypto`). The frontend is plain ES modules — no build step, no bundler,
no framework. You can read every line of how it works.

---

## Run it in 60 seconds

```bash
# 1. Node 22.5 or newer is required (node:sqlite). Check with: node -v
# 2. Seed the database with demo catalogue + orders (first run only)
npm run reset

# 3. Start the server
npm start
```

| What | Where |
| --- | --- |
| Storefront | http://127.0.0.1:4000/ |
| Admin console | http://127.0.0.1:4000/admin |
| API health check | http://127.0.0.1:4000/api/health |
| Database file | `data/meri-gebeya.db` (created on first boot) |

### Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Shopper | `sara@example.et` | `Password123` |
| Shopper | `liya@example.et`, `daniel@example.et`, `hanna@example.et`, `yonas@example.et` | `Password123` |
| **Admin** | `admin@merigebeya.et` | `Admin12345` |

Coupons that work out of the box: `MERI10` (10% off baskets over 500 ETB, capped at 300 ETB),
`FIRST50` (50 ETB off over 800 ETB), `COFFEE15` (15% off over 700 ETB), `FREESHIP` (70 ETB off
over 1,200 ETB — covers the Addis delivery fee).

### All scripts

```bash
npm start          # run the server (port 4000)
npm run start:env  # same, but loads .env first (needs Node 22.9+)
npm run dev        # same, with --watch auto-restart while you edit
npm run seed       # add demo data only if the shop is empty
npm run reset      # DROP everything, re-create the schema, re-seed  ⚠ destroys data
npm run check      # syntax-check every backend and frontend file
npm run sql -- "SELECT code, value FROM coupons"   # query the database (.tables, .schema <t>, --write)
```

Environment variables (see `.env.example`): `PORT`, `HOST`, `NODE_ENV`, `MG_DATA_DIR`,
`MG_SECRET`. Set `MG_SECRET` to a long random string before deploying anywhere real.

---

## What is actually implemented

**Storefront** — home (best sellers, deals, new arrivals, categories), shop with category /
price / stock / sale filters + 6 sort orders + paging, product page with image gallery,
quantity picker, tabs (description, reviews, delivery), star breakdown, related products and
"frequently bought together", live search with dropdown suggestions, cart with quantity
steppers and coupon box, 3-step checkout (delivery → payment → review), order confirmation
with a status timeline, print receipt, public order tracking by number, wishlist, saved
addresses, profile + password change, EN ⇄ አማርኛ language switch, ETB formatting everywhere.

**Backend** — sessions as HttpOnly cookies with hashed tokens, scrypt password hashing,
guest carts that merge into the account on sign-up, stock-capped cart lines, coupon rules
(window, min spend, usage cap, max discount), delivery zones with free-over thresholds,
checkout as a single SQL transaction (stock re-check → order → items → payment → inventory
ledger → cart converted), an order status machine that returns stock on cancellation, RBAC on
every `/api/admin/*` route, and event logging that powers the smart features.

**Admin console** — dashboard (revenue all-time / 7d / 30d, 21-day sales chart, top products,
sales by category, low stock, recent orders), orders with status transitions and manual
payment capture, products CRUD with bilingual fields and an image list, one-click restock plus
the full movement ledger, categories, customers (spend, order count, enable/disable), coupons,
review moderation, activity feed.

---

## How the code is arranged

```
meri-gebeya/
├── package.json            scripts + "type": "module"
├── .env.example            every env var the server reads
├── db/
│   └── schema.sql          THE database. 19 tables, run at boot, idempotent
├── data/                   SQLite file + WAL (gitignored, created at runtime)
├── server/                 backend — never touches the DOM
│   └── src/
│       ├── config.js       env, paths, db handle, migrate(), tx(), all/get/run
│       ├── security.js     scrypt hashing, token hashing, cookies
│       ├── http.js         Router, request context, JSON/static responses, validators
│       ├── catalog.js      READ queries: products, search, related, best sellers
│       ├── cart.js         carts, lines, coupons, zones, cart summary (money math)
│       ├── orders.js       checkout transaction, status machine, mock payments
│       ├── users.js        accounts, sessions, addresses, wishlist, reviews
│       ├── admin.js        everything the console does, incl. dashboard metrics
│       ├── api.js          ONE router: maps HTTP routes onto the modules above
│       ├── server.js       boot: migrate → listen → route → log
│       ├── seed.js         demo data + procedural SVG product images
│       └── sql.js          `npm run sql` — a small SQL console for the same database
└── public/                 frontend — never touches SQL
    ├── index.html          storefront shell
    ├── admin.html          seller console shell
    ├── assets/
    │   ├── core.js         shared toolkit: fetch client, i18n, money, router, toasts
    │   ├── app.js          storefront pages (home, shop, PDP, cart, checkout, account)
    │   ├── styles.css      design system + storefront
    │   ├── admin.js        console pages
    │   └── admin.css       console styles
    └── img/                product tiles written by the seed
```

The rule that keeps this tidy: **`api.js` is the only file that knows about HTTP routes, and
the domain modules are the only files that know about SQL.** Handlers in `api.js` are three
lines each — authenticate, call a module, return a value. `server.js` turns returned values
into JSON and thrown errors into status codes.

Full walkthroughs:

- [docs/01-arranging-the-code.md](docs/01-arranging-the-code.md) — folder logic, request lifecycle, how to add a feature
- [docs/02-database.md](docs/02-database.md) — every table, why money is INTEGER, the stock ledger, the status machine
- [docs/03-backend-api.md](docs/03-backend-api.md) — every endpoint with request/response examples and error shapes
- [docs/04-frontend.md](docs/04-frontend.md) — the two SPAs, hash router, i18n, cart state, styling system
- [docs/05-roadmap.md](docs/05-roadmap.md) — moving to React/Next + Postgres + a real payment gateway

Learning to build projects like this yourself:

- [docs/06-how-it-was-built.md](docs/06-how-it-was-built.md) — the 15 build steps in the order they were done, with the real code and the real bugs found
- [docs/07-skills-and-commands.md](docs/07-skills-and-commands.md) — languages, concepts, tools, every command (terminal, Node, npm, Git, curl, SQL), a learning path and a starter template

---

## Try this flow (2 minutes)

1. Open the storefront → search `ቡና` (Amharic for coffee) → suggestions appear.
2. Add *Yirgacheffe Cheleki* to the basket, then the *Jebena* → the cart starts suggesting
   pairs.
3. Apply `MERI10` (needs a 500 ETB basket), switch the delivery zone to Adama, watch the
   free-delivery bar.
4. Checkout as guest → pick Telebirr → place the order.
5. On the confirmation page press **Pay** — the mock gateway captures and the order moves to
   Confirmed.
6. Open `/admin`, sign in as `admin@merigebeya.et` → the revenue and the new order are already
   there. Move the order to Packing; try Delivered straight away and watch it refuse.
7. Toggle **አማርኛ** in the header.

---

## Honest limitations

- **Payments are simulated.** `orders.js → providers()/confirmPayment()` is the swap point for
  a real Telebirr/CBE Birr/chapa SDK. Nothing talks to a bank.
- **SQLite, single process.** Perfect for a demo, a shop with one server, or local development.
  For many writers or multiple app instances, move to Postgres (the SQL is standard enough that
  the migration is mostly types).
- **Images are generated SVGs**, not uploads. There is no file-upload endpoint yet.
- **Amharic strings are machine-quality.** The UI is fully bilingual and product/category names
  come from the database in both languages, but a native speaker should review marketing copy
  before launch.
- **No email is actually sent** — receipts are recorded and shown on screen instead.
