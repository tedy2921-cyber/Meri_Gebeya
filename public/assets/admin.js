/* =============================================================================
   admin.js — Meri Gebeya seller console.
   Same core.js toolkit as the storefront; every screen is a route handler that
   re-renders #view and wires its own controls.
   ============================================================================= */

import {
  api, ETB, etbShort, num, dateShort, dateTime, ago, esc, el, $, $$, toast,
  modal, confirmBox, paintErrors, formValues, field, moneyInput, statusChip,
  ORDER_STATUS, router, thumb,
} from "./core.js";

const v = () => $("#view");
const title = (t, hint = "") => {
  $("#adminTitle").textContent = t;
  $("#adminHint").textContent = hint;
  $("#adminActions").innerHTML = "";      // each page paints its own actions after this
};
const actions = (html = "") => { $("#adminActions").innerHTML = html; };

let ME = null;

const NAV = [
  ["", "📊 Dashboard"],
  ["orders", "📦 Orders"],
  ["products", "🏷 Products"],
  ["categories", "🗂 Categories"],
  ["customers", "👥 Customers"],
  ["coupons", "🎟 Coupons"],
  ["reviews", "⭐ Reviews"],
  ["inventory", "📈 Inventory"],
  ["events", "🧭 Activity"],
];

function nav(path) {
  $("#adminNav").innerHTML = NAV.map(([k, label]) =>
    `<a href="#/${k}" class="${(path.slice(2) || "") === k ? "on" : ""}">${label}</a>`).join("");
}

/* ---------------------------------------------------------------- gate/login */

function Gate(msg) {
  title("Sign in", "");
  actions("");
  nav("/admin");
  v().innerHTML = `<div class="gate panel">
    <h1>Seller console</h1>
    <p class="muted small">${msg || "Administrator account required. Demo: <b>admin@merigebeya.et</b> / <b>Admin12345</b>"}</p>
    ${field("email", "Email", `<input name="email" type="email" value="admin@merigebeya.et">`)}
    ${field("password", "Password", `<input name="password" type="password" value="Admin12345">`)}
    <button class="btn p blk" id="in">Sign in</button>
    <p class="tiny muted center" style="margin-top:12px"><a href="/">← back to the shop</a></p></div>`;
  const run = async () => {
    try {
      const r = await api.post("/auth/login", formValues($(".gate")));
      if (r.user.role !== "admin") { toast("That account is not an administrator", true); return; }
      ME = r.user;
      location.hash = "#/";
      start();
    } catch (e) { toast(e.message, true); }
  };
  $("#in").onclick = run;
  $$(".gate input").forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") run(); });
}

/* ================================================================ DASHBOARD */

async function Dashboard() {
  title("Dashboard", "Live numbers from the shop — everything below is one SQL query deep.");
  actions(`<span class="small muted">updated ${new Date().toLocaleTimeString()}</span>
    <button class="btn sm" id="refresh">↻ Refresh</button>`);
  $("#refresh").onclick = start;

  const m = await api.get("/admin/metrics");
  const maxDay = Math.max(1, ...m.by_day.map((d) => d.cents));
  const weekShare = m.revenue_cents ? Math.round(m.revenue_7d_cents / m.revenue_cents * 100) : 0;

  v().innerHTML = `
  <div class="metrics">
    <div class="metric"><div class="k">Revenue (all time)</div><div class="v">${etbShort(m.revenue_cents)}</div>
      <div class="d">Last 7 days <b class="up">${etbShort(m.revenue_7d_cents)}</b> · ${weekShare}% of total</div></div>
    <div class="metric gold"><div class="k">Orders</div><div class="v">${num(m.orders)}</div>
      <div class="d">${num(m.orders_today)} today · ${num(m.open_orders)} open</div></div>
    <div class="metric berry"><div class="k">Average basket</div><div class="v">${ETB(m.avg_order_cents)}</div>
      <div class="d">${num(m.units_sold)} units sold</div></div>
    <div class="metric"><div class="k">Active products</div><div class="v">${num(m.products)}</div>
      <div class="d">${num(m.drafts)} draft</div></div>
    <div class="metric chili"><div class="k">Low stock</div><div class="v">${num(m.low_stock.length)}</div>
      <div class="d">at or below their reorder point</div></div>
    <div class="metric gold"><div class="k">Customers</div><div class="v">${num(m.customers)}</div>
      <div class="d">${num(m.pending_reviews)} reviews awaiting moderation</div></div>
  </div>

  <div class="cols" style="margin-top:20px">
    <section class="panel">
      <div class="spread"><h3>Revenue, last 21 days</h3><span class="small muted">bars = ETB</span></div>
      <div class="chart">${m.by_day.length ? m.by_day.map((d) => `
        <div class="bar" style="height:${Math.max(4, Math.round(d.cents / maxDay * 100))}%"
             title="${dateShort(d.day + 'T00:00')} · ${ETB(d.cents)} · ${d.orders} orders">
          <b>${d.cents >= 100000 ? etbShort(d.cents).replace(" ETB", "") : ""}</b><span>${d.day.slice(8)}</span></div>`).join("")
        : `<p class="muted">No sales yet.</p>`}</div>
      <div class="chartx"></div>

      <h3 style="margin-top:16px">Top products by units</h3>
      <div class="hbars">${m.top_products.map((p) => {
        const top = m.top_products[0].units || 1;
        return `<div class="hbar"><span>${esc(p.name.length > 22 ? p.name.slice(0, 21) + "…" : p.name)}</span>
          <div class="track"><div class="fill" style="width:${Math.round(p.units / top * 100)}%"></div></div>
          <span class="num">${p.units} · ${etbShort(p.cents)}</span></div>`;
      }).join("") || `<p class="muted small">Nothing sold yet.</p>`}</div>
    </section>

    <div style="display:grid;gap:18px">
      <section class="panel">
        <h3>Categories by revenue</h3>
        <div class="hbars">${m.by_category.map((c) => {
          const top = m.by_category[0].cents || 1;
          return `<div class="hbar"><span>${esc(c.name)}</span>
            <div class="track"><div class="fill" style="width:${Math.max(3, Math.round(c.cents / top * 100))}%"></div></div>
            <span class="num">${etbShort(c.cents)}</span></div>`;
        }).join("")}</div>
      </section>

      <section class="panel">
        <div class="spread"><h3>Low stock</h3><a class="btn sm" href="#/inventory">Manage</a></div>
        ${m.low_stock.length ? `<div class="tablewrap"><table class="t dense"><tbody>
          ${m.low_stock.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${esc(p.sku)}</td>
            <td class="num"><b>${p.stock}</b> <span class="muted tiny">of ${p.low_stock_at}</span></td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted small">Every product is above its reorder point 👌</p>`}
      </section>

      <section class="panel">
        <div class="spread"><h3>Latest orders</h3><a class="btn sm" href="#/orders">All orders</a></div>
        <div class="tablewrap"><table class="t dense"><tbody>
          ${m.recent_orders.map((o) => `<tr>
            <td class="mono">${esc(o.number)}</td><td>${esc(o.ship_name)}</td>
            <td>${statusChip(o.status)}</td><td class="num">${ETB(o.total_cents)}</td>
            <td class="tiny muted">${ago(o.placed_at)}</td>
            <td class="actions"><a class="btn sm" href="#/orders/${o.id}">Open</a></td></tr>`).join("")}
        </tbody></table></div>
      </section>
    </div>
  </div>`;
}

/* ==================================================================== ORDERS */

async function Orders({ params }) {
  title("Orders", "Click a row to open it. Stock returns automatically when you cancel.");
  if (params.id) return OrderDetail(Number(params.id));

  const state = { status: location.hash.includes("status=") ? "all" : "all", q: "" };
  actions(`<input class="input" id="osearch" placeholder="Search number, name, email…" style="padding:9px 12px;border-radius:10px;border:1px solid var(--line-2)">
    <select id="ostatus" style="padding:9px 12px;border-radius:10px;border:1px solid var(--line-2)">
      ${["all", ...Object.keys(ORDER_STATUS)].map((s) => `<option value="${s}">${s === "all" ? "All statuses" : ORDER_STATUS[s].label}</option>`).join("")}
    </select><button class="btn sm" id="orefresh">↻</button>`);

  const load = async () => {
    const r = await api.get("/admin/orders?" + api.qs({ status: state.status === "all" ? "" : state.status, q: state.q }));
    const counts = Object.fromEntries(r.counts.map((c) => [c.status, c]));
    v().innerHTML = `
      <div class="filters-row">${["all", ...Object.keys(ORDER_STATUS)].map((s) =>
        `<button data-f="${s}" class="${state.status === s ? "on" : ""}">${s === "all" ? "All" : ORDER_STATUS[s].label}
          ${counts[s] ? ` (${counts[s].n})` : ""}</button>`).join("")}</div>
      <div class="tablewrap card"><table class="t">
        <thead><tr><th>Number</th><th>Placed</th><th>Customer</th><th>Zone</th><th>Payment</th>
          <th class="num">Items</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.items.map((o) => `<tr data-open="${o.id}" style="cursor:pointer">
          <td class="mono">${esc(o.number)}</td>
          <td>${dateTime(o.placed_at)}</td>
          <td>${esc(o.ship_name)}<br><span class="tiny muted">${esc(o.email)}</span></td>
          <td>${esc(o.zone_name || "—")}</td>
          <td><span class="tiny">${esc(o.payment_method)}</span><br>
            <span class="pill ${o.payment_status === "paid" ? "active" : "pending"}">${esc(o.payment_status)}</span></td>
          <td class="num">${o.line_count}</td>
          <td class="num"><b>${ETB(o.total_cents)}</b></td>
          <td>${statusChip(o.status)}</td>
          <td class="actions"><button class="btn sm">Open</button></td></tr>`).join("") ||
          `<tr><td colspan="9" class="center muted" style="padding:30px">No orders match.</td></tr>`}
        </tbody></table></div>`;
    $$("[data-open]", v()).forEach((tr) => tr.onclick = () => go(`#/orders/${tr.dataset.open}`));
    $$("[data-f]", v()).forEach((b) => b.onclick = () => { state.status = b.dataset.f; load(); });
  };
  $("#osearch").oninput = (e) => { state.q = e.target.value; load(); };
  $("#ostatus").onchange = (e) => { state.status = e.target.value; load(); };
  $("#orefresh").onclick = load;
  await load();
}

async function OrderDetail(id) {
  const { order: o } = await api.get(`/orders/${id}`);
  const next = ORDER_STATUS[o.status]?.next || [];
  title(`Order ${o.number}`, `${o.status} · placed ${dateTime(o.placed_at)} · ${o.zone_name || "no zone"}`);
  actions(`<a class="btn sm" href="#/orders">← All orders</a>`);

  v().innerHTML = `<div class="cols">
    <section class="panel">
      <div class="spread"><h3>Items</h3>${statusChip(o.status)} <span class="pill ${o.payment_status === "paid" ? "active" : "pending"}">${esc(o.payment_status)}</span></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line</th></tr></thead>
        <tbody>${o.items.map((i) => `<tr>
          <td><div class="cellname"><img src="${esc(i.image_url || "/img/placeholder.svg")}" alt="">
            <span>${esc(i.name_snapshot)}<br><span class="tiny muted mono">${esc(i.sku_snapshot)}</span></span></div></td>
          <td class="num">${i.qty}</td><td class="num">${ETB(i.unit_price_cents)}</td>
          <td class="num"><b>${ETB(i.line_total_cents)}</b></td></tr>`).join("")}</tbody></table></div>
      <div class="lines" style="margin-top:12px">
        <div><span>Subtotal</span><b>${ETB(o.subtotal_cents)}</b></div>
        ${o.discount_cents ? `<div><span>Discount ${o.coupon_code ? "· " + esc(o.coupon_code) : ""}</span><b style="color:var(--chili)">−${ETB(o.discount_cents)}</b></div>` : ""}
        <div><span>Delivery</span><b>${o.delivery_cents ? ETB(o.delivery_cents) : "Free"}</b></div>
        <div class="tot"><span>Total</span><span>${ETB(o.total_cents)}</span></div>
      </div>
    </section>

    <div style="display:grid;gap:18px">
      <section class="panel">
        <h3>Move this order</h3>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          ${next.map((s) => `<button class="btn ${s === o.status ? "" : s === "cancelled" || s === "refunded" ? "d" : "p"} sm" data-move="${s}">
            → ${ORDER_STATUS[s]?.label || s}</button>`).join("") || `<p class="muted small">This order is final.</p>`}
        </div>
        <div class="timeline" style="margin-top:16px">${o.timeline.map((s) =>
          `<div class="t ${s.done ? "done" : ""}"><span class="dot"></span><div><b>${esc(s.label)}</b>
            <span>${s.at ? dateTime(s.at) : "waiting"}</span></div></div>`).join("")}</div>
      </section>

      <section class="panel">
        <h3>Customer</h3>
        <div class="kv">
          <div><span>Name</span><b>${esc(o.ship_name)}</b></div>
          <div><span>Phone</span><b>${esc(o.ship_phone)}</b></div>
          <div><span>Email</span><b>${esc(o.email)}</b></div>
          <div><span>Method</span><b>${esc(o.payment_method)}</b></div>
        </div>
        <p style="margin:10px 0 0"><b>${esc([o.ship_subcity, o.ship_woreda, o.ship_landmark].filter(Boolean).join(", "))}</b><br>
          <span class="muted small">${esc(o.ship_city)}, ${esc(o.ship_region)}</span></p>
        ${o.instructions ? `<div class="banner warn" style="margin-top:10px">📝 ${esc(o.instructions)}</div>` : ""}
        <p class="small muted" style="margin-top:10px">Reference ${esc(o.payments[0]?.reference || "—")}</p>
        ${o.payments[0] && o.payments[0].status !== "captured" && o.payment_method !== "cod"
          ? `<button class="btn g sm" data-pay="${esc(o.payments[0].reference)}">Mark payment captured</button>` : ""}
        ${o.cancelled_reason ? `<div class="banner bad" style="margin-top:10px">Cancelled: ${esc(o.cancelled_reason)}</div>` : ""}
      </section>
    </div>
  </div>`;

  $$("[data-move]").forEach((b) => b.onclick = async () => {
    const to = b.dataset.move;
    if (["cancelled", "refunded"].includes(to) && !await confirmBox(
      `Move to ${ORDER_STATUS[to].label}? Stock goes back on the shelf.`)) return;
    const reason = to === "cancelled" ? (prompt("Reason (optional):") || "Cancelled by staff") : null;
    try {
      await api.patch(`/admin/orders/${o.id}`, { status: to, reason });
      toast(`Order is now ${ORDER_STATUS[to].label}`);
      OrderDetail(o.id);
    } catch (e) { toast(e.message, true); }
  });
  $$("[data-pay]").forEach((b) => b.onclick = async () => {
    try { await api.post(`/payments/${b.dataset.pay}/confirm`); toast("Payment captured"); OrderDetail(o.id); }
    catch (e) { toast(e.message, true); }
  });
}

/* ================================================================= PRODUCTS */

async function Products({ params }) {
  title("Products", `${params.id ? "Edit one product" : "Create, edit, price and publish"}`);
  if (params.id) return ProductDetail(Number(params.id));

  const state = { q: "", status: "all", low: "" };
  actions(`<button class="btn p sm" id="newProduct">+ New product</button>`);
  $("#newProduct").onclick = () => productModal(null);

  const load = async () => {
    const r = await api.get("/admin/products?" + api.qs(state));
    v().innerHTML = `<div class="toolbar admin">
        <input type="search" id="pq" placeholder="Search name, SKU, brand…" value="${esc(state.q)}">
        <select id="ps">${["all", "active", "draft", "archived"].map((s) =>
          `<option ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        <label class="row small"><input type="checkbox" id="plow" ${state.low ? "checked" : ""}> Low stock only</label>
        <span class="grow"></span><span class="small muted">${r.total} product(s)</span></div>
      <div class="tablewrap card"><table class="t">
        <thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Compare</th>
          <th class="num">Stock</th><th class="num">Rating</th><th class="num">Views</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.items.map((p) => `<tr class="${p.stock <= p.low_stock_at ? (p.stock ? "low" : "out") : ""}">
          <td><div class="cellname"><img src="${esc((p.images && p.images[0]?.url) || "/img/placeholder.svg")}" alt="">
            <span><a href="#/products/${p.id}"><b>${esc(p.name)}</b></a><br>
            <span class="tiny muted">${esc(p.name_am || "")} · <span class="mono">${esc(p.sku)}</span></span></span></div></td>
          <td>${esc(p.category_name || "—")}${p.featured ? ` <span class="chip hot">★</span>` : ""}</td>
          <td class="num">${ETB(p.price_cents)}</td>
          <td class="num">${p.compare_at_price_cents ? `<s class="muted">${ETB(p.compare_at_price_cents)}</s>` : "—"}</td>
          <td class="num"><b>${p.stock}</b>${p.stock <= p.low_stock_at ? ` <span class="pill pending">low</span>` : ""}</td>
          <td class="num">${p.rating_avg ? p.rating_avg.toFixed(1) + " ★" : "—"}<br><span class="tiny muted">${p.rating_count}</span></td>
          <td class="num">${num(p.view_count)}</td>
          <td><span class="pill ${p.status}">${p.status}</span></td>
          <td class="actions">
            <button class="btn sm" data-edit="${p.id}">Edit</button>
            <button class="btn ghost sm" data-del="${p.id}" title="Delete">✕</button></td></tr>`).join("")}
        </tbody></table></div>
      ${r.pages > 1 ? `<div class="pager">${Array.from({ length: r.pages }, (_, i) => i + 1)
        .map((p) => `<button data-page="${p}" class="${p === r.page ? "on" : ""}">${p}</button>`).join("")}</div>` : ""}`;

    $("#pq").oninput = (e) => { state.q = e.target.value; load(); };
    $("#ps").onchange = (e) => { state.status = e.target.value; load(); };
    $("#plow").onchange = (e) => { state.low = e.target.checked ? "1" : ""; load(); };
    $$("[data-edit]", v()).forEach((b) => b.onclick = () => productModal(r.items.find((p) => p.id == b.dataset.edit)));
    $$("[data-del]", v()).forEach((b) => b.onclick = async () => {
      if (!await confirmBox("Delete this product? Products with sales are archived instead.")) return;
      const out = await api.del(`/admin/products/${b.dataset.del}`);
      toast(out.archived ? out.reason : "Product deleted");
      load();
    });
    $$("[data-page]", v()).forEach((btn) => btn.onclick = () => { state.status = $("#ps").value; load(); });
  };
  await load();
}

function productModal(p) {
  modal({
    wide: true,
    title: p ? `Edit ${p.name}` : "New product",
    okLabel: p ? "Save changes" : "Create product",
    body: `<div>
      <div class="duo">
        ${field("name", "Name (English)", `<input name="name" value="${esc(p?.name || "")}">`)}
        ${field("name_am", "Name (አማርኛ)", `<input name="name_am" class="am" value="${esc(p?.name_am || "")}">`)}
      </div>
      <div class="trio">
        ${field("sku", "SKU", `<input name="sku" value="${esc(p?.sku || "")}" ${p ? "disabled" : ""}>`)}
        ${field("brand", "Brand", `<input name="brand" value="${esc(p?.brand || "")}">`)}
        ${field("unit", "Unit", `<input name="unit" value="${esc(p?.unit || "piece")}">`)}
      </div>
      <div class="trio">
        ${moneyInput("price", "Price", p ? (p.price_cents / 100) : "")}
        ${moneyInput("compare_at_price", "Compare-at price", p?.compare_at_price_cents ? p.compare_at_price_cents / 100 : "")}
        ${field("stock", "Stock", `<input name="stock" type="number" min="0" value="${p?.stock ?? 0}">`)}
      </div>
      <div class="trio">
        ${field("category_id", "Category", `<select name="category_id">${window.__cats.map((c) =>
          `<option value="${c.id}" ${p?.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          <option value="">— none —</option></select>`)}
        ${field("status", "Status", `<select name="status">${["active", "draft", "archived"].map((s) =>
          `<option ${p?.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>`)}
        ${field("low_stock_at", "Low-stock alert at", `<input name="low_stock_at" type="number" min="0" value="${p?.low_stock_at ?? 5}">`)}
      </div>
      ${field("description", "Description (English)", `<textarea name="description">${esc(p?.description || "")}</textarea>`)}
      ${field("description_am", "Description (አማርኛ)", `<textarea name="description_am" class="am">${esc(p?.description_am || "")}</textarea>`)}
      <label class="row small"><input type="checkbox" name="featured" ${p?.featured ? "checked" : ""}> Feature on the home page</label>
      ${!p ? `<p class="tiny muted">A placeholder image is generated from the category if you leave images empty.</p>` : ""}
    </div>`,
    onOk: async (box) => {
      const val = formValues(box);
      const body = {
        ...val,
        price: Number(val.price),
        compare_at_price: val.compare_at_price ? Number(val.compare_at_price) : null,
        stock: Number(val.stock), low_stock_at: Number(val.low_stock_at),
        category_id: val.category_id ? Number(val.category_id) : null,
        featured: val.featured ? 1 : 0,
      };
      if (!p) body.images = [`/img/placeholder.svg`];
      try {
        if (p) await api.patch(`/admin/products/${p.id}`, body);
        else await api.post("/admin/products", body);
        toast(p ? "Product updated" : "Product created 🎉");
        Products({ params: {} });
        return true;
      } catch (e) { paintErrors(box, e.fields); toast(e.message, true); return false; }
    },
  });
}

async function ProductDetail(id) {
  const p = await api.get(`/admin/products/${id}`);
  title(p.name, `${p.sku} · ${p.status} · ${ETB(p.price_cents)}`);
  actions(`<a class="btn sm" href="#/products">← Products</a>
    <button class="btn p sm" id="editP">Edit</button>
    <button class="btn g sm" id="restock">+ Restock</button>`);

  v().innerHTML = `<div class="cols">
    <section class="panel">
      <div class="row" style="gap:16px;align-items:flex-start">
        <img src="${esc(p.images[0]?.url || "/img/placeholder.svg")}" alt="" style="width:200px;border-radius:var(--r);border:1px solid var(--line)">
        <div class="grow">
          <h3>${esc(p.name)}</h3>
          ${p.name_am ? `<p class="am muted">${esc(p.name_am)}</p>` : ""}
          <p class="small">${esc(p.description)}</p>
          <div class="kv">
            <div><span>Category</span><b>${esc((window.__cats.find((c) => c.id === p.category_id) || {}).name || "—")}</b></div>
            <div><span>Brand</span><b>${esc(p.brand || "—")}</b></div>
            <div><span>Stock</span><b>${p.stock} ${esc(p.unit)}</b></div>
            <div><span>Reorder point</span><b>${p.low_stock_at}</b></div>
            <div><span>Rating</span><b>${p.rating_avg || 0} ★ (${p.rating_count})</b></div>
            <div><span>Views</span><b>${num(p.view_count)}</b></div>
          </div>
        </div>
      </div>
      <h3 style="margin-top:20px">Inventory ledger</h3>
      <div class="tablewrap"><table class="t dense"><thead><tr><th>When</th><th>Change</th><th>Reason</th><th>Order</th><th>Note</th></tr></thead>
        <tbody>${p.movements.map((m) => `<tr>
          <td>${dateTime(m.created_at)}</td>
          <td class="num"><b style="color:${m.delta < 0 ? "var(--chili)" : "var(--brand)"}">${m.delta > 0 ? "+" : ""}${m.delta}</b></td>
          <td><span class="pill ${m.reason === "sale" ? "pending" : "active"}">${esc(m.reason)}</span></td>
          <td class="mono tiny">${m.order_id || "—"}</td><td class="tiny muted">${esc(m.note || "")}</td></tr>`).join("") ||
          `<tr><td colspan="5" class="muted small">No movements yet.</td></tr>`}</tbody></table></div>
    </section>

    <div style="display:grid;gap:18px">
      <section class="panel">
        <h3>Quick adjust</h3>
        <div class="stockedit">
          <input id="delta" type="number" value="10" step="1">
          <select id="reason">${["restock", "return", "adjust"].map((r) => `<option>${r}</option>`).join("")}</select>
          <button class="btn p sm" id="applyAdj">Apply</button>
        </div>
        <p class="tiny muted">Positive adds stock, negative removes it. Each click writes a ledger row.</p>
      </section>
      <section class="panel">
        <h3>Numbers</h3>
        <div class="metrics" style="grid-template-columns:1fr 1fr">
          <div class="metric"><div class="k">Price</div><div class="v">${ETB(p.price_cents)}</div></div>
          <div class="metric gold"><div class="k">Margin value</div><div class="v">${etbShort(p.price_cents * p.stock)}</div>
            <div class="d">stock at current price</div></div>
        </div>
        ${p.compare_at_price_cents ? `<p class="small muted" style="margin-top:10px">Showing a strike-through at ${ETB(p.compare_at_price_cents)} —
          a ${Math.round((1 - p.price_cents / p.compare_at_price_cents) * 100)}% perceived discount.</p>` : ""}
      </section>
    </div>
  </div>`;

  $("#editP").onclick = () => productModal(p);
  $("#restock").onclick = () => { $("#delta").value = 50; $("#reason").value = "restock"; $("#applyAdj").click(); };
  $("#applyAdj").onclick = async () => {
    try {
      const r = await api.post("/admin/inventory", {
        product_id: p.id, delta: Number($("#delta").value), reason: $("#reason").value, note: "console quick adjust",
      });
      toast(`Stock is now ${r.stock}`);
      ProductDetail(p.id);
    } catch (e) { toast(e.message, true); }
  };
}

/* =============================================================== CATEGORIES */

async function Categories() {
  title("Categories", "The navigation your shoppers see, in English and አማርኛ.");
  actions(`<button class="btn p sm" id="newCat">+ New category</button>`);
  const { items } = await api.get("/admin/categories");
  v().innerHTML = `<div class="tablewrap card"><table class="t">
    <thead><tr><th>Name</th><th>Amharic</th><th>Slug</th><th>Icon</th><th class="num">Products</th><th>Sort</th><th>Active</th><th></th></tr></thead>
    <tbody>${items.map((c) => `<tr>
      <td><b>${esc(c.name)}</b>${c.parent_id ? `<br><span class="tiny muted">child of #${c.parent_id}</span>` : ""}</td>
      <td class="am">${esc(c.name_am || "—")}</td>
      <td class="mono">${esc(c.slug)}</td><td>${esc(c.icon || "")}</td>
      <td class="num">${c.product_count}</td><td class="num">${c.sort}</td>
      <td>${c.active ? "✔" : "✕"}</td>
      <td class="actions"><button class="btn sm" data-edit="${c.id}">Edit</button>
        <button class="btn ghost sm" data-del="${c.id}">✕</button></td></tr>`).join("")}</tbody></table></div>`;

  $("#newCat").onclick = () => catModal(null);
  $$("[data-edit]").forEach((b) => b.onclick = () => catModal(items.find((c) => c.id == b.dataset.edit)));
  $$("[data-del]").forEach((b) => b.onclick = async () => {
    if (!await confirmBox("Delete this category? Its products stay but lose the category.")) return;
    await api.del(`/admin/categories/${b.dataset.del}`);
    toast("Category deleted");
    window.__cats = (await api.get("/admin/categories")).items;
    Categories();
  });
}

function catModal(c) {
  modal({
    title: c ? "Edit category" : "New category", okLabel: "Save",
    body: `<div>
      <div class="duo">
        ${field("name", "Name", `<input name="name" value="${esc(c?.name || "")}">`)}
        ${field("name_am", "Name (አማርኛ)", `<input name="name_am" class="am" value="${esc(c?.name_am || "")}">`)}
      </div>
      ${field("slug", "Slug", `<input name="slug" value="${esc(c?.slug || "")}" placeholder="auto from name">`)}
      <div class="duo">
        ${field("icon", "Icon (emoji)", `<input name="icon" value="${esc(c?.icon || "🧺")}">`)}
        ${field("sort", "Sort order", `<input name="sort" type="number" value="${c?.sort ?? 0}">`)}
      </div>
      ${field("blurb", "Short blurb", `<input name="blurb" value="${esc(c?.blurb || "")}">`)}
      <label class="row small"><input type="checkbox" name="active" ${c && !c.active ? "" : "checked"}> Active</label>
    </div>`,
    onOk: async (box) => {
      const val = formValues(box);
      try {
        const body = { ...val, sort: Number(val.sort || 0), active: val.active ? 1 : 0 };
        if (c) await api.patch(`/admin/categories/${c.id}`, body); else await api.post("/admin/categories", body);
        window.__cats = (await api.get("/admin/categories")).items;
        toast("Category saved");
        Categories();
        return true;
      } catch (e) { paintErrors(box, e.fields); toast(e.message, true); return false; }
    },
  });
}

/* =============================================================== CUSTOMERS */

async function Customers() {
  title("Customers", "Sorted by what they have actually spent with you.");
  const state = { q: "" };
  const load = async () => {
    const { items } = await api.get("/admin/customers?" + api.qs(state));
    v().innerHTML = `<div class="toolbar admin"><input type="search" id="cq" placeholder="Search name, email, phone…" value="${esc(state.q)}"></div>
      <div class="tablewrap card"><table class="t">
        <thead><tr><th>Customer</th><th>Phone</th><th>Role</th><th class="num">Orders</th><th class="num">Spend</th><th>Since</th><th>Active</th><th></th></tr></thead>
        <tbody>${items.map((u) => `<tr>
          <td><b>${esc(u.name)}</b><br><span class="tiny muted">${esc(u.email)}</span></td>
          <td>${esc(u.phone || "—")}</td>
          <td>${u.role === "admin" ? `<span class="chip hot">admin</span>` : "customer"}</td>
          <td class="num">${u.order_count}</td>
          <td class="num"><b>${ETB(u.spend_cents)}</b></td>
          <td class="tiny">${dateShort(u.created_at)}</td>
          <td>${u.active ? "✔" : "✕"}</td>
          <td class="actions">${u.role === "customer" ? `<button class="btn sm" data-toggle="${u.id}" data-on="${u.active}">${u.active ? "Disable" : "Enable"}</button>` : ""}
            <button class="btn ghost sm" data-open="${u.id}">Details</button></td></tr>`).join("")}
        </tbody></table></div>`;
    $("#cq").oninput = (e) => { state.q = e.target.value; load(); };
    $$("[data-toggle]").forEach((b) => b.onclick = async () => {
      await api.patch(`/admin/customers/${b.dataset.toggle}`, { active: b.dataset.on === "1" ? 0 : 1 });
      toast("Customer updated"); load();
    });
    $$("[data-open]").forEach((b) => b.onclick = async () => {
      const { customer } = await api.get(`/admin/customers/${b.dataset.open}`);
      modal({
        wide: true, title: `${customer.name} — ${customer.email}`, okLabel: "Close", cancelLabel: "✕",
        body: `<div class="kv">
            <div><span>Phone</span><b>${esc(customer.phone || "—")}</b></div>
            <div><span>Language</span><b>${customer.lang}</b></div>
            <div><span>Joined</span><b>${dateShort(customer.created_at)}</b></div>
            <div><span>Orders</span><b>${customer.orders.length}</b></div>
          </div>
          <h4 style="margin-top:16px">Orders</h4>
          ${customer.orders.map((o) => `<div class="opt"><span>${esc(o.number)} · ${dateTime(o.placed_at)}</span>
            <span>${statusChip(o.status)} <b>${ETB(o.total_cents)}</b></span></div>`).join("") || `<p class="muted small">No orders yet.</p>`}
          <h4 style="margin-top:16px">Addresses</h4>
          ${customer.addresses.map((a) => `<p class="small">📍 <b>${esc(a.label)}</b> — ${esc(a.recipient)}, ${esc(a.city)} ${esc(a.subcity || "")}</p>`).join("") || `<p class="muted small">None saved.</p>`}
          <h4 style="margin-top:16px">Reviews</h4>
          ${customer.reviews.map((r) => `<p class="small">${r.rating}★ on ${esc(r.product_name)} <span class="muted">(${r.status})</span></p>`).join("") || `<p class="muted small">None written.</p>`}`,
        onOk: () => true,
      });
    });
  };
  await load();
}

/* ================================================================= COUPONS */

async function Coupons() {
  title("Coupons", "Percent or fixed, with spend thresholds and usage caps.");
  actions(`<button class="btn p sm" id="newCoupon">+ New coupon</button>`);
  $("#newCoupon").onclick = () => couponModal(null);
  const { items } = await api.get("/admin/coupons");
  v().innerHTML = `<div class="tablewrap card"><table class="t">
    <thead><tr><th>Code</th><th>Type</th><th class="num">Value</th><th class="num">Min spend</th><th class="num">Cap</th>
      <th class="num">Used</th><th>Expires</th><th>Active</th><th>Note</th><th></th></tr></thead>
    <tbody>${items.map((c) => `<tr>
      <td><b class="mono">${esc(c.code)}</b></td><td>${c.kind}</td>
      <td class="num">${c.kind === "percent" ? c.value + "%" : ETB(c.value)}</td>
      <td class="num">${c.min_subtotal_cents ? ETB(c.min_subtotal_cents) : "—"}</td>
      <td class="num">${c.max_discount_cents ? ETB(c.max_discount_cents) : "—"}</td>
      <td class="num">${c.used_count}${c.usage_limit ? " / " + c.usage_limit : ""}</td>
      <td class="tiny">${c.expires_at ? dateShort(c.expires_at) : "no end"}</td>
      <td>${c.active ? "✔" : "✕"}</td>
      <td class="tiny muted">${esc(c.note || "")}</td>
      <td class="actions"><button class="btn sm" data-edit="${esc(c.code)}">Edit</button>
        <button class="btn ghost sm" data-del="${esc(c.code)}">✕</button></td></tr>`).join("")}</tbody></table></div>`;

  $$("[data-edit]").forEach((b) => b.onclick = () => couponModal(items.find((c) => c.code === b.dataset.edit)));
  $$("[data-del]").forEach((b) => b.onclick = async () => {
    if (!await confirmBox(`Delete coupon ${b.dataset.del}?`)) return;
    await api.del(`/admin/coupons/${b.dataset.del}`);
    toast("Coupon deleted"); Coupons();
  });
}

function couponModal(c) {
  modal({
    title: c ? `Edit ${c.code}` : "New coupon", okLabel: "Save",
    body: `<div>
      <div class="duo">
        ${field("code", "Code", `<input name="code" value="${esc(c?.code || "")}" ${c ? "disabled" : ""} placeholder="MERI10">`)}
        ${field("kind", "Type", `<select name="kind"><option value="percent" ${c?.kind === "percent" ? "selected" : ""}>Percent off</option>
          <option value="fixed" ${c?.kind === "fixed" ? "selected" : ""}>Fixed ETB off</option></select>`)}
      </div>
      <div class="trio">
        ${field("value", "Value", `<input name="value" type="number" min="1" value="${c ? (c.kind === "percent" ? c.value : c.value / 100) : 10}">`)}
        ${moneyInput("min_subtotal", "Min. subtotal", c ? c.min_subtotal_cents / 100 : "")}
        ${moneyInput("max_discount", "Max. discount", c?.max_discount_cents ? c.max_discount_cents / 100 : "")}
      </div>
      <div class="duo">
        ${field("expires_at", "Expires", `<input name="expires_at" type="date" value="${esc(c?.expires_at?.slice(0, 10) || "")}">`)}
        ${field("usage_limit", "Usage limit", `<input name="usage_limit" type="number" min="1" value="${c?.usage_limit ?? ""}">`)}
      </div>
      ${field("note", "Internal note", `<input name="note" value="${esc(c?.note || "")}">`)}
      <label class="row small"><input type="checkbox" name="active" ${c && !c.active ? "" : "checked"}> Active</label>
      <p class="tiny muted">For “fixed” coupons the value is in ETB.</p></div>`,
    onOk: async (box) => {
      const val = formValues(box);
      try {
        const body = {
          ...val,
          value: Number(val.value),
          min_subtotal: Number(val.min_subtotal || 0),
          max_discount: val.max_discount ? Number(val.max_discount) : null,
          usage_limit: val.usage_limit ? Number(val.usage_limit) : null,
          expires_at: val.expires_at ? val.expires_at + "T23:59:00.000Z" : null,
          active: val.active ? 1 : 0,
        };
        if (c) await api.patch(`/admin/coupons/${c.code}`, body); else await api.post("/admin/coupons", body);
        toast("Coupon saved");
        Coupons();
        return true;
      } catch (e) { paintErrors(box, e.fields); toast(e.message, true); return false; }
    },
  });
}

/* ================================================================= REVIEWS */

async function Reviews() {
  title("Reviews", "Approved reviews show on the product page and move the star average.");
  const state = { status: "" };
  const load = async () => {
    const { items } = await api.get("/admin/reviews?" + api.qs(state));
    v().innerHTML = `<div class="filters-row">${[["", "All"], ["pending", "Pending"], ["published", "Published"], ["rejected", "Rejected"]]
      .map(([k, label]) => `<button data-f="${k}" class="${state.status === k ? "on" : ""}">${label}</button>`).join("")}</div>
      <div class="tablewrap card"><table class="t">
        <thead><tr><th>Product</th><th>Customer</th><th class="num">Rating</th><th>Headline</th><th>Body</th><th>When</th><th>Status</th><th></th></tr></thead>
        <tbody>${items.map((r) => `<tr>
          <td><a class="mono tiny" href="#/products/${r.product_id}">${esc(r.product_name)}</a></td>
          <td>${esc(r.customer)}</td>
          <td class="num">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</td>
          <td><b>${esc(r.title || "—")}</b></td>
          <td class="tiny muted" style="max-width:260px">${esc((r.body || "").slice(0, 120))}${(r.body || "").length > 120 ? "…" : ""}</td>
          <td class="tiny">${ago(r.created_at)}</td>
          <td><span class="pill ${r.status === "published" ? "active" : r.status === "pending" ? "pending" : "archived"}">${r.status}</span></td>
          <td class="actions">
            ${r.status !== "published" ? `<button class="btn p sm" data-st="${r.id}" data-to="published">Approve</button>` : ""}
            ${r.status !== "rejected" ? `<button class="btn ghost sm" data-st="${r.id}" data-to="rejected">Reject</button>` : ""}</td></tr>`).join("") ||
          `<tr><td colspan="8" class="center muted" style="padding:26px">No reviews here.</td></tr>`}
        </tbody></table></div>`;
    $$("[data-f]", v()).forEach((b) => b.onclick = () => { state.status = b.dataset.f; load(); });
    $$("[data-st]").forEach((b) => b.onclick = async () => {
      await api.patch(`/admin/reviews/${b.dataset.st}`, { status: b.dataset.to });
      toast("Review " + b.dataset.to); load();
    });
  };
  await load();
}

/* ================================================================ INVENTORY */

async function Inventory() {
  title("Inventory", "Everything at or below its reorder point, plus the full movement ledger.");
  const r = await api.get("/admin/products?low=1&per=100");
  const { items: moves } = await api.get("/admin/movements");
  v().innerHTML = `<div class="cols">
    <section class="panel">
      <h3>Needs attention (${r.total})</h3>
      ${r.items.length ? `<div class="tablewrap"><table class="t dense">
        <thead><tr><th>Product</th><th class="num">Stock</th><th class="num">At</th><th>Restock</th><th></th></tr></thead>
        <tbody>${r.items.map((p) => `<tr>
          <td><b>${esc(p.name)}</b><br><span class="tiny muted mono">${esc(p.sku)}</span></td>
          <td class="num"><b>${p.stock}</b></td><td class="num muted">${p.low_stock_at}</td>
          <td><input type="number" value="20" min="1" data-add="${p.id}" style="width:76px;padding:6px 8px;border:1px solid var(--line-2);border-radius:8px"></td>
          <td><button class="btn p sm" data-restock="${p.id}">Add</button></td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted small">Nothing is below its reorder point. 🎉</p>`}
    </section>
    <section class="panel">
      <h3>Recent movements</h3>
      <div class="tablewrap"><table class="t dense"><thead><tr><th>When</th><th>Product</th><th class="num">Δ</th><th>Reason</th></tr></thead>
        <tbody>${moves.slice(0, 40).map((m) => `<tr>
          <td class="tiny">${dateTime(m.created_at)}</td><td>${esc(m.product_name)}</td>
          <td class="num" style="color:${m.delta < 0 ? "var(--chili)" : "var(--brand)"}">${m.delta > 0 ? "+" : ""}${m.delta}</td>
          <td><span class="pill ${m.reason === "sale" ? "pending" : "active"}">${esc(m.reason)}</span></td></tr>`).join("")}</tbody></table></div>
    </section></div>`;

  $$("[data-restock]").forEach((b) => b.onclick = async () => {
    const qty = Number($(`[data-add="${b.dataset.restock}"]`).value || 0);
    if (!qty) return toast("Type a quantity", true);
    const out = await api.post("/admin/inventory", { product_id: Number(b.dataset.restock), delta: qty, reason: "restock", note: "one-click restock" });
    toast(`${out.name} → ${out.stock} in stock`);
    Inventory();
  });
}

/* =================================================================== EVENTS */

async function Events() {
  title("Activity", "What the smart features read from: views, carts, orders, coupons.");
  const { items } = await api.get("/admin/events");
  const counts = items.reduce((map, e) => (map[e.type] = (map[e.type] || 0) + 1, map), {});
  v().innerHTML = `<div class="cols">
    <section class="panel">
      <h3>Latest</h3>
      <div class="tablewrap"><table class="t dense"><thead><tr><th>When</th><th>Event</th><th>Product</th><th>Who</th></tr></thead>
        <tbody>${items.map((e) => `<tr>
          <td class="tiny">${dateTime(e.created_at)}</td><td><span class="mono tiny">${esc(e.type)}</span></td>
          <td>${esc(e.product_name || "—")}</td><td class="tiny muted">${esc(e.user_email || "guest")}</td></tr>`).join("")}</tbody></table></div>
    </section>
    <section class="panel">
      <h3>This page</h3>
      <div class="hbars">${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
        const top = Object.values(counts)[0];
        return `<div class="hbar"><span class="mono tiny">${esc(k)}</span>
          <div class="track"><div class="fill" style="width:${Math.round(n / top * 100)}%"></div></div>
          <span class="num">${n}</span></div>`;
      }).join("")}</div>
      <p class="small muted" style="margin-top:14px">The <code>events</code> table is what powers best-sellers,
        “frequently bought together” and the view counts on each product card.</p>
    </section></div>`;
}

/* =================================================================== wiring */

const ROUTES = {
  "/": Dashboard,
  "/orders": Orders,
  "/orders/:id": Orders,
  "/products": Products,
  "/products/:id": Products,
  "/categories": Categories,
  "/customers": Customers,
  "/coupons": Coupons,
  "/reviews": Reviews,
  "/inventory": Inventory,
  "/events": Events,
};

$("#logout").onclick = async () => {
  await api.post("/auth/logout");
  ME = null;
  toast("Signed out");
  Gate("You signed out.");
};

async function start() {
  try {
    const me = await api.get("/me");
    if (!me.user) return Gate();
    if (me.user.role !== "admin") return Gate("That account is a shopper, not a staff member.");
    ME = me.user;
    $("#who").innerHTML = `<b>${esc(ME.name)}</b>administrator`;
    window.__cats = (await api.get("/admin/categories")).items;
    const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    nav(path);
    await router(ROUTES, () => {
      title("Not found", "");
      v().innerHTML = `<div class="empty panel"><div class="ico">🧭</div><h2>That console page doesn't exist</h2>
        <a class="btn p" href="#/">Dashboard</a></div>`;
    });
    return;
  } catch (e) {
    if (e.status === 401 || e.status === 403) return Gate();
    toast(e.message, true);
  }
}

/* re-render on every hash change without re-booting the session */
window.addEventListener("hashchange", () => {
  if (!ME) return;
  const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  nav(path);
  const key = path.split("/").filter(Boolean)[0] || "";
  const handler = ROUTES["/" + key] || ROUTES["/"];
  const params = {};
  const bits = path.split("/").filter(Boolean);
  if (key === "orders" && bits[1]) params.id = bits[1];
  if (key === "products" && bits[1]) params.id = bits[1];
  handler({ params, query: {} });
});

start();
