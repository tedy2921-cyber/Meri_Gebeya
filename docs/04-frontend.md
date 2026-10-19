# 04 · The frontend

Two single-page apps that share one toolkit. No framework, no bundler, no build step — the
browser loads real ES modules, so **view-source is the actual source**.

```
public/
├── index.html          storefront shell  (loads assets/app.js)
├── admin.html          seller console    (loads assets/admin.js)
└── assets/
    ├── core.js         373 lines · shared by both apps
    ├── app.js          1,085 lines · storefront pages
    ├── admin.js        776 lines · console pages
    ├── styles.css      449 lines · design system + storefront
    └── admin.css       97 lines · console-only overrides
```

## Why this shape

- **`core.js` holds anything both apps need** — the fetch client, money/date formatting, i18n,
  the toast/modal primitives, the product card, the router. Neither app duplicates it.
- **A page is an `async function`** that fetches, writes HTML into `#view`, then wires its own
  controls. That is the whole architecture, and it stays readable at 1,000 lines.
- **HTML strings are fine here because every interpolation is escaped** with `esc()` (or
  `thumb()`/`productCard()`, which escape internally). Data only ever comes from our own API.
- **The hash router** means the server only ever serves two HTML files. Refresh, back/forward
  and shareable links work with zero server routing.

## Startup, in order

1. `index.html` renders the header, footer and an empty `#view`, then loads `app.js` as a module.
2. `start()` paints skeleton blocks (`.skel`) so the page never flashes empty.
3. `loadShell()` fetches `/api/meta` and `/api/me` **in parallel**, fills the category nav and
   footer, applies the saved language, and sets the cart badge.
4. `bootNav()` wires the language toggle and the search form.
5. `router(routes, NotFound)` runs the handler for the current hash and keeps running on every
   `hashchange`.

If `/api/meta` fails (server not started), the user gets a friendly page that says to run
`npm start` — not a blank screen.

## State

```js
const S = {
  meta:  null,   // zones, categories, payment providers, price bounds  (one fetch)
  me:    null,   // signed-in user or null
  cart:  null,   // the server's cart summary — the client never computes totals
  draft: { step: 0, zone_id: null, payment_method: "cod", ship: {}, email: "", instructions: "" },
};
```

`S.cart` is the important decision: **the basket lives on the server**. Every mutation returns a
fresh summary, so the badge, the totals and the coupon state can never drift from what the
database will actually charge. `S.draft` only holds what a shopper is mid-way through typing in
checkout.

## Routing

```js
const routes = {
  "/": Home,   "/shop": Shop,   "/product/:slug": Product,
  "/cart": Cart, "/checkout": Checkout, "/order/:id": Order, "/track": Track,
  "/account": Account, "/account/:tab": Account,
  "/login": () => Auth("login"), "/register": () => Auth("register"),
};
```

`router()` turns `:slug` into a capture group, calls `handler({ params, query, path })`, and —
if a handler returns a function — runs it as a cleanup before the next navigation. It also
returns `{ refresh }`, which the language toggle uses to re-render the current page in the new
language.

## The `core.js` toolkit

| Group | Exports |
| --- | --- |
| Networking | `api.get/post/patch/del/qs` — JSON in, JSON out, `credentials: "include"`, throws `Error` carrying `status` and `fields` |
| Money & time | `ETB(cents)`, `etbShort(cents)`, `num(n)`, `dateShort`, `dateTime`, `ago` |
| i18n | `STRINGS`, `store.lang`, `t(key, vars)`, `pick(row, "name")` |
| DOM | `$`, `$$`, `esc`, `el`, `stars`, `thumb`, `productCard`, `statusChip`, `stockChip` |
| Feedback | `toast(msg, isError)`, `modal({ title, body, onOk })`, `confirmBox`, `paintErrors`, `formValues`, `field`, `moneyInput` |
| Navigation | `router`, `bootNav`, `debounce` |

`api.qs({ q: "teff", per: 12 })` builds a query string and drops empty values, which is why the
shop URL stays clean when filters are untouched.

## Two things worth stealing

**Server-driven checkout steps.** `Checkout()` renders one of three panels from `S.draft.step`.
Each panel validates only its own fields and stores them in the draft; the totals in the sidebar
come from `/api/cart` every time. Nothing about price is ever decided in the browser, so
DevTools tampering buys nothing.

**Delegated cart buttons.** Instead of wiring every `+`/`♥` in every product card:

```js
document.addEventListener("click", async (e) => {
  const add = e.target.closest("[data-add]");
  if (add) { e.preventDefault(); await addToCart(Number(add.dataset.add)); }
});
```

Cards can be re-rendered freely and the handlers still work.

## Styling

`styles.css` starts with the design tokens and everything else references them:

```css
:root {
  --brand: #0f6b4f;  /* coffee-leaf green */   --gold:  #d9a441;
  --chili: #c0392b;  /* berbere red */         --berry: #7b2d5e;
  --paper: #fbf7f0;  /* injera cream */        --ink:   #16130f;
  --r: 14px; --shadow: …; --font: "Segoe UI", Ebrima, Noto Sans, "Noto Sans Ethiopic", …;
}
```

Component classes are small and composable: `.btn p|g|d|ghost|sm|big|blk`, `.pcard`, `.tile`,
`.chip ok|low|out|sale|hot`, `.panel`, `.field`, `.steps`, `.timeline`, `.chart`, `.hbars`,
`.skel`, `.empty`, `.banner warn|bad`. Layout is grid/flex with breakpoints at 1020 px and
680 px, plus a `@media print` block that turns the order page into a clean receipt.

The font stack names **Ebrima** (ships with Windows) and **Noto Sans Ethiopic** so Ge'ez script
renders properly; the verified layout has no horizontal overflow down to 286 px wide.

Charts are pure CSS — `.chart` bars take an inline `height:%`, `.hbars` a `width:%`. No chart
library, no extra 200 KB.

## Amharic

Two mechanisms, used together:

1. **UI strings** — `t("checkout")` looks in `STRINGS.am`, falls back to `STRINGS.en`, then to
   the key itself. `store.lang` persists in `localStorage` and, once a shopper has a profile,
   the server's `users.lang` seeds it on first load.
2. **Data** — bilingual columns (`name`/`name_am`, `description`/`description_am`,
   `label`/`label_am`) read through `pick(row, "name")`, so any row missing a translation shows
   English instead of blank.

The toggle re-renders the current route, so headings, nav, cart labels and buttons all switch at
once. Product names, category names, delivery zones and payment labels come from the database
already translated. Marketing hero copy intentionally falls back to English — see
`docs/05-roadmap.md` for the translation workflow.

## The admin console

Same toolkit, different shell (`admin.html` + `admin.css`). `start()` calls `/api/me`; anything
other than an admin role renders the sign-in gate with a clear message. After that it loads the
category list once into `window.__cats`, paints the sidebar, and routes:

```
#/            Dashboard      #/orders        #/orders/:id
#/products    #/products/:id #/categories    #/customers
#/coupons     #/reviews      #/inventory     #/events
```

Each page calls `title(name, hint)` — which also clears the header's action slot — then
`actions(html)` for its own buttons, and re-renders a table into `#view`. Editing happens in
`modal()` dialogs built with the same `field()` helper, so the console and the storefront look
like one product.

## Adding a page

1. Write `async function Wishlist() { view().innerHTML = … }` in `app.js`.
2. Register it: `"/wishlist": Wishlist` in `routes`.
3. Link it: `<a href="#/wishlist">`.
4. If it needs a new endpoint, add it to `api.js` and call it with `api.get("/wishlist")`.

No imports to configure, no chunks to name, no cache to invalidate in development — the server
sends `no-cache` for every asset while `NODE_ENV !== "production"`.
