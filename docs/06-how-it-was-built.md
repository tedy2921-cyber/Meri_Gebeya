# 06 · How Meri Gebeya was built, step by step

This is the build diary: the exact order the project was put together, why each
step came where it did, the real code from each step, and how each step was
checked before moving on. Follow the same order on your next project and you
will rarely get stuck.

> The one-sentence version: **design the data first, then the server that
> protects it, then the API that exposes it, then the pages that show it — and
> test each layer before you build on top of it.**

---

## The order at a glance

| # | Step | Files produced | You know it works when… |
|---|------|----------------|--------------------------|
| 0 | Decide scope and stack | (a list on paper) | You can say what a user does in 5 sentences |
| 1 | Design the database | `db/schema.sql` | The schema runs twice without errors |
| 2 | Database + config helpers | `server/src/config.js` | `node -e` can query a table |
| 3 | HTTP toolkit | `server/src/http.js` | A route returns JSON |
| 4 | Security | `server/src/security.js` | Hash → verify returns `true` |
| 5 | Domain logic | `catalog.js`, `cart.js`, `orders.js`, `users.js`, `admin.js` | Each rule throws on bad input |
| 6 | API routes | `server/src/api.js` | `curl` gets the right status codes |
| 7 | Server entry point | `server/src/server.js` | `npm start` prints the URLs |
| 8 | Demo data | `server/src/seed.js` | The shop has products to show |
| 9 | API smoke test | (curl commands) | Full checkout works with no browser |
| 10 | Frontend toolkit | `public/assets/core.js` | `api.get("/health")` works in the console |
| 11 | Page shell + design system | `index.html`, `styles.css` | Header/footer render, colours look right |
| 12 | Storefront pages | `public/assets/app.js` | You can shop and pay in the browser |
| 13 | Admin console | `admin.html`, `admin.js`, `admin.css` | Staff can manage everything |
| 14 | Browser testing + bug fixing | (fixes everywhere) | Console is clean, every flow passes |
| 15 | Documentation | `README.md`, `docs/` | Someone new can run it in 60 seconds |

Notice that the browser is not opened until step 10. Everything before that is
tested with the terminal. That is deliberate: when the backend is proven, any
bug you see in the browser must be a frontend bug, which halves your search.

---

## Step 0 — Decide the scope and the stack

Before writing a single line, write down what the shop must do:

1. A shopper browses categories, searches, and opens a product.
2. They add items to a basket — without needing an account.
3. They check out: address, delivery zone, payment method, coupon.
4. They can create an account and see their past orders.
5. Staff log into a separate console to manage products, stock, orders,
   coupons, reviews and customers.

Then choose the tools. The choice here was **Node.js with zero npm packages**:

| Need | Built-in used | Why not a package |
|------|---------------|-------------------|
| Web server | `node:http` | Shows what Express hides; nothing to install |
| Database | `node:sqlite` | A whole SQL database in one file, no server to run |
| Passwords, tokens | `node:crypto` | `scrypt` and HMAC are built in |
| Frontend | Plain HTML/CSS/JS modules | Browser runs the source directly, no build step |

> **Lesson for your projects:** pick the smallest stack that can do the job,
> and learn it properly. You can always add a framework later (doc 05 shows
> how); removing one is much harder.

---

## Step 1 — Design the database first

The database is the foundation. If it is wrong, everything built on top is
wrong. So the first file written was `db/schema.sql`.

How the tables were found: take every **noun** from the Step 0 list —
shopper, category, product, basket, order, address, payment, coupon, review,
staff — and each becomes a table. Every **verb** that moves things
("add to basket", "pay", "restock") becomes either a row in a table or a rule
in the code.

Here is the real `products` table (`db/schema.sql`, line 67):

```sql
CREATE TABLE IF NOT EXISTS products (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT    NOT NULL UNIQUE,
  name                  TEXT    NOT NULL,
  category_id           INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sku                   TEXT    NOT NULL UNIQUE,
  price_cents           INTEGER NOT NULL CHECK (price_cents >= 0),
  stock                 INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  status                TEXT    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('draft','active','archived')),
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL
  -- (plus name_am, description, brand, unit, rating, featured … see the file)
);
```

Four decisions in that table are worth copying into every project:

- **`price_cents INTEGER`, never a decimal.** 12.50 ETB is stored as `1250`.
  Computers cannot store 0.1 exactly as a float, so money stored as decimals
  slowly drifts. Integers never do.
- **`CHECK (stock >= 0)`** — the database itself refuses negative stock, even
  if the code has a bug.
- **`IF NOT EXISTS`** — the schema can run on every boot safely.
- **`slug`** — a URL-friendly name (`harar-longberry`) so links read well.

Stock changes are also written to a history table (line 221):

```sql
CREATE TABLE IF NOT EXISTS inventory_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  reason        TEXT    NOT NULL CHECK (reason IN ('sale','restock','return','adjust','cancel','import')),
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  ...
);
```

So `products.stock` answers "how many now?" quickly, and
`inventory_movements` answers "why?" forever.

**Check before moving on:** run the schema twice. If the second run errors,
something is not idempotent.

---

## Step 2 — Connect to the database (`config.js`)

One file owns the connection and all settings. Every other file imports from
here, so there is exactly one place to change the port or the database path.

```js
import { DatabaseSync } from "node:sqlite";

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "127.0.0.1",
  ...
};

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");   // readers don't block writers
db.exec("PRAGMA foreign_keys = ON;");    // SQLite has these OFF by default!
db.exec("PRAGMA busy_timeout = 5000;");  // wait instead of failing when busy
```

Then three tiny helpers that every module uses, plus the transaction helper:

```js
export const all = (sql, ...params) => db.prepare(sql).all(...p(params));  // many rows
export const get = (sql, ...params) => db.prepare(sql).get(...p(params));  // one row
export const run = (sql, ...params) => db.prepare(sql).run(...p(params));  // insert/update

export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = fn(); db.exec("COMMIT"); return result; }
  catch (err) { try { db.exec("ROLLBACK"); } catch {} throw err; }
}
```

The `?` placeholders are the single most important security habit in the
whole project: **values are never glued into SQL strings**, so SQL injection
is impossible.

```js
get("SELECT * FROM users WHERE email = ?", email);          // ✔ safe
get(`SELECT * FROM users WHERE email = '${email}'`);       // ✘ never do this
```

**Check:** `node -e "import('./server/src/config.js').then(m => console.log(m.all('SELECT name FROM sqlite_master')))"`

---

## Step 3 — The HTTP toolkit (`http.js`)

Node's `http` module gives you a raw request and response and nothing else.
This file adds the four things every web app needs.

**1. Errors that carry a status code.** Anywhere in the code you can
`throw notFound("Product not found")` and the right response is sent:

```js
export class HttpError extends Error {
  constructor(status, message, fields = null) {
    super(message); this.status = status; this.fields = fields;
  }
}
export const badRequest = (m, fields) => new HttpError(400, m, fields);
export const notFound   = (m = "Not found") => new HttpError(404, m);
export const conflict   = (m, fields) => new HttpError(409, m, fields);
```

**2. A router** that turns `/api/products/:slug` into a regular expression and
pulls `slug` out of the URL (`Router` class, line 28).

**3. A request context** (`ctx`) — one object holding the method, path,
query string, parsed JSON body, cookies and signed-in user. Handlers receive
`ctx` and return a plain object; they never touch raw `req`/`res`.

**4. A static file server** that sends files from `public/`, with one guard
you must always include:

```js
const target = normalize(join(root, pathname));
if (!target.startsWith(root)) throw forbidden("Nope");   // blocks ../../ tricks
```

---

## Step 4 — Security (`security.js`)

Fifty lines, two jobs.

**Passwords are hashed, never stored.** `scrypt` is slow on purpose, and the
random salt means two people with the same password get different hashes:

```js
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}
```

Checking uses `timingSafeEqual`, which takes the same time whether the first
or the last character is wrong — so attackers cannot measure their way in.

**Sessions are random tokens in `HttpOnly` cookies.** The browser keeps the
cookie, JavaScript cannot read it (`HttpOnly`), and the database stores only a
*hash* of the token — so a leaked database does not leak live sessions.

---

## Step 5 — Domain logic (the business rules)

Now the actual shop. Each file owns one area and is the only place that
writes SQL for it:

| File | Owns |
|------|------|
| `catalog.js` | Product listing, search, filters, sorting, related products |
| `cart.js` | Guest and member baskets, quantities, coupons, delivery fee, totals |
| `orders.js` | Checkout, payments, the order status machine, stock return |
| `users.js` | Register, login, sessions, addresses, wishlist, reviews |
| `admin.js` | Dashboard numbers, product/stock/coupon/order management |

Here is a real rule from `cart.js` — notice it knows nothing about HTTP, it
just enforces the rule and throws if it is broken:

```js
export function addItem(cartId, productId, qty = 1) {
  const product = get(`SELECT price_cents, stock, status, name FROM products WHERE id = ?`, productId);
  if (!product) throw notFound("Product not found");
  if (product.status !== "active") throw conflict("This item is no longer on sale");
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const existing = get(`SELECT qty FROM cart_items WHERE cart_id = ? AND product_id = ?`, cartId, productId)?.qty || 0;
  const next = existing + n;
  if (next > product.stock) {
    throw conflict(`Only ${product.stock} left in stock`, { qty: `Maximum ${product.stock}` });
  }
  setLine(cartId, productId, next);
  touch(cartId);
  return summary(cartId);
}
```

The hardest piece was checkout (`orders.js`, line 42). The trick is to check
stock **twice**: once to give a quick error, then again *inside* the
transaction, because another shopper may have bought the last item in the
milliseconds between:

```js
return tx(() => {
  // re-check inside the transaction — another request may have taken the stock
  for (const l of lines) {
    const live = get(`SELECT stock, status FROM products WHERE id = ?`, l.product_id);
    if (live.stock < l.qty) throw conflict(`Not enough stock for ${l.name} — only ${live.stock} left`);
  }
  // …insert order, order items, payment, inventory movements, coupon use,
  //   mark cart converted — all or nothing
});
```

If any line throws, `tx()` rolls everything back. There is never a
half-placed order.

> **Rule worth stealing:** prices, totals and stock are always calculated on
> the server. The browser can show a total, but the server never trusts one
> sent from the browser.

---

## Step 6 — The API routes (`api.js`)

Now the domain functions get web addresses. Each route is short: read the
request, call one domain function, return the result.

```js
api.post("/api/cart/items", (ctx) => {
  const cart = cartOf(ctx);
  const id = Number(ctx.body?.product_id ?? ctx.body?.productId);
  if (!id) throw badRequest("product_id is required");
  Cart.addItem(cart.id, id, ctx.body?.qty ?? 1);
  logEvent("cart.add", { userId: ctx.user?.id || null, productId: id });
  return Cart.summary(cart.id);
});
```

Permission checks are one-liners at the top of a handler:

```js
const needAdmin = (ctx) => {
  if (!ctx.user) throw unauthorized("Sign in as an administrator");
  if (ctx.user.role !== "admin") throw forbidden("Administrator only");
  return ctx.user;
};
```

The complete list of endpoints is in [03-backend-api.md](03-backend-api.md).

---

## Step 7 — The server entry point (`server.js`)

The smallest file, written last on the backend because it just wires the
others together:

```js
migrate();                                     // run schema.sql (safe every boot)

const server = createServer(async (req, res) => {
  ctx = await buildContext(req, res);          // parse URL, cookies, body
  authenticate(ctx);                           // who is this?
  const hit = api.match(ctx.method, ctx.path); // which route?
  if (ctx.path.startsWith("/api/")) {
    const out = await hit.handler(ctx);        // run it
    sendJson(ctx, ctx.status || 200, out);     // send JSON
    return;
  }
  await serveStatic(ctx);                      // otherwise it's a file
});                                            // (errors → sendError, see the file)

server.listen(config.port, config.host);
```

Every request goes through this one path, which is why logging and error
handling only had to be written once.

---

## Step 8 — Demo data (`seed.js`)

An empty shop cannot be tested. `seed.js` inserts 10 categories, 35 products
with real Ethiopian items and prices, 8 delivery zones, 4 coupons, an admin,
five shoppers, reviews and a dozen past orders — and generates a coloured SVG image
for every product so nothing appears broken.

It only seeds an **empty** database (`npm run seed`), and `npm run reset`
wipes and rebuilds it. Write a seed script early in every project; you will
run it hundreds of times.

---

## Step 9 — Prove the whole backend with curl

Before any HTML existed, the full shopping journey was run from the terminal.
The `-c`/`-b` flags save and send cookies, exactly like a browser would:

```bash
# 1 · health
curl -s http://127.0.0.1:4000/api/health

# 2 · add a product to a guest basket (the server issues a cart cookie)
curl -s -c jar.txt -b jar.txt -X POST http://127.0.0.1:4000/api/cart/items \
     -H "content-type: application/json" -d '{"product_id":1,"qty":2}'

# 3 · ask for something impossible — expect a 409 with a clear message
curl -s -c jar.txt -b jar.txt -X POST http://127.0.0.1:4000/api/cart/items \
     -H "content-type: application/json" -d '{"product_id":1,"qty":9999}'
```

Both the happy path and the error paths were tested. A backend is not done
when it works; it is done when it **fails correctly**.

---

## Step 10 — The frontend toolkit (`core.js`)

The first browser file is the shared toolkit used by both the shop and the
admin console. Its most important function wraps `fetch` so that every API
error becomes a normal JavaScript error with the server's message:

```js
async function call(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status; err.fields = data?.fields || null;
    throw err;
  }
  return data;
}
export const api = { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), … };
```

So page code can simply write:

```js
try { await api.post("/cart/items", { product_id: 7 }); toast("Added"); }
catch (e) { toast(e.message, true); }   // "Only 3 left in stock"
```

`core.js` also holds money formatting (`ETB(1250)` → `12.50 ETB`), HTML
escaping (`esc()` — always used before putting user text into HTML), the
translations (`t("add")`), product cards, and the **hash router** — the piece
that makes one HTML page behave like many:

```js
export function router(routes, fallback) {
  const dispatch = async () => {
    const path = (location.hash || "#/").replace(/^#/, "").split("?")[0];
    for (const [pattern, handler] of Object.entries(routes)) {
      // "/product/:slug" → regex → { slug: "harar-longberry" }
      ...
    }
  };
  window.addEventListener("hashchange", dispatch);   // URL changed → re-render
  dispatch();
}
```

---

## Step 11 — The page shell and design system

`index.html` holds only what never changes: top bar, header (logo, search,
language toggle, basket), an empty `<main id="view">` and the footer. Every
page is drawn into `#view` by JavaScript.

`styles.css` starts with **design tokens** — named colours and sizes used
everywhere, so a brand change is a one-line edit:

```css
:root {
  --ink: #16130f;        /* text */
  --paper: #fbf7f0;      /* injera-cream background */
  --brand: #0f6b4f;      /* coffee-leaf green */
  --gold: #d9a441;
  --chili: #c0392b;      /* berbere red — sale and error */
  --r: 14px;             /* standard corner radius */
}
.btn.p { background: var(--brand); color: #fff; border-radius: var(--r); }
```

Layout uses CSS Grid and Flexbox, and a few `@media` rules collapse the
layout for phones. No CSS framework.

---

## Step 12 — The storefront pages (`app.js`)

Each page is one function: fetch data, then write HTML into `#view`.

```js
async function Home() {
  const h = await api.get("/home");                 // 1 · data from the API
  view().innerHTML = `
    <section class="hero"> … ${t("hero_h1")} … </section>
    <div class="grid">${h.newArrivals.map((p) => productCard(p)).join("")}</div>`;   // 2 · render
}

const routes = {
  "/": Home, "/shop": Shop, "/product/:slug": Product,
  "/account/:tab": Account, "/login": () => Auth("login"), …
};
router(routes, NotFound);          // NotFound draws the "Page not found" card
```

Buttons on cards are handled by **one** listener on the whole document
(event delegation), so cards drawn later still work:

```js
document.addEventListener("click", async (e) => {
  const add = e.target.closest("[data-add]");     // any "Add to basket" button
  if (add) { e.preventDefault(); await addToCart(Number(add.dataset.add), 1); }
});
```

Build order inside the storefront: Home → Shop (list + filters) → Product
page → Basket → Checkout → Account → search suggestions → Amharic toggle.
Each was finished and clicked through before starting the next.

---

## Step 13 — The admin console

A second small app at `/admin` reusing `core.js`. On start it asks the server
who is signed in, and refuses shoppers:

```js
const me = await api.get("/me");
if (!me.user) return Gate();
if (me.user.role !== "admin") return Gate("That account is a shopper, not a staff member.");
```

This check is for **convenience only**. The real protection is `needAdmin()`
on every `/api/admin/*` route on the server — never rely on hiding a button.

---

## Step 14 — Test in a real browser and fix what breaks

Every flow was then driven in a real browser. These are the actual bugs found
— each one is a lesson you will meet again:

| Bug seen | Real cause | Lesson |
|----------|-----------|--------|
| Edited JS but the page kept the old behaviour | Server sent `Cache-Control: max-age=3600` for JS in development | Send `no-cache` in dev; hard-reload with **Ctrl+Shift+R** |
| Toast read "Added · 1 1 item(s)" | The translation already inserted the number; the code added it again | Read your helper before calling it |
| Guest created an account at checkout but the order didn't show under "My orders" | Account was created *after* the order, so the order had no owner | Do things in the order the data needs: account first, then order |
| "Pay now" button never appeared for telebirr | Code checked for status `unpaid` but the real status was `authorized` | Log the real data (`console.log(order)`) instead of guessing it |
| "+ New coupon" button stayed visible on other admin pages | Page header wasn't cleared on navigation | Each page should reset what it shares |
| Some Amharic letters went missing | Text was corrupted while being typed into files | Verify non-English text after saving; reuse checked strings |

How each was found: **DevTools** (press F12). The *Console* tab shows
JavaScript errors, the *Network* tab shows each API request with its status
and response, and *Application → Cookies* shows the session.

---

## Step 15 — Write it down

Last, the README (how to run it in 60 seconds) and these docs. Write docs
while the reasons are still fresh — six months later you won't remember why
stock is checked twice.

---

## Use this order on your next project

1. Write what the user does in 5 sentences.
2. List the nouns → tables. Write `schema.sql`. Run it twice.
3. Connection + `all/get/run/tx` helpers.
4. Errors, router, request context.
5. Password hashing + sessions (if the app has accounts).
6. One domain file per area of the business. Rules throw errors.
7. Routes: thin wrappers that call domain functions.
8. Entry point that wires it together.
9. Seed script.
10. Test every endpoint with curl — success *and* failure.
11. Frontend: API client + router + helpers first.
12. HTML shell + CSS tokens.
13. One page at a time, finished before the next.
14. Click through everything with DevTools open.
15. README + docs.

The skills and commands needed for each step are listed in
[07-skills-and-commands.md](07-skills-and-commands.md).
