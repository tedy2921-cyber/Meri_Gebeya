/* =============================================================================
   core.js — shared browser toolkit for Meri Gebeya (storefront + admin).
   Plain ES module. No build step, no dependencies.
   ============================================================================= */

export const API = "/api";

/* ---------------------------------------------------------------- requests */

async function call(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API + path, opts);
  } catch {
    const err = new Error("You appear to be offline — check your connection.");
    err.status = 0;
    throw err;
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = data?.fields || null;
    throw err;
  }
  return data;
}
const safeJson = (t) => { try { return JSON.parse(t); } catch { return { raw: t }; } };

export const api = {
  get: (p) => call("GET", p),
  post: (p, b) => call("POST", p, b),
  patch: (p, b) => call("PATCH", p, b ?? {}),
  del: (p) => call("DELETE", p),
  qs: (obj) => Object.entries(obj || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&"),
};

/* ------------------------------------------------------------------ money  */

export const ETB = (cents) =>
  new Intl.NumberFormat("en-ET", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format((Number(cents) || 0) / 100) + " ETB";

export const etbShort = (cents) => {
  const v = (Number(cents) || 0) / 100;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M ETB";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K ETB";
  return v.toFixed(0) + " ETB";
};

export const num = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);

export const dateShort = (iso) => iso
  ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
export const dateTime = (iso) => iso
  ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const ago = (iso) => {
  if (!iso) return "—";
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
};

/* --------------------------------------------------------------------- i18n */

export const STRINGS = {
  en: {
    home: "Home", shop: "Shop", cart: "Cart", account: "My account", search: "Search coffee, teff, berbere…",
    add: "Add to cart", added: "Added to your basket", buy: "Buy now", checkout: "Checkout",
    subtotal: "Subtotal", discount: "Discount", delivery: "Delivery", total: "Total", free: "Free",
    continue_shop: "Continue shopping", empty_cart: "Your basket is empty",
    in_stock: "In stock", out_stock: "Out of stock", low_stock: "Only {n} left",
    best_sellers: "Best sellers", new_arrivals: "New arrivals", on_sale: "On sale", shop_all: "Shop all",
    categories: "Categories", deals: "Today's deals", results: "{n} products", filters: "Filters",
    sort: "Sort", price: "Price", rating: "Rating", newest: "Newest", popular: "Popular",
    related: "You may also like", also_bought: "Frequently bought together",
    reviews: "Reviews", description: "Description", delivery_info: "Delivery",
    apply: "Apply", coupon: "Coupon code", remove: "Remove", qty: "Quantity",
    place_order: "Place order", review_order: "Review order", shipping_address: "Shipping address",
    payment: "Payment", sign_in: "Sign in", register: "Create account", email: "Email", password: "Password",
    name: "Full name", phone: "Phone", city: "City", region: "Region", subcity: "Sub city / kebele",
    woreda: "Woreda", landmark: "Nearest landmark", instructions: "Delivery instructions",
    order_placed: "Your order is placed", track: "Track order", orders: "Orders", wishlist: "Wishlist",
    addresses: "Addresses", profile: "Profile", log_out: "Sign out", save: "Save", cancel: "Cancel",
    or: "or", guest: "Continue as guest", total_items: "{n} item(s)",
    hero_kicker: "🇪🇹 From the gebeya, today",
    hero_h1: 'Fresh <span>coffee</span>, clean <span>teff</span> and real <span>berbere</span> — delivered across Ethiopia.',
    hero_lead: "We buy directly from roasters, millers and weavers. Order before 2pm and your basket is at your door the same afternoon in Addis Ababa.",
    stat_products: "products in stock", stat_categories: "categories", stat_delivery: "Addis delivery",
    stat_sellers: "Ethiopian sellers", browse_all: "Browse everything \u2192",
    best_note: "What Addis ordered this week", see_all: "See all",
    sale_note: "Limited stock, marked down by the seller", new_note: "Just landed in the gebeya",
    stat_eta: "4h",
  },
  am: {
    home: "መነሻ", shop: "ገበያ", cart: "ጋሪ", account: "መለያዬ", search: "ቡና፣ ጤፍ፣ በርበሬ ይፈልጉ…",
    add: "ወደ ጋሪ ጨምር", added: "ወደ ጋሪ ጨምሯል", buy: "አሁን ይግዙ", checkout: "ክፍያ ይጨርሱ",
    subtotal: "ንዑስ ድምር", discount: "ቅናሽ", delivery: "ማድረሻ", total: "ጠቅላላ", free: "ነፃ",
    continue_shop: "ግዢ ይቀጥሉ", empty_cart: "ጋሪዎ ባዶ ነው",
    in_stock: "በክምሩ ውስጥ አለ", out_stock: "አልቋል", low_stock: "{n} ብቻ ቀርቷል",
    best_sellers: "በብዛት የተገዙ", new_arrivals: "አዲስ የመጡ", on_sale: "ቅናሽ ላይ", shop_all: "ሁሉንም ይመልከቱ",
    categories: "ምድቦች", deals: "የዛሬ ቅናሾች", results: "{n} ምርቶች", filters: "ማጣሪያ",
    sort: "ድርድር", price: "ዋጋ", rating: "ደረጃ", newest: "አዲስ", popular: "ተወዳጅ",
    related: "እነሱም ሊወዷቸው ይችላሉ", also_bought: "አብረው የሚገዙ",
    reviews: "አስተያየቶች", description: "መግለጫ", delivery_info: "ማድረሻ",
    apply: "ተግብር", coupon: "የኩፖን ኮድ", remove: "አስወግድ", qty: "ብዛት",
    place_order: "ትዕዛዝ ይስጡ", review_order: "ትዕዛዝ ይጣሩ", shipping_address: "የማድረሻ አድራሻ",
    payment: "ክፍያ", sign_in: "ግባ", register: "መለያ ይፍጠሩ", email: "ኢሜይል", password: "የይለፍ ቃል",
    name: "ሙሉ ስም", phone: "ስልክ", city: "ከተማ", region: "ክልል", subcity: "ክፍለ ከተማ",
    woreda: "ወረዳ", landmark: "የሚታወቅ ማመልከቻ", instructions: "የማድረሻ መመሪያ",
    order_placed: "ትዕዛዝዎ ደርሷል", track: "ትዕዛዝ ይከታተሉ", orders: "ትዕዛዞች", wishlist: "የምኞት ዝርዝር",
    addresses: "አድራሻዎች", profile: "መገለጫ", log_out: "ውጣ", save: "አስቀምጥ", cancel: "ሰርዝ",
    or: "ወይም", guest: "እንደ እንግዳ ይቀጥሉ", total_items: "{n} ዕቃ(ዎች)",
  },
};

/* Amharic marketing copy reuses the verified UI strings above instead of
   duplicating Ge-ez text by hand. Anything not listed falls back to English. */
Object.assign(STRINGS.am, {
  browse_all: STRINGS.am.shop_all + " \u2190",
  see_all: STRINGS.am.shop_all,
  stat_categories: STRINGS.am.categories,
  stat_delivery: STRINGS.am.delivery,
  stat_products: STRINGS.am.results.replace("{n}", "").trim(),
  best_note: STRINGS.am.best_sellers,
  sale_note: STRINGS.am.on_sale,
  new_note: STRINGS.am.new_arrivals,
  hero_kicker: STRINGS.am.shop + " \u00b7 " + STRINGS.am.deals,
});

export const store = {
  get lang() { return localStorage.getItem("mg-lang") || "en"; },
  set lang(v) {
    localStorage.setItem("mg-lang", v === "am" ? "am" : "en");
    document.documentElement.lang = v === "am" ? "am" : "en";
  },
};

export const t = (key, vars) => {
  const s = (STRINGS[store.lang] || STRINGS.en)[key] || STRINGS.en[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : s;
};
export const pick = (row, field) => (store.lang === "am" && row?.[field + "_am"]) ? row[field + "_am"] : row?.[field];

/* ------------------------------------------------------------------ helpers */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export const stars = (avg = 0, count = 0) => {
  const full = Math.round(Number(avg));
  return `<span class="stars" title="${Number(avg).toFixed(1)} of 5">${
    "★".repeat(full) + "☆".repeat(5 - full)} <small>(${count})</small></span>`;
};

export const initials = (name = "?") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/* ------------------------------------------------------------------- toast  */

let toastTimer;
export function toast(message, bad = false) {
  const node = $("#toast");
  if (!node) { alert(message); return; }
  node.textContent = message;
  node.classList.toggle("bad", bad);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
}

/* ------------------------------------------------------------------- modal  */

export function modal({ title, body, okLabel = "Save", cancelLabel = "Cancel", wide = false, onOk, onCancel }) {
  const host = $("#modal");
  host.classList.toggle("wide", wide);
  host.innerHTML = "";
  const box = el(`<div class="box">
    <div class="spread" style="margin-bottom:14px"><h3 style="margin:0">${esc(title)}</h3>
      <button class="btn ghost" data-x aria-label="Close">✕</button></div>
    <div data-body></div>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      <button class="btn" data-c>${esc(cancelLabel)}</button>
      <button class="btn p" data-ok>${esc(okLabel)}</button>
    </div></div>`);
  box.querySelector("[data-body]").innerHTML = body;
  host.append(box);
  host.hidden = false;
  const close = () => { host.hidden = true; host.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") { onCancel?.(); close(); } };
  box.querySelector("[data-x]").onclick = () => { onCancel?.(); close(); };
  box.querySelector("[data-c]").onclick = () => { onCancel?.(); close(); };
  box.querySelector("[data-ok]").onclick = async () => {
    const ok = await onOk?.(box.querySelector("[data-body]"), close);
    if (ok !== false) close();
  };
  host.onclick = (e) => { if (e.target === host) { onCancel?.(); close(); } };
  document.addEventListener("keydown", onKey);
  setTimeout(() => box.querySelector("input,select,textarea")?.focus(), 40);
  return { close, box };
}

export function confirmBox(message, okLabel = "Yes") {
  return new Promise((resolve) => {
    modal({
      title: "Please confirm",
      okLabel,
      body: `<p>${esc(message)}</p>`,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/* --------------------------------------------------------------- form utils */

/** Turn a server {fields:{name:message}} error into inline messages. */
export function paintErrors(root, fields) {
  $$(".field", root).forEach((f) => {
    f.classList.remove("bad");
    f.querySelector(".err")?.remove();
  });
  for (const [key, message] of Object.entries(fields || {})) {
    const input = root.querySelector(`[name="${key}"]`);
    const field = input?.closest(".field");
    if (!field) continue;
    field.classList.add("bad");
    field.append(el(`<span class="err">${esc(message)}</span>`));
    input?.focus();
  }
}

export const formValues = (root) => Object.fromEntries(
  $$("input,select,textarea", root)
    .filter((i) => i.name)
    .map((i) => [i.name, i.type === "checkbox" ? i.checked : i.value]));

export const field = (name, label, input, hint = "") =>
  `<div class="field"><label>${esc(label)}</label>${input}${hint ? `<small class="muted">${esc(hint)}</small>` : ""}</div>`;

export const moneyInput = (name, label, value = "", extra = "") =>
  field(name, label, `<div class="rangewrap"><span>ETB</span><input name="${name}" type="number" step="0.01" min="0" value="${value}" ${extra}></div>`);

/* ---------------------------------------------------------------- status map */

export const ORDER_STATUS = {
  pending: { label: "Pending", cls: "chip sale", next: ["confirmed", "cancelled"] },
  confirmed: { label: "Confirmed", cls: "chip hot", next: ["packing", "cancelled"] },
  packing: { label: "Packing", cls: "chip hot", next: ["shipped", "cancelled"] },
  shipped: { label: "On the way", cls: "chip new", next: ["delivered", "cancelled"] },
  delivered: { label: "Delivered", cls: "chip ok", next: ["refunded"] },
  cancelled: { label: "Cancelled", cls: "chip out", next: ["refunded"] },
  refunded: { label: "Refunded", cls: "chip out", next: [] },
};

export const statusChip = (status) => {
  const s = ORDER_STATUS[status] || { label: status, cls: "chip" };
  return `<span class="${s.cls}">${esc(s.label)}</span>`;
};

/* --------------------------------------------------------------- shared bits */

export const money = (cents) => `<b>${ETB(cents)}</b>`;

export function priceRow(row) {
  const now = row.price_cents ?? row.unit_price_cents;
  const was = row.compare_at_price_cents;
  const save = was && was > now ? Math.round((1 - now / was) * 100) : 0;
  return `<div class="price"><b>${ETB(now)}</b>${was && was > now ? `<s>${ETB(was)}</s><span class="save">-${save}%</span>` : ""}</div>`;
}

export function stockChip(row) {
  if ((row.stock ?? 0) <= 0) return `<span class="chip out">${t("out_stock")}</span>`;
  if (row.stock <= (row.low_stock_at ?? 5)) return `<span class="chip low">${t("low_stock", { n: row.stock })}</span>`;
  return `<span class="chip ok">${t("in_stock")}</span>`;
}

export const thumb = (row, cls = "") =>
  `<img src="${esc(row.image_url || "/img/placeholder.svg")}" alt="${esc(pick(row, "name") || "")}" class="${cls}" loading="lazy"
     onerror="this.onerror=null;this.src='/img/placeholder.svg'">`;

export function productCard(row, { wish = false } = {}) {
  const was = row.compare_at_price_cents;
  const save = was && was > row.price_cents ? Math.round((1 - row.price_cents / was) * 100) : 0;
  const soldRecently = row.recent_orders ?? row.sold7 ?? null;
  return `<a class="pcard" href="#/product/${esc(row.slug)}">
  <div class="shot">${thumb(row)}
    <div class="flags">
      ${save ? `<span class="chip sale">-${save}%</span>` : ""}
      ${row.featured ? `<span class="chip hot">Popular</span>` : ""}
      ${(row.stock ?? 0) <= 0 ? `<span class="chip out">${t("out_stock")}</span>` : ""}
      ${soldRecently >= 3 ? `<span class="chip new">${soldRecently} sold this week</span>` : ""}
    </div>
    ${wish ? `<button class="wish" data-wish="${row.id}" title="Save for later">♡</button>` : ""}
  </div>
  <div class="body">
    <span class="cat">${esc(row.category_name || row.brand || "")}</span>
    <h3>${esc(pick(row, "name"))}</h3>
    ${store.lang === "am" && row.name ? `<span class="am tiny muted">${esc(row.name)}</span>` : ""}
    ${stars(row.rating_avg, row.rating_count)}
    <div class="price"><b>${ETB(row.price_cents)}</b>${save ? `<s>${ETB(was)}</s>` : ""}</div>
    <div class="foot">
      <button class="btn p sm grow" data-add="${row.id}" ${(row.stock ?? 0) <= 0 ? "disabled" : ""}>${t("add")}</button>
    </div>
  </div></a>`;
}

/* --------------------------------------------------------------- app running */

export function bootNav({ onLang, onSearch }) {
  const langBtn = $("#langBtn");
  langBtn.onclick = () => {
    store.lang = store.lang === "en" ? "am" : "en";
    langBtn.textContent = store.lang === "en" ? "አማርኛ" : "English";
    onLang?.();
  };
  langBtn.textContent = store.lang === "en" ? "አማርኛ" : "English";
  document.documentElement.lang = store.lang === "am" ? "am" : "en";

  const form = $("#searchForm"), input = $("#q");
  form.onsubmit = (e) => { e.preventDefault(); onSearch?.(input.value.trim()); };
}

export function debounce(fn, ms = 240) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/** Lightweight hash router: routes are { "/product/:slug": handler }. */
export function router(routes, fallback) {
  let currentCleanup = null;
  const dispatch = async () => {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const [pathPart, queryPart] = raw.split("?");
    const path = pathPart.replace(/\/$/, "") || "/";
    const query = Object.fromEntries(new URLSearchParams(queryPart || ""));
    currentCleanup?.();
    for (const [pattern, handler] of Object.entries(routes)) {
      const names = [];
      const rx = new RegExp("^" + pattern.replace(/\//g, "\\/").replace(/:(\w+)/g, (_, k) => {
        names.push(k); return "([^/]+)";
      }) + "$");
      const m = rx.exec(path);
      if (m) {
        const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        currentCleanup = (await handler({ params, query, path })) || null;
        return;
      }
    }
    currentCleanup = (await fallback?.({ path, query })) || null;
  };
  window.addEventListener("hashchange", dispatch);
  dispatch();
  return { refresh: dispatch };
}
