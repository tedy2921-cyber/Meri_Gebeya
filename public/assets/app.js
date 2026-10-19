/* =============================================================================
   app.js — Meri Gebeya storefront.
   Hash-routed SPA: home · shop · product · cart · checkout · order · account.
   Talks to the JSON API only; nothing here knows SQL.
   ============================================================================= */

import {
  api, ETB, etbShort, num, dateShort, dateTime, t, pick, store, $, $$, esc, el,
  stars, toast, modal, confirmBox, paintErrors, formValues, field, statusChip,
  stockChip, thumb, productCard, bootNav, debounce, router, ORDER_STATUS,
} from "./core.js";

const S = {
  meta: null,          // zones, categories, providers, bounds
  me: null,            // signed-in user or null
  cart: null,          // server-side cart summary
  draft: { step: 0, zone_id: null, payment_method: "cod", ship: {}, email: "", phone: "", instructions: "" },
};

const view = () => $("#view");
const go = (path) => { location.hash = "#" + path; };

/* ------------------------------------------------------------------- session */

async function loadShell() {
  const [meta, me] = await Promise.all([api.get("/meta"), api.get("/me")]);
  S.meta = meta;
  S.me = me.user;
  S.cart = me.cart;
  if (me.user?.lang && !localStorage.getItem("mg-lang")) store.lang = me.user.lang === "am" ? "am" : "en";

  $("#catNav").innerHTML = `<a href="#/shop" class="${location.hash === "#/shop" ? "on" : ""}">${t("shop_all")}</a>` +
    meta.categories.map((c) => `<a href="#/shop?category=${encodeURIComponent(c.slug)}">${esc(pick(c, "name"))}</a>`).join("");

  $("#footCats").innerHTML = meta.categories.slice(0, 6)
    .map((c) => `<li><a href="#/shop?category=${encodeURIComponent(c.slug)}">${esc(pick(c, "name"))}</a></li>`).join("");
  $("#year").textContent = new Date().getFullYear();
  badge();
}

function badge() {
  const b = $("#cartBadge");
  const n = S.cart?.item_count || 0;
  b.textContent = n;
  b.dataset.n = n;
}

async function setCart(summary) {
  S.cart = summary;
  badge();
}

/* ------------------------------------------------------------------ cart ops */

async function addToCart(productId, qty = 1) {
  try {
    const s = await api.post("/cart/items", { product_id: productId, qty });
    await setCart(s);
    toast(`${t("added")} · ${t("total_items", { n: s.item_count })}`);
    return s;
  } catch (e) { toast(e.message, true); return null; }
}

async function toggleWish(productId, btn) {
  if (!S.me) { toast("Sign in to save items for later"); go("/login"); return; }
  try {
    const r = await api.post(`/wishlist/${productId}`);
    if (btn) btn.textContent = r.saved ? "♥" : "♡";
    toast(r.saved ? "Saved to your wishlist" : "Removed from wishlist");
  } catch (e) { toast(e.message, true); }
}

/* -------------------------------------------------------------------- search */

const suggest = debounce(async (q) => {
  const box = $("#suggest");
  if (q.length < 2) { box.innerHTML = ""; return; }
  try {
    const r = await api.get("/suggest?" + api.qs({ q }));
    if (!r.products.length && !r.categories.length) { box.innerHTML = ""; return; }
    box.innerHTML =
      r.products.map((p) => `<a href="#/product/${esc(p.slug)}">${thumb(p)}
        <span class="grow"><b>${esc(pick(p, "name"))}</b><br><small class="muted">${ETB(p.price_cents)}</small></span></a>`).join("") +
      (r.categories.length ? `<div class="group">Categories</div>` +
        r.categories.map((c) => `<a href="#/shop?category=${encodeURIComponent(c.slug)}">🗂 ${esc(pick(c, "name"))}</a>`).join("") : "");
  } catch { box.innerHTML = ""; }
}, 220);

/* ======================================================================= HOME */

async function Home() {
  const h = await api.get("/home");
  const coffeeCat = h.categories.find((c) => c.slug === "coffee-tea") || h.categories[0] || {};
  view().innerHTML = `
  <section class="hero">
    <div>
      <span class="kicker">${t("hero_kicker")}</span>
      <h1>${t("hero_h1")}</h1>
      <p class="lead">${t("hero_lead")}</p>
      <div class="row" style="margin-top:6px">
        <a class="btn p big" href="#/shop?sort=popular">${t("shop_all")}</a>
        <a class="btn big" href="#/shop?category=coffee-tea">☕ ${esc(pick(coffeeCat, "name"))}</a>
      </div>
      <div class="stats">
        <div><b>${h.categories.reduce((n, c) => n + c.product_count, 0)}</b><span class="muted small">${t("stat_products")}</span></div>
        <div><b>${h.categories.length}</b><span class="muted small">${t("stat_categories")}</span></div>
        <div><b>${t("stat_eta")}</b><span class="muted small">${t("stat_delivery")}</span></div>
        <div><b>100%</b><span class="muted small">${t("stat_sellers")}</span></div>
      </div>
    </div>
    <div class="art">${thumb(h.hero[0] || {})}</div>
  </section>

  <section class="section">
    <div class="section-head"><h2>${t("categories")}</h2>
      <a class="small" href="#/shop">${t("browse_all")}</a></div>
    <div class="tiles">${h.categories.map((c) => `
      <a class="tile" href="#/shop?category=${encodeURIComponent(c.slug)}">
        <span class="ico">${esc(c.icon || "🧺")}</span><b>${esc(pick(c, "name"))}</b>
        <span>${esc(c.name_am || "")} · ${c.product_count} items</span></a>`).join("")}</div>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>${t("best_sellers")}</h2><p>${t("best_note")}</p></div>
      <a class="btn sm" href="#/shop?sort=popular">${t("see_all")}</a></div>
    <div class="grid">${h.hero.map((p) => productCard(p, { wish: true })).join("")}</div>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>${t("on_sale")}</h2><p>${t("sale_note")}</p></div></div>
    <div class="grid">${h.onSale.slice(0, 4).map((p) => productCard(p, { wish: true })).join("")}</div>
  </section>

  <section class="section">
    <div class="panel">
      <div class="spread"><div>
        <h2 style="margin-bottom:6px">${t("new_arrivals")}</h2>
        <p class="muted">${t("new_note")}</p></div>
        <a class="btn" href="#/shop?sort=newest">${t("see_all")} →</a></div>
      <div class="grid" style="margin-top:16px">${h.newArrivals.slice(0, 4).map((p) => productCard(p, { wish: true })).join("")}</div>
    </div>
  </section>`;
  window.scrollTo(0, 0);
}

/* ======================================================================= SHOP */

const sortLabels = () => ({ newest: t("newest"), popular: t("popular"), price_asc: "Price ↑", price_desc: "Price ↓", rating: t("rating"), name: "A–Z" });

async function Shop({ query }) {
  const q = {
    q: query.q || "", category: query.category || "", sort: query.sort || "",
    page: query.page || 1, per: query.per || 12,
    min: query.min || "", max: query.max || "",
    inStock: query.inStock ? 1 : "", onSale: query.onSale ? 1 : "", featured: query.featured ? 1 : "",
  };
  const data = await api.get("/products?" + api.qs(q));
  const cat = S.meta.categories.find((c) => c.slug === q.category);

  view().innerHTML = `
  <div class="section shop">
    <aside class="filters card pad">
      <div class="grp"><h4>${t("categories")}</h4>
        <label><input type="radio" name="category" value="" ${!q.category ? "checked" : ""}> All</label>
        ${S.meta.categories.map((c) => `<label><input type="radio" name="category" value="${esc(c.slug)}"
          ${q.category === c.slug ? "checked" : ""}> ${esc(c.icon || "")} ${esc(pick(c, "name"))}
          <span class="muted tiny">(${c.product_count})</span></label>`).join("")}
      </div>
      <div class="grp"><h4>Price (ETB)</h4>
        <div class="rangewrap"><input type="number" name="min" min="0" placeholder="from" value="${esc(q.min)}">
          <span>—</span><input type="number" name="max" min="0" placeholder="to" value="${esc(q.max)}"></div>
      </div>
      <div class="grp"><h4>Only show</h4>
        <label><input type="checkbox" name="inStock" ${q.inStock ? "checked" : ""}> In stock</label>
        <label><input type="checkbox" name="onSale" ${q.onSale ? "checked" : ""}> On sale</label>
        <label><input type="checkbox" name="featured" ${q.featured ? "checked" : ""}> Popular</label>
      </div>
      <div class="grp"><button class="btn p blk" id="applyFilters">Apply</button>
        <button class="btn ghost blk small" id="clearFilters" style="margin-top:6px">Reset</button></div>
    </aside>

    <div>
      <div class="spread" style="margin-bottom:8px">
        <div><h1 style="margin:0">${cat ? esc(pick(cat, "name")) : q.q ? `“${esc(q.q)}”` : t("shop_all")}</h1>
          <p class="muted small">${t("results", { n: num(data.total) })}${cat && cat.blurb ? " · " + esc(cat.blurb) : ""}</p></div>
      </div>
      <div class="toolbar">
        <label class="small muted">${t("sort")}</label>
        <select id="sortSel">${Object.entries(sortLabels()).map(([k, v]) =>
          `<option value="${k}" ${q.sort === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <span class="grow"></span>
        ${q.q ? `<a class="btn sm" href="#/shop">Clear search ✕</a>` : ""}
      </div>
      ${data.items.length ? `<div class="grid">${data.items.map((p) => productCard(p, { wish: true })).join("")}</div>` : `
        <div class="empty card"><div class="ico">🧺</div><h3>Nothing matched</h3>
          <p class="muted">Try a different word, or clear the filters.</p>
          <a class="btn p" href="#/shop">${t("shop_all")}</a></div>`}
      ${data.pages > 1 ? pager(data) : ""}
    </div>
  </div>`;

  const read = () => {
    const f = formValues($(".filters"));
    return { ...f, per: q.per, page: 1, inStock: f.inStock ? 1 : "", onSale: f.onSale ? 1 : "", featured: f.featured ? 1 : "" };
  };
  $("#applyFilters").onclick = () => go("/shop?" + api.qs({ ...read(), sort: $("#sortSel").value, q: q.q }));
  $("#clearFilters").onclick = () => go("/shop");
  $("#sortSel").onchange = (e) => go("/shop?" + api.qs({ ...read(), sort: e.target.value, q: q.q }));
  $$(".filters input").forEach((i) => i.addEventListener("change", () => $("#applyFilters").click()));
  $$("[data-page]", view()).forEach((b) => b.onclick = () =>
    go("/shop?" + api.qs({ ...q, page: b.dataset.page })));
  window.scrollTo(0, 0);
}

const pager = (data) => `<div class="pager">
  <button data-page="${Math.max(1, data.page - 1)}" ${data.page === 1 ? "disabled" : ""}>←</button>
  ${Array.from({ length: data.pages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === data.pages || Math.abs(p - data.page) <= 1)
    .map((p, i, arr) => (i && p - arr[i - 1] > 1 ? `<button disabled>…</button>` : "") +
      `<button data-page="${p}" class="${p === data.page ? "on" : ""}">${p}</button>`).join("")}
  <button data-page="${Math.min(data.pages, data.page + 1)}" ${data.page === data.pages ? "disabled" : ""}>→</button>
</div>`;

/* ==================================================================== PRODUCT */

async function Product({ params }) {
  const data = await api.get(`/products/${encodeURIComponent(params.slug)}`);
  const p = data.product;
  const zone = S.meta.zones[0];
  const already = data.in_cart_qty || 0;

  view().innerHTML = `
  <div class="section">
    <nav class="small muted" style="margin-bottom:12px">
      <a href="#/">${t("home")}</a> / <a href="#/shop">${t("shop")}</a>
      ${p.category_slug ? ` / <a href="#/shop?category=${esc(p.category_slug)}">${esc(p.category_name)}</a>` : ""}
      / <span>${esc(pick(p, "name"))}</span>
    </nav>

    <div class="pdp">
      <div class="gallery">
        <div class="main"><img id="shot" src="${esc(p.image_url || "/img/placeholder.svg")}" alt="${esc(p.name)}"
             onerror="this.onerror=null;this.src='/img/placeholder.svg'"></div>
        <div class="thumbs">${(p.images.length ? p.images : [{ url: p.image_url }])
          .map((i, n) => `<img src="${esc(i.url)}" class="${n === 0 ? "on" : ""}" data-shot="${esc(i.url)}" alt="">`).join("")}</div>
      </div>

      <div class="buybox">
        <span class="cat tiny muted" style="letter-spacing:.1em;text-transform:uppercase">${esc(p.brand || "")}</span>
        <h1>${esc(pick(p, "name"))}</h1>
        ${p.name_am ? `<p class="am muted">${esc(p.name_am)}</p>` : ""}
        <div class="row" style="gap:10px;margin:6px 0">
          ${stars(p.rating_avg, p.rating_count)}
          <a class="small" href="#reviews" data-tab="reviews">Read ${p.rating_count} review(s)</a>
          <span>${stockChip(p)}</span>
        </div>
        <div class="price"><b>${ETB(p.price_cents)}</b>
          ${p.compare_at_price_cents ? `<s>${ETB(p.compare_at_price_cents)}</s>
            <span class="chip sale">Save ${ETB(p.compare_at_price_cents - p.price_cents)}</span>` : ""}
          <small class="muted">per ${esc(p.unit)}</small></div>

        <p style="margin-top:10px">${esc(p.description)}</p>
        ${p.description_am ? `<p class="am muted small">${esc(p.description_am)}</p>` : ""}

        <div class="row" style="margin:16px 0 0;flex-wrap:wrap">
          <div class="qty">
            <button data-step="-1" aria-label="Less">−</button>
            <input id="qty" type="number" value="${already || 1}" min="1" max="${p.stock}" aria-label="Quantity">
            <button data-step="1" aria-label="More">+</button>
          </div>
          <button class="btn p big" data-add="${p.id}" ${p.stock ? "" : "disabled"}>${t("add")}</button>
          <button class="btn big" id="wishBtn" data-wish="${p.id}">${data.wished ? "♥" : "♡"} Save</button>
        </div>
        <p class="tiny muted" style="margin-top:10px">SKU ${esc(p.sku)} · ${num(p.view_count)} views · stock ${p.stock}</p>

        <div class="trust">
          <div><span class="ico">🚚</span><span>${zone ? `Delivers to ${esc(zone.name)} in ${zone.eta_hours}h — ${ETB(zone.fee_cents)} ${t("delivery")}` : ""}</span></div>
          <div><span class="ico">🔒</span><span>Telebirr, CBE Birr, card or cash on delivery</span></div>
          <div><span class="ico">↩️</span><span>Return unopened food within 3 days, goods within 14</span></div>
        </div>
      </div>
    </div>

    ${data.also_bought.length ? `<section class="section">
      <div class="section-head"><div><h2>${t("also_bought")}</h2><p>Shoppers usually take these with it</p></div></div>
      <div class="grid">${data.also_bought.map((x) => productCard(x, { wish: true })).join("")}</div></section>` : ""}

    <section class="section tabs" id="reviews">
      <div class="head">
        <button class="on" data-tab="desc">${t("description")}</button>
        <button data-tab="reviews">${t("reviews")} (${p.rating_count})</button>
        <button data-tab="ship">${t("delivery_info")}</button>
      </div>
      <div class="body panel" style="border-radius:0 0 var(--r) var(--r);border-top:0">
        <div data-pane="desc">
          <p>${esc(p.description)}</p>
          ${p.description_am ? `<p class="am muted">${esc(p.description_am)}</p>` : ""}
          <div class="kv" style="margin-top:14px">
            <div><span>Brand</span><b>${esc(p.brand || "—")}</b></div>
            <div><span>Unit</span><b>${esc(p.unit)}</b></div>
            <div><span>SKU</span><b>${esc(p.sku)}</b></div>
            <div><span>Category</span><b>${esc(p.category_name || "—")}</b></div>
          </div>
        </div>
        <div data-pane="reviews" class="hide">
          ${p.rating_count ? `<div class="row" style="gap:20px;align-items:flex-start">
            <div><div style="font-size:2.4rem;line-height:1">${p.rating_avg.toFixed(1)}</div>
              ${stars(p.rating_avg, p.rating_count)}</div>
            <div class="grow">${[5, 4, 3, 2, 1].map((s) => {
              const n = p.reviews.filter((r) => r.rating === s).length;
              const pct = p.reviews.length ? Math.round(n / p.reviews.length * 100) : 0;
              return `<div class="bars"><span>${s} ★</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="muted">${n}</span></div>`;
            }).join("")}</div></div>` : `<p class="muted">No reviews yet — be the first.</p>`}
          ${p.reviews.map((r) => `<div class="review">
            <div class="who"><b>${esc(r.author)}</b><span class="tiny muted">${dateShort(r.created_at)}</span></div>
            ${stars(r.rating)}<h4 style="margin:6px 0 3px">${esc(r.title || "")}</h4>
            <p class="small" style="margin:0">${esc(r.body || "")}</p></div>`).join("")}
          ${S.me ? `<button class="btn" id="writeReview" style="margin-top:14px">Write a review</button>`
        : `<p class="small muted" style="margin-top:14px"><a href="#/login">${t("sign_in")}</a> to review this product.</p>`}
        </div>
        <div data-pane="ship" class="hide">
          <div class="tablewrap"><table class="t"><thead><tr><th>Zone</th><th>Fee</th><th>Free over</th><th>Typical time</th></tr></thead>
          <tbody>${S.meta.zones.map((z) => `<tr><td>${esc(pick(z, "name"))}</td><td>${ETB(z.fee_cents)}</td>
            <td>${z.free_over_cents ? ETB(z.free_over_cents) : "—"}</td><td>${z.eta_hours} h</td></tr>`).join("")}</tbody></table></div>
        </div>
      </div>
    </section>

    ${data.related.length ? `<section class="section">
      <div class="section-head"><h2>${t("related")}</h2></div>
      <div class="grid">${data.related.slice(0, 4).map((x) => productCard(x, { wish: true })).join("")}</div></section>` : ""}
  </div>`;

  $$("[data-shot]").forEach((i) => i.onclick = () => {
    $("#shot").src = i.dataset.shot;
    $$("[data-shot]").forEach((x) => x.classList.toggle("on", x === i));
  });
  $$("[data-step]").forEach((b) => b.onclick = () => {
    const inp = $("#qty");
    const next = Math.min(p.stock, Math.max(1, (Number(inp.value) || 1) + Number(b.dataset.step)));
    inp.value = next;
  });
  $$("[data-tab]").forEach((b) => b.onclick = (e) => {
    e.preventDefault();
    $$(".tabs [data-tab]").forEach((x) => x.classList.toggle("on", x.dataset.tab === b.dataset.tab));
    $$(".tabs [data-pane]").forEach((x) => x.classList.toggle("hide", x.dataset.pane !== b.dataset.tab));
    if (b.dataset.tab === "reviews") $("#reviews").scrollIntoView({ behavior: "smooth" });
  });
  $("#writeReview")?.addEventListener("click", () => reviewModal(p));
  window.scrollTo(0, 0);
}

function reviewModal(p) {
  modal({
    title: `Review ${p.name}`, okLabel: "Publish",
    body: `<div>
      ${field("rating", "Rating", `<select name="rating">${[5, 4, 3, 2, 1].map((n) =>
        `<option value="${n}">${"★".repeat(n)}${"☆".repeat(5 - n)} — ${n}/5</option>`).join("")}</select>`)}
      ${field("title", "Headline", `<input name="title" maxlength="120" placeholder="Two weeks with my jebena">`)}
      ${field("body", "Your experience", `<textarea name="body" maxlength="2000" placeholder="What worked, what didn't, how it arrived…"></textarea>`)}
      <small class="muted">Only you and our moderators can edit a review. One per product.</small></div>`,
    onOk: async (box) => {
      const v = formValues(box);
      try {
        const r = await api.post(`/products/${p.id}/reviews`, v);
        toast("Thanks — your review is live");
        Product({ params: { slug: p.slug } });
        S.meta = await api.get("/meta");
        return true;
      } catch (e) { paintErrors(box, e.fields); toast(e.message, true); return false; }
    },
  });
}

/* ====================================================================== CART */

async function Cart() {
  const c = S.cart || await api.get("/cart");
  await setCart(c);

  if (!c.items.length) {
    view().innerHTML = `<div class="section"><div class="empty card">
      <div class="ico">🧺</div><h2>${t("empty_cart")}</h2>
      <p class="muted">Your basket is where your coffee, teff and spices wait for checkout.</p>
      <a class="btn p big" href="#/shop">${t("continue_shop")}</a></div></div>`;
    return;
  }

  const zones = S.meta.zones;
  const chosen = zones.find((z) => z.id === Number(S.draft.zone_id)) || zones[0];
  const afterDiscount = c.total_cents;
  const free = chosen.free_over_cents !== null && afterDiscount >= chosen.free_over_cents;
  const fee = free ? 0 : chosen.fee_cents;
  const remaining = chosen.free_over_cents ? Math.max(0, chosen.free_over_cents - afterDiscount) : 0;

  view().innerHTML = `<div class="section cartpage">
    <div class="panel">
      <div class="spread"><h1 style="margin:0">${t("cart")}</h1>
        <button class="btn ghost sm" id="clearCart">Empty basket</button></div>
      <div class="tablewrap" style="margin-top:10px">
        <table class="t"><thead><tr>
          <th>Item</th><th>${t("qty")}</th><th class="num">${t("price")}</th><th class="num">Line</th><th></th>
        </tr></thead><tbody>
        ${c.items.map((i) => `<tr>
          <td><div class="row" style="align-items:flex-start;gap:10px">
            <img class="mini" src="${esc(i.image_url)}" alt="" style="width:54px;height:46px;object-fit:cover;border-radius:8px">
            <div><a href="#/product/${esc(i.slug)}"><b>${esc(pick(i, "name"))}</b></a>
              <div class="meta tiny muted">${esc(i.unit)} · ${esc(i.sku)}
                ${i.stock <= (i.low_stock_at || 5) ? `<span class="chip low">${t("low_stock", { n: i.stock })}</span>` : ""}</div></div>
          </div></td>
          <td><div class="qty" style="border-radius:10px">
            <button data-qty="${i.product_id}" data-to="${i.qty - 1}">−</button>
            <input value="${i.qty}" data-qty-input="${i.product_id}" aria-label="Quantity">
            <button data-qty="${i.product_id}" data-to="${i.qty + 1}">+</button></div></td>
          <td class="num">${ETB(i.unit_price_cents)}</td>
          <td class="num"><b>${ETB(i.line_total_cents)}</b></td>
          <td><button class="btn ghost sm" data-remove="${i.product_id}" title="Remove">✕</button></td>
        </tr>`).join("")}</tbody></table>
      </div>
      ${c.issues.length ? `<div class="banner warn" style="margin-top:12px">⚠️ ${c.issues.map(esc).join("<br>")}</div>` : ""}
      <a class="btn small" href="#/shop" style="margin-top:14px">← ${t("continue_shop")}</a>
    </div>

    <aside class="summary panel">
      <h3>${t("total")}</h3>
      ${chosen ? `<p class="small muted">${esc(pick(chosen, "name"))} · about ${chosen.eta_hours}h
        ${free ? `<span class="chip ok">${t("free")}</span>` : ""}</p>
        <select id="zoneSel" class="field" style="width:100%;padding:9px 10px;border-radius:10px;border:1px solid var(--line-2)">
          ${zones.map((z) => `<option value="${z.id}" ${z.id === chosen.id ? "selected" : ""}>
            ${esc(pick(z, "name"))} — ${ETB(z.fee_cents)}</option>`).join("")}</select>
        ${remaining > 0 ? `<div class="freebar"><i style="width:${Math.min(100, Math.round(afterDiscount / chosen.free_over_cents * 100))}%"></i></div>
          <p class="tiny muted">Add ${ETB(remaining)} more for free delivery.</p>` : ""}` : ""}
      <div class="lines">
        <div><span>${t("subtotal")}</span><b>${ETB(c.subtotal_cents)}</b></div>
        ${c.discount_cents ? `<div><span>${t("discount")} · ${esc(c.coupon_code)}</span><b style="color:var(--chili)">−${ETB(c.discount_cents)}</b></div>` : ""}
        <div><span>${t("delivery")}</span><b>${fee ? ETB(fee) : t("free")}</b></div>
        <div class="tot"><span>${t("total")}</span><span>${ETB(afterDiscount + fee)}</span></div>
      </div>
      ${c.coupon_code ? `<div class="promo"><input id="coupon" value="${esc(c.coupon_code)}" disabled placeholder="${esc(c.coupon_code)}">
          <button class="btn sm" id="dropCoupon">✕</button></div>` : `
        <div class="promo"><input id="coupon" placeholder="${t("coupon")}">
          <button class="btn sm" id="applyCoupon">${t("apply")}</button></div>`}
      ${c.coupon_reason ? `<p class="tiny" style="color:var(--chili)">${esc(c.coupon_reason)}</p>` : ""}
      <button class="btn p big blk" style="margin-top:14px" id="toCheckout" ${c.can_checkout ? "" : "disabled"}>${t("checkout")} →</button>
      <p class="tiny muted center" style="margin-top:8px">🔒 Simulated payments · Telebirr, CBE Birr, card or cash</p>
    </aside>
  </div>`;

  $("#toCheckout").onclick = () => { S.draft.step = 0; go("/checkout"); };
  $("#clearCart").onclick = async () => {
    if (!await confirmBox("Remove every item from your basket?", "Empty it")) return;
    await setCart(await api.del("/cart"));
    Cart();
  };
  $$("[data-qty]").forEach((b) => b.onclick = async () => {
    const to = Math.max(0, Number(b.dataset.to));
    await setCart(await api.patch(`/cart/items/${b.dataset.qty}`, { qty: to }));
    Cart();
  });
  $$("[data-qty-input]").forEach((i) => i.onchange = async () => {
    await setCart(await api.patch(`/cart/items/${i.dataset.qtyInput}`, { qty: Number(i.value) || 0 }));
    Cart();
  });
  $$("[data-remove]").forEach((b) => b.onclick = async () => {
    await setCart(await api.del(`/cart/items/${b.dataset.remove}`));
    Cart();
  });
  $("#applyCoupon")?.addEventListener("click", async () => {
    const code = $("#coupon").value.trim();
    if (!code) return toast("Type a coupon code", true);
    try { await setCart(await api.post("/cart/coupon", { code })); toast("Coupon applied 🎉"); }
    catch (e) { toast(e.message, true); }
    Cart();
  });
  $("#dropCoupon")?.addEventListener("click", async () => {
    await setCart(await api.post("/cart/coupon", { code: "" })); Cart();
  });
  $("#zoneSel")?.addEventListener("change", (e) => { S.draft.zone_id = Number(e.target.value); Cart(); });
  window.scrollTo(0, 0);
}

/* ================================================================= CHECKOUT */

async function Checkout() {
  if (!S.cart?.items?.length) { toast("Your basket is empty first"); return go("/cart"); }
  const c = await api.get("/cart");
  await setCart(c);

  const step = S.draft.step;
  const zones = S.meta.zones;
  const zone = zones.find((z) => z.id === Number(S.draft.zone_id)) || zones.find(z => z.name === "Addis Ababa") || zones[0];
  const feeFor = (z) => z && c.total_cents >= (z.free_over_cents ?? Infinity) ? 0 : (z?.fee_cents ?? 0);
  const fee = feeFor(zone);

  view().innerHTML = `<div class="section">
    <div class="steps">
      ${["Delivery", "Payment", "Review"].map((s, i) =>
        `<span class="s ${i === step ? "on" : i < step ? "done" : ""}"><b>${i < step ? "✓" : i + 1}</b>${s}</span>
         ${i < 2 ? `<span class="muted">→</span>` : ""}`).join("")}
    </div>

    <div class="checkout">
      <div class="panel" id="stepHost"></div>
      <aside class="summary panel">
        <h3>Your basket</h3>
        <div class="tablewrap"><table class="t"><tbody>
          ${c.items.map((i) => `<tr><td style="width:46px"><img class="mini" src="${esc(i.image_url)}" alt=""></td>
            <td><a href="#/product/${esc(i.slug)}">${esc(pick(i, "name"))}</a><br><small class="muted">${i.qty} × ${ETB(i.unit_price_cents)}</small></td>
            <td class="num">${ETB(i.line_total_cents)}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="lines">
          <div><span>${t("subtotal")}</span><b>${ETB(c.subtotal_cents)}</b></div>
          ${c.discount_cents ? `<div><span>${t("discount")}</span><b style="color:var(--chili)">−${ETB(c.discount_cents)}</b></div>` : ""}
          <div><span>${t("delivery")}${zone ? " · " + esc(pick(zone, "name")) : ""}</span><b>${fee ? ETB(fee) : t("free")}</b></div>
          <div class="tot"><span>${t("total")}</span><span>${ETB(c.total_cents + fee)}</span></div>
        </div>
        <a class="btn ghost sm" href="#/cart">← Edit basket</a>
      </aside>
    </div>
  </div>`;

  const host = $("#stepHost");
  if (step === 0) renderShip(host, zone, zones, c, fee);
  if (step === 1) renderPay(host, zone, c, fee);
  if (step === 2) renderReview(host, zone, c, fee);
  window.scrollTo(0, 0);
}

function renderShip(host, zone, zones, c, fee) {
  const d = S.draft.ship;
  const saved = S.me ? (window.__addresses || []) : [];
  host.innerHTML = `
    <h2>${t("shipping_address")}</h2>
    ${S.me ? `<p class="small muted">Signed in as <b>${esc(S.me.email)}</b> —
      <a href="#/account/addresses">manage saved addresses</a>.</p>` : ""}
    ${saved.length ? `<div class="grp" style="margin-bottom:14px"><label class="small"><input type="checkbox" id="useSaved" checked>
      Use saved address: ${esc(saved[0].recipient)}, ${esc(saved[0].city)}</label></div>` : ""}
    <div class="duo">
      ${field("name", t("name"), `<input name="name" value="${esc(d.name || S.me?.name || "")}" required>`)}
      ${field("phone", t("phone"), `<input name="phone" value="${esc(d.phone || S.me?.phone || "")}" placeholder="+251 9.." required>`)}
    </div>
    <div class="trio">
      ${field("region", t("region"), `<input name="region" value="${esc(d.region || "Addis Ababa")}">`)}
      ${field("city", t("city"), `<input name="city" value="${esc(d.city || "Addis Ababa")}">`)}
      ${field("subcity", t("subcity"), `<input name="subcity" value="${esc(d.subcity || "")}" placeholder="Bole">`)}
    </div>
    <div class="duo">
      ${field("woreda", t("woreda"), `<input name="woreda" value="${esc(d.woreda || "")}" placeholder="Woreda 08">`)}
      ${field("landmark", t("landmark"), `<input name="landmark" value="${esc(d.landmark || "")}" placeholder="Behind Edna Mall">`)}
    </div>
    ${S.me ? "" : field("email", "Email for the receipt", `<input name="email" type="email" value="${esc(S.draft.email || "")}" placeholder="you@example.com">`)}
    ${field("zone_id", "Delivery zone", `<select name="zone_id">${zones.map((z) =>
      `<option value="${z.id}" ${zone && z.id === zone.id ? "selected" : ""}>
        ${esc(pick(z, "name"))} — ${ETB(z.fee_cents)} · ${z.eta_hours}h${z.free_over_cents ? ` · free over ${ETB(z.free_over_cents)}` : ""}</option>`).join("")}</select>`)}
    ${field("instructions", t("instructions"), `<textarea name="instructions" placeholder="Gate code, who to call…">${esc(S.draft.instructions || "")}</textarea>`)}
    <div class="row" style="justify-content:space-between;margin-top:8px">
      <a class="btn" href="#/cart">← ${t("cart")}</a>
      <button class="btn p big" id="next1">${t("payment")} →</button>
    </div>`;

  $("#useSaved")?.addEventListener("change", (e) => {
    const a = saved[0];
    if (!e.target.checked) return;
    host.querySelector('[name="name"]').value = a.recipient;
    host.querySelector('[name="phone"]').value = a.phone;
    host.querySelector('[name="region"]').value = a.region;
    host.querySelector('[name="city"]').value = a.city;
    host.querySelector('[name="subcity"]').value = a.subcity || "";
    host.querySelector('[name="woreda"]').value = a.woreda || "";
    host.querySelector('[name="landmark"]').value = a.landmark || "";
  });

  $("#next1").onclick = async () => {
    const v = formValues(host);
    if (!v.name || !v.phone || !v.city) return toast("Name, phone and city are required", true);
    S.draft.ship = { name: v.name, phone: v.phone, region: v.region, city: v.city, subcity: v.subcity, woreda: v.woreda, landmark: v.landmark };
    S.draft.zone_id = Number(v.zone_id);
    S.draft.instructions = v.instructions;
    S.draft.email = S.me?.email || v.email || "";
    if (!S.me) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.draft.email || "")) {
        return toast("A valid email is needed for your receipt", true);
      }
    }
    S.draft.step = 1;
    Checkout();
  };
}

function renderPay(host, zone, c, fee) {
  host.innerHTML = `
    <h2>${t("payment")}</h2>
    <p class="muted small">This build simulates the gateway. In production, swap
      <code>server/src/orders.js → providers()</code> for Telebirr/CBE APIs.</p>
    <div class="pays">${S.meta.payment_providers.map((p) => `
      <label class="pay ${S.draft.payment_method === p.id ? "on" : ""}" data-pay="${p.id}">
        <span class="ico">${p.icon}</span>
        <span class="grow"><b>${esc(p.label)}</b><span class="am">${esc(p.label_am)}</span></span>
        <span class="tiny muted">${p.id === "cod" ? "Pay the courier" : "Confirmed instantly"}</span>
      </label>`).join("")}</div>
    ${c.issues.length ? `<div class="banner bad" style="margin-top:14px">${c.issues.map(esc).join("<br>")}</div>` : ""}
    <div class="row" style="justify-content:space-between;margin-top:18px">
      <button class="btn" id="back2">← ${t("shipping_address")}</button>
      <button class="btn p big" id="next2">${t("review_order")} →</button>
    </div>`;

  $$("[data-pay]", host).forEach((l) => l.onclick = () => {
    S.draft.payment_method = l.dataset.pay;
    $$(".pay", host).forEach((x) => x.classList.toggle("on", x === l));
  });
  $("#back2").onclick = () => { S.draft.step = 0; Checkout(); };
  $("#next2").onclick = async () => {
    if (!S.draft.email && !S.me) {
      const email = prompt("Your email for the receipt:");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast("A valid email is needed for the receipt", true);
      S.draft.email = email;
    }
    S.draft.step = 2;
    Checkout();
  };
}

function renderReview(host, zone, c, fee) {
  const s = S.draft;
  host.innerHTML = `
    <h2>${t("review_order")}</h2>
    <div class="kv" style="margin-bottom:18px">
      <div><span>Deliver to</span><b>${esc(s.ship.name)}</b><br><span class="muted small">${esc(s.ship.phone)}</span></div>
      <div><span>Address</span><b>${esc([s.ship.subcity, s.ship.woreda, s.ship.landmark].filter(Boolean).join(", ") || s.ship.city)}</b><br>
        <span class="muted small">${esc(s.ship.city)}, ${esc(s.ship.region)}</span></div>
      <div><span>${t("delivery")}</span><b>${esc(pick(zone, "name"))} · ${zone.eta_hours}h</b></div>
      <div><span>${t("payment")}</span><b>${esc((S.meta.payment_providers.find((p) => p.id === s.payment_method) || {}).label)}</b></div>
      <div><span>Receipt email</span><b>${esc(s.email || S.me?.email || "")}</b></div>
      <div><span>${t("instructions")}</span><b>${esc(s.instructions || "—")}</b></div>
    </div>

    <div class="tablewrap"><table class="t"><thead><tr><th>Item</th><th class="num">${t("qty")}</th><th class="num">Line</th></tr></thead>
      <tbody>${c.items.map((i) => `<tr><td>${esc(pick(i, "name"))}</td><td class="num">${i.qty}</td>
        <td class="num">${ETB(i.line_total_cents)}</td></tr>`).join("")}</tbody></table></div>

    <div class="lines" style="margin-top:14px">
      <div><span>${t("subtotal")}</span><b>${ETB(c.subtotal_cents)}</b></div>
      ${c.discount_cents ? `<div><span>${t("discount")}</span><b style="color:var(--chili)">−${ETB(c.discount_cents)}</b></div>` : ""}
      <div><span>${t("delivery")}</span><b>${fee ? ETB(fee) : t("free")}</b></div>
      <div class="tot"><span>${t("total")}</span><span>${ETB(c.total_cents + fee)}</span></div>
    </div>

    ${!S.me ? `<div class="card" style="padding:14px;margin:12px 0">
      <label class="row small"><input type="checkbox" id="mkAccount">
        Create an account with this email so I can see my orders and addresses later</label>
      <div id="mkWrap" hidden style="margin-top:10px">
        ${field("mkpass", "Choose a password", `<input name="mkpass" type="password" autocomplete="new-password" placeholder="at least 8 characters">`)}
        <p class="tiny muted">We create the account first, then place the order — so it lands in your account, not just in your inbox.</p>
      </div></div>` : ""}

    <div class="banner warn"><span>⚠️</span><span class="grow">By placing this order you agree to our
      return policy. Food items must be reported within 3 days.</span></div>

    <div class="row" style="justify-content:space-between;margin-top:18px">
      <button class="btn" id="back3">← ${t("payment")}</button>
      <button class="btn p big" id="place">${t("place_order")} · ${ETB(c.total_cents + fee)}</button>
    </div>`;

  $("#back3").onclick = () => { S.draft.step = 1; Checkout(); };
  $("#mkAccount")?.addEventListener("change", (e) => { $("#mkWrap").hidden = !e.target.checked; });
  $("#place").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Placing…";
    try {
      if (!S.me && $("#mkAccount")?.checked) {
        const pw = host.querySelector('[name="mkpass"]')?.value || "";
        if (pw.length < 8) {
          btn.disabled = false;
          btn.textContent = t("place_order");
          return toast("Pick a password of 8+ characters, or untick “create an account”", true);
        }
        const r = await api.post("/auth/register", {
          name: S.draft.ship.name, email: S.draft.email, password: pw, phone: S.draft.ship.phone,
        });
        S.me = r.user;                       // the guest basket and future orders now belong to this account
      }
      const r = await api.post("/checkout", {
        email: S.draft.email || S.me?.email,
        phone: S.draft.ship.phone,
        ship: S.draft.ship,
        zone_id: S.draft.zone_id,
        payment_method: S.draft.payment_method,
        instructions: S.draft.instructions,
      });
      S.cart = await api.get("/cart");
      badge();
      S.draft = { step: 0, zone_id: S.draft.zone_id, payment_method: S.draft.payment_method, ship: S.draft.ship, email: S.draft.email, phone: S.draft.phone, instructions: "" };
      toast(t("order_placed") + " 🎉");
      go(`/order/${r.order.id}`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = t("place_order");
      toast(err.message, true);
      if (err.fields) paintErrors(host, err.fields);
    }
  };
}

/* ==================================================================== ORDER */

async function Order({ params }) {
  let o;
  try { o = (await api.get(`/orders/${params.id}`)).order; }
  catch {
    view().innerHTML = `<div class="section"><div class="empty card"><div class="ico">🔎</div>
      <h2>We couldn't find that order</h2>
      <p class="muted">If you checked out as a guest, look it up with the order number.</p>
      <a class="btn p" href="#/track">${t("track")}</a></div></div>`;
    return;
  }
  const pay = o.payments[0];
  const canPay = !["paid", "refunded"].includes(o.payment_status) && o.status !== "cancelled"
    && pay && pay.status !== "captured" && pay.provider !== "cod";

  view().innerHTML = `<div class="section" style="max-width:900px;margin-inline:auto">
    <div class="ok-hero">
      <div class="ring">✓</div>
      <h1>${t("order_placed")}</h1>
      <p class="muted">Order <b>${esc(o.number)}</b> · placed ${dateTime(o.placed_at)} · a receipt went to ${esc(o.email)}</p>
    </div>

    <div class="panel" style="margin-top:14px">
      <div class="spread"><h3>${statusChip(o.status)} <span class="muted small">· ${esc(pay.provider.toUpperCase())} ${esc(o.payment_status)}</span></h3>
        <span class="small muted">${o.eta_hours ? `about ${o.eta_hours}h to ${esc(o.zone_name)}` : ""}</span></div>
      <div class="timeline" style="margin-top:14px">${o.timeline.map((s) => `
        <div class="t ${s.done ? "done" : ""}"><span class="dot"></span>
          <div><b>${esc(s.label)}</b><span>${s.at ? dateTime(s.at) : "waiting"}</span></div></div>`).join("")}</div>

      <div class="tablewrap" style="margin-top:10px"><table class="t">
        <thead><tr><th>Item</th><th class="num">${t("qty")}</th><th class="num">Line</th></tr></thead>
        <tbody>${o.items.map((i) => `<tr>
          <td><div class="row" style="gap:10px"><img class="mini" src="${esc(i.image_url || "/img/placeholder.svg")}" alt="">
            <span>${esc(pick(i, "name") || i.name_snapshot)}${i.name_am_snapshot && store.lang === "en" ? "" : ""}</span></div></td>
          <td class="num">${i.qty}</td><td class="num">${ETB(i.line_total_cents)}</td></tr>`).join("")}</tbody></table></div>

      <div class="lines" style="margin-top:14px">
        <div><span>${t("subtotal")}</span><b>${ETB(o.subtotal_cents)}</b></div>
        ${o.discount_cents ? `<div><span>${t("discount")}${o.coupon_code ? " · " + esc(o.coupon_code) : ""}</span>
          <b style="color:var(--chili)">−${ETB(o.discount_cents)}</b></div>` : ""}
        <div><span>${t("delivery")}</span><b>${o.delivery_cents ? ETB(o.delivery_cents) : t("free")}</b></div>
        <div class="tot"><span>${t("total")}</span><span>${ETB(o.total_cents)}</span></div>
      </div>

      ${canPay ? `<div class="banner warn" style="margin-top:12px"><span>💳</span>
        <span class="grow">Your payment is authorised but not captured.</span>
        <button class="btn g sm" id="payNow">Pay ${ETB(pay.amount_cents)}</button></div>` : ""}

      ${o.status === "pending" ? `<div class="row" style="margin-top:14px;justify-content:space-between">
        <span class="small muted">Need to change something? Call +251 911 000 111 within 30 minutes.</span>
        <button class="btn d sm" id="cancelOrder">${t("cancel")} order</button></div>` : ""}

      <div class="kv" style="margin-top:18px">
        <div><span>Ship to</span><b>${esc(o.ship_name)}</b><br><span class="muted small">${esc(o.ship_phone)}</span></div>
        <div><span>Address</span><b>${esc([o.ship_subcity, o.ship_woreda, o.ship_landmark].filter(Boolean).join(", ") || o.ship_city)}</b><br>
          <span class="muted small">${esc(o.ship_city)}, ${esc(o.ship_region)}</span></div>
        ${o.instructions ? `<div><span>${t("instructions")}</span><b>${esc(o.instructions)}</b></div>` : ""}
        <div><span>Payment reference</span><b class="mono" style="font-family:var(--mono);font-size:.86rem">${esc(pay.reference)}</b></div>
      </div>

      <div class="row" style="margin-top:18px">
        <a class="btn" href="#/shop">${t("continue_shop")}</a>
        ${S.me ? `<a class="btn" href="#/account/orders">My orders</a>` : ""}
        <button class="btn ghost" onclick="window.print()">🖨 Print receipt</button>
      </div>
    </div>
  </div>`;

  $("#payNow")?.addEventListener("click", async () => {
    try {
      await api.post(`/payments/${pay.reference}/confirm`);
      toast("Payment captured ✅");
      Order({ params });
    } catch (e) { toast(e.message, true); }
  });
  $("#cancelOrder")?.addEventListener("click", async () => {
    if (!await confirmBox("Cancel this order and put the stock back?", "Cancel order")) return;
    try {
      await api.post(`/orders/${o.id}/cancel`, { reason: "Customer changed their mind" });
      toast("Order cancelled");
      Order({ params });
    } catch (e) { toast(e.message, true); }
  });
  window.scrollTo(0, 0);
}

async function Track() {
  view().innerHTML = `<div class="section" style="max-width:640px;margin-inline:auto">
    <div class="panel">
      <h1>${t("track")}</h1>
      <p class="muted">Order numbers look like <code class="mono">MG-20261019-1A2B3C</code>.</p>
      ${field("number", "Order number", `<input name="number" placeholder="MG-…" autocomplete="off">`)}
      <button class="btn p blk" id="trackGo">Find my order</button>
      <div id="trackOut" style="margin-top:16px"></div>
    </div></div>`;
  $("#trackGo").onclick = async () => {
    const n = $('input[name="number"]').value.trim();
    if (!n) return toast("Type the order number", true);
    try {
      const r = await api.get(`/track/${encodeURIComponent(n)}`);
      const o = r.order;
      $("#trackOut").innerHTML = `<div class="banner ok"><span>📦</span><span class="grow">
        <b>${esc(o.number)}</b> — ${statusChip(o.status)} ${o.eta_hours ? `· ${o.eta_hours}h to ${esc(o.zone_name)}` : ""}</span></div>
        <div class="timeline" style="margin-top:12px">${o.timeline.map((s) =>
          `<div class="t ${s.done ? "done" : ""}"><span class="dot"></span><div><b>${esc(s.label)}</b>
            <span>${s.at ? dateTime(s.at) : "waiting"}</span></div></div>`).join("")}</div>`;
    } catch (e) { toast(e.message, true); }
  };
}

/* =================================================================== ACCOUNT */

const ACCOUNT_TABS = [["orders", t("orders")], ["wishlist", t("wishlist")], ["addresses", t("addresses")], ["profile", t("profile")]];

async function Account({ params }) {
  if (!S.me) return Auth("login");
  const me = await api.get("/me");
  S.me = me.user;
  S.cart = me.cart;
  badge();
  window.__addresses = me.addresses;
  const tab = params.tab || "orders";

  view().innerHTML = `<div class="section acc">
    <aside>
      <div class="card pad" style="margin-bottom:14px">
        <div class="row"><div class="mark" style="width:44px;height:44px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700">
          ${esc(S.me.name.slice(0, 1))}</div>
          <div><b>${esc(S.me.name)}</b><br><span class="tiny muted">${esc(S.me.email)}</span></div></div>
        ${S.me.role === "admin" ? `<a class="btn g sm blk" href="/admin" style="margin-top:10px">Seller console</a>` : ""}
      </div>
      <div class="menu">${ACCOUNT_TABS.map(([k, label]) =>
        `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${label}</button>`).join("")}
        <button id="logout" style="color:var(--chili)">⟶ ${t("log_out")}</button></div>
    </aside>
    <div id="pane" class="panel"></div>
  </div>`;

  $$(".menu [data-tab]").forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; go(`/account/${b.dataset.tab}`); });
  $("#logout").onclick = async () => {
    await api.post("/auth/logout");
    S.me = null; S.cart = await api.get("/cart"); badge();
    toast("Signed out"); go("/");
  };

  const pane = $("#pane");
  if (tab === "orders") renderOrders(pane, me.orders);
  if (tab === "wishlist") renderWishlist(pane, me.wishlist);
  if (tab === "addresses") renderAddresses(pane, me.addresses);
  if (tab === "profile") renderProfile(pane, me.user);
  window.scrollTo(0, 0);
}

function renderOrders(pane, orders) {
  pane.innerHTML = `<h2>${t("orders")}</h2>
    ${orders.length ? `<div class="tablewrap"><table class="t"><thead><tr>
      <th>Order</th><th>Placed</th><th>${t("total")}</th><th>Payment</th><th>Status</th><th></th></tr></thead>
      <tbody>${orders.map((o) => `<tr>
        <td><b class="mono" style="font-family:var(--mono)">${esc(o.number)}</b><br>
          <span class="tiny muted">${o.line_count} line(s)</span></td>
        <td>${dateShort(o.placed_at)}</td><td><b>${ETB(o.total_cents)}</b></td>
        <td><span class="tiny">${esc(o.payment_method)}</span><br><span class="chip ${o.payment_status === "paid" ? "ok" : "out"}">${esc(o.payment_status)}</span></td>
        <td>${statusChip(o.status)}</td>
        <td><a class="btn sm" href="#/order/${o.id}">Open</a></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty"><div class="ico">📦</div><p class="muted">No orders yet.</p>
        <a class="btn p" href="#/shop">${t("continue_shop")}</a></div>`}`;
}

function renderWishlist(pane, items) {
  pane.innerHTML = `<h2>${t("wishlist")}</h2>
    ${items.length ? `<div class="grid" style="margin-top:12px">${items.map((p) => productCard({ ...p, category_name: "", rating_avg: p.rating_avg, rating_count: 0, compare_at_price_cents: null }, { wish: true })).join("")}</div>`
    : `<div class="empty"><div class="ico">♡</div><p class="muted">Tap the heart on any product to keep it here.</p>
        <a class="btn p" href="#/shop">${t("shop_all")}</a></div>`}`;
}

function renderAddresses(pane, list) {
  pane.innerHTML = `<div class="spread"><h2>${t("addresses")}</h2>
    <button class="btn p sm" id="newAddr">+ New address</button></div>
    <div class="addr" style="margin-top:14px">${list.map((a) => `
      <div class="card"><h4>${esc(a.label)} ${a.is_default ? `<span class="chip ok">default</span>` : ""}</h4>
        <p class="small" style="margin:0">${esc(a.recipient)}<br>${esc(a.phone)}<br>
          ${esc([a.subcity, a.woreda, a.landmark].filter(Boolean).join(", "))}<br>
          ${esc(a.city)}, ${esc(a.region)}</p>
        <div class="row" style="margin-top:10px">
          <button class="btn sm" data-edit="${a.id}">Edit</button>
          <button class="btn ghost sm" data-del="${a.id}">Delete</button></div></div>`).join("") ||
      `<p class="muted">No saved addresses yet.</p>`}</div>`;

  $("#newAddr").onclick = () => addressModal(null);
  $$("[data-edit]", pane).forEach((b) => b.onclick = () => addressModal(list.find((a) => a.id === Number(b.dataset.edit))));
  $$("[data-del]", pane).forEach((b) => b.onclick = async () => {
    if (!await confirmBox("Delete this address?")) return;
    await api.del(`/addresses/${b.dataset.del}`);
    toast("Address deleted");
    Account({ params: { tab: "addresses" } });
  });
}

function addressModal(a) {
  modal({
    title: a ? "Edit address" : "New address", okLabel: t("save"),
    body: `<div>
      ${field("label", "Label", `<input name="label" value="${esc(a?.label || "Home")}">`)}
      <div class="duo">
        ${field("recipient", "Recipient", `<input name="recipient" value="${esc(a?.recipient || S.me.name)}">`)}
        ${field("phone", t("phone"), `<input name="phone" value="${esc(a?.phone || S.me.phone || "")}">`)}
      </div>
      <div class="duo">
        ${field("region", t("region"), `<input name="region" value="${esc(a?.region || "Addis Ababa")}">`)}
        ${field("city", t("city"), `<input name="city" value="${esc(a?.city || "Addis Ababa")}">`)}
      </div>
      <div class="trio">
        ${field("subcity", t("subcity"), `<input name="subcity" value="${esc(a?.subcity || "")}">`)}
        ${field("woreda", t("woreda"), `<input name="woreda" value="${esc(a?.woreda || "")}">`)}
        ${field("landmark", t("landmark"), `<input name="landmark" value="${esc(a?.landmark || "")}">`)}
      </div>
      <label class="row small"><input type="checkbox" name="is_default" ${a?.is_default ? "checked" : "default"}> Make this my default</label>
    </div>`,
    onOk: async (box) => {
      const v = formValues(box);
      try {
        if (a) await api.patch(`/addresses/${a.id}`, v); else await api.post("/addresses", v);
        toast("Address saved");
        Account({ params: { tab: "addresses" } });
        return true;
      } catch (e) { paintErrors(box, e.fields); toast(e.message, true); return false; }
    },
  });
}

function renderProfile(pane, user) {
  pane.innerHTML = `<h2>${t("profile")}</h2>
    <div style="max-width:520px">
      <div class="duo">
        ${field("name", t("name"), `<input name="name" value="${esc(user.name)}">`)}
        ${field("phone", t("phone"), `<input name="phone" value="${esc(user.phone || "")}">`)}
      </div>
      ${field("email", t("email"), `<input name="email" value="${esc(user.email)}" disabled><small class="muted">Email is your login and cannot change here.</small>`)}
      ${field("lang", "Language", `<select name="lang"><option value="en" ${user.lang === "en" ? "selected" : ""}>English</option>
        <option value="am" ${user.lang === "am" ? "selected" : ""}>አማርኛ</option></select>`)}
      <button class="btn p" id="saveProfile">${t("save")}</button>

      <h3 style="margin-top:26px">Change password</h3>
      <div class="duo">
        ${field("current", "Current password", `<input name="current" type="password" autocomplete="current-password">`)}
        ${field("next", "New password", `<input name="next" type="password" autocomplete="new-password">`)}
      </div>
      <button class="btn" id="savePassword">Update password</button>
      <p class="tiny muted">Passwords are salted and hashed with scrypt on the server — never stored in plain text.</p>
    </div>`;

  $("#saveProfile").onclick = async () => {
    const v = formValues(pane);
    try {
      await api.patch("/me", v);
      toast("Profile updated");
      S.me = (await api.get("/me")).user;
    } catch (e) { paintErrors(pane, e.fields); toast(e.message, true); }
  };
  $("#savePassword").onclick = async () => {
    const v = formValues(pane);
    try {
      await api.post("/me/password", { current: v.current, next: v.next });
      toast("Password changed — you stay signed in");
    } catch (e) { paintErrors(pane, e.fields); toast(e.message, true); }
  };
}

/* ================================================================ LOGIN PAGE */

function Auth(mode) {
  const login = mode === "login";
  view().innerHTML = `<div class="section" style="max-width:460px;margin-inline:auto">
    <div class="panel">
      <h1>${login ? t("sign_in") : t("register")}</h1>
      <p class="muted small">${login ? "Demo shopper: <b>sara@example.et</b> / <b>Password123</b>" :
    "An account keeps your basket, addresses and wishlist on this device's server."}</p>
      <div id="authForm" style="margin-top:10px">
        ${login ? "" : field("name", t("name"), `<input name="name" autocomplete="name" required>`)}
        ${field("email", t("email"), `<input name="email" type="email" autocomplete="email" required>`)}
        ${login ? "" : field("phone", t("phone"), `<input name="phone" autocomplete="tel" placeholder="+251 9..">`)}
        ${field("password", t("password"), `<input name="password" type="password" autocomplete="${login ? "current-password" : "new-password"}" required>`)}
        <button class="btn p big blk" id="authGo">${login ? t("sign_in") : t("register")}</button>
      </div>
      <p class="center small" style="margin-top:14px">
        ${login ? `New here? <a href="#/register">${t("register")}</a>` : `Have an account? <a href="#/login">${t("sign_in")}</a>`}
        <br><a href="#/track">${t("track")}</a> without an account</p>
      ${!login ? `<div class="banner warn" style="margin-top:14px"><span>ℹ️</span><span class="grow">
        Passwords need 8+ characters. We hash with scrypt, so staff can't read them.</span></div>` : ""}
    </div></div>`;

  const run = async () => {
    const v = formValues($("#authForm"));
    const btn = $("#authGo");
    btn.disabled = true;
    try {
      const r = login ? await api.post("/auth/login", v) : await api.post("/auth/register", v);
      S.me = r.user;
      await setCart(r.cart);
      toast(login ? `Welcome back, ${r.user.name.split(" ")[0]}` : "Account created — welcome to Meri Gebeya");
      go(S.cart?.items?.length ? "/checkout" : "/account");
    } catch (e) {
      btn.disabled = false;
      paintErrors($("#authForm"), e.fields);
      toast(e.message, true);
    }
  };
  $("#authGo").onclick = run;
  $$("#authForm input").forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") run(); });
}

/* ==================================================================== wiring */

document.addEventListener("click", async (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    e.preventDefault();
    const qty = add.closest(".buybox") ? Number($("#qty")?.value || 1) : 1;
    await addToCart(Number(add.dataset.add), qty);
    if (add.closest(".buybox")) {
      add.textContent = "In basket ✓";
      setTimeout(() => { add.textContent = t("add"); }, 1400);
    }
    return;
  }
  const wish = e.target.closest("[data-wish]");
  if (wish) { e.preventDefault(); await toggleWish(Number(wish.dataset.wish), wish); }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "q") suggest(e.target.value.trim());
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search")) $("#suggest").innerHTML = "";
});

bootNav({
  onLang: () => { renderNav(); routerInstance.refresh(); },
  onSearch: (q) => go("/shop?" + api.qs({ q })),
});

function renderNav() {
  if (!S.meta) return;
  $("#catNav").innerHTML = `<a href="#/shop">${t("shop_all")}</a>` +
    S.meta.categories.map((c) => `<a href="#/shop?category=${encodeURIComponent(c.slug)}">${esc(pick(c, "name"))}</a>`).join("");
}

const routes = {
  "/": Home,
  "/shop": Shop,
  "/product/:slug": Product,
  "/cart": Cart,
  "/checkout": Checkout,
  "/order/:id": Order,
  "/track": Track,
  "/account": () => Account({ params: {} }),
  "/account/:tab": Account,
  "/login": () => Auth("login"),
  "/register": () => Auth("register"),
};

const NotFound = () => {
  view().innerHTML = `<div class="section"><div class="empty card"><div class="ico">🧭</div>
    <h1>Page not found</h1><p class="muted">The link may be old or misspelled.</p>
    <a class="btn p" href="#/">${t("home")}</a></div></div>`;
};

(async function start() {
  view().innerHTML = `<div class="section"><div class="skel" style="height:220px"></div>
    <div class="grid" style="margin-top:18px">${Array.from({ length: 4 }).map(() => `<div class="skel" style="height:290px"></div>`).join("")}</div></div>`;
  try {
    await loadShell();
  } catch (e) {
    view().innerHTML = `<div class="section"><div class="empty card"><div class="ico">🛌</div>
      <h1>Can't reach the shop</h1><p class="muted">${esc(e.message)}</p>
      <p class="small">Start it with <code>npm start</code> inside <code>meri-gebeya/</code>.</p></div></div>`;
    return;
  }
  window.routerInstance = router(routes, NotFound);
})();
