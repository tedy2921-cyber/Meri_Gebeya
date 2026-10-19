import { Router, badRequest, forbidden, notFound, unauthorized, requireFields, isEmail } from "./http.js";
import { all, get, run, config, nowIso, logEvent } from "./config.js";
import * as Catalog from "./catalog.js";
import * as Cart from "./cart.js";
import * as Orders from "./orders.js";
import * as Users from "./users.js";
import * as Admin from "./admin.js";

/* ------------------------------------------------------------------ *
 * One router for the whole JSON API. Every handler returns a plain
 * value; server.js turns it into 200 JSON (or ctx.status if set).
 * ------------------------------------------------------------------ */

export const api = new Router();

export function authenticate(ctx) {
  ctx.user = Users.userFromToken(ctx.cookies[config.cookieName]);
  return ctx.user;
}

const needUser = (ctx) => {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
};
const needAdmin = (ctx) => {
  if (!ctx.user) throw unauthorized("Sign in as an administrator");
  if (ctx.user.role !== "admin") throw forbidden("Administrator only");
  return ctx.user;
};

/** Cart for this request, issuing the guest cookie when it is brand new. */
function cartOf(ctx) {
  const cart = Cart.resolveCart(ctx);
  if (cart.issuedToken) {
    ctx.cookie(Cart.CART_COOKIE, cart.issuedToken, { maxAge: 60 * 60 * 24 * 30 });
  }
  return cart;
}

const cents = (n) => Math.round(Number(n) || 0);

/* Health & meta ------------------------------------------------------------ */

api.get("/api/health", () => ({
  ok: true, service: "meri-gebeya", time: nowIso(),
  currency: config.currency, env: config.env,
}));

api.get("/api/meta", () => ({
  currency: config.currency,
  zones: Cart.activeZones(),
  payment_providers: Orders.providers(),
  price_bounds: Catalog.priceBounds(),
  categories: Catalog.categories().map((c) => ({
    id: c.id, slug: c.slug, name: c.name, name_am: c.name_am, icon: c.icon,
    product_count: c.product_count, children: c.children.map((k) => ({ id: k.id, slug: k.slug, name: k.name, name_am: k.name_am })),
  })),
}));

/* Storefront home & catalog ------------------------------------------------ */

api.get("/api/home", () => {
  const featured = Catalog.listProducts({ featured: "1", per: 8 });
  return {
    hero: Catalog.bestSellers(6),
    featured: featured.items,
    newArrivals: Catalog.listProducts({ sort: "newest", per: 8 }).items,
    onSale: Catalog.listProducts({ onSale: "1", per: 8 }).items,
    categories: Catalog.categories(),
  };
});

api.get("/api/products", (ctx) => {
  const page = Catalog.listProducts(ctx.query);
  page.bounds = Catalog.priceBounds();
  return page;
});

api.get("/api/products/:slug", (ctx) => {
  const product = Catalog.findProduct(ctx.params.slug);
  if (!product) throw notFound("Product not found");
  if (product.status !== "active" && ctx.user?.role !== "admin") throw notFound("Product not found");

  Catalog.recordView(product.id, ctx.user?.id || null);
  const p = Number(product.id);
  return {
    product,
    related: Catalog.relatedProducts(p, 8),
    also_bought: Catalog.frequentlyBoughtTogether(p, 4),
    in_cart_qty: cartQtyFor(ctx, p),
    wished: ctx.user ? Boolean(get(`SELECT 1 AS x FROM wishitems WHERE user_id = ? AND product_id = ?`,
      ctx.user.id, p)) : false,
  };
});

/** How many units of a product are already sitting in this visitor's cart. */
function cartQtyFor(ctx, productId) {
  const guestCartId = ctx.cookies[Cart.CART_COOKIE]
    ? get(`SELECT id FROM carts WHERE token = ? AND status = 'open'`, ctx.cookies[Cart.CART_COOKIE])?.id
    : null;
  if (guestCartId) {
    return get(`SELECT qty FROM cart_items WHERE cart_id = ? AND product_id = ?`, guestCartId, productId)?.qty || 0;
  }
  if (ctx.user) {
    return get(`SELECT ci.qty FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
                 WHERE c.user_id = ? AND c.status = 'open' AND ci.product_id = ? LIMIT 1`,
      ctx.user.id, productId)?.qty || 0;
  }
  return 0;
}

api.get("/api/categories", () => Catalog.categories());

api.get("/api/suggest", (ctx) => {
  const q = String(ctx.query.q || "").trim();
  if (q.length < 2) return { products: [], categories: [] };
  const like = `%${q.replace(/[%_]/g, "")}%`;
  return {
    products: all(`SELECT id, slug, name, name_am, price_cents,
                          (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort LIMIT 1) AS image_url
                     FROM products p WHERE status = 'active' AND (name LIKE ? OR name_am LIKE ? OR brand LIKE ?)
                    ORDER BY featured DESC, rating_avg DESC LIMIT 6`, like, like, like),
    categories: all(`SELECT slug, name, name_am FROM categories WHERE active = 1 AND (name LIKE ? OR name_am LIKE ?) LIMIT 4`,
      like, like),
  };
});

/* Cart --------------------------------------------------------------------- */

api.get("/api/cart", (ctx) => {
  const cart = cartOf(ctx);
  return { ...Cart.summary(cart.id), zone_estimate: null };
});

api.post("/api/cart/items", (ctx) => {
  const cart = cartOf(ctx);
  const id = Number(ctx.body?.product_id ?? ctx.body?.productId);
  if (!id) throw badRequest("product_id is required");
  Cart.addItem(cart.id, id, ctx.body?.qty ?? 1);
  logEvent("cart.add", { userId: ctx.user?.id || null, productId: id });
  return Cart.summary(cart.id);
});

api.patch("/api/cart/items/:id", (ctx) => {
  const cart = cartOf(ctx);
  return Cart.setQty(cart.id, Number(ctx.params.id), ctx.body?.qty);
});

api.delete("/api/cart/items/:id", (ctx) => {
  const cart = cartOf(ctx);
  return Cart.removeItem(cart.id, Number(ctx.params.id));
});

api.delete("/api/cart", (ctx) => {
  const cart = cartOf(ctx);
  return Cart.clearCart(cart.id);
});

api.post("/api/cart/coupon", (ctx) => {
  const cart = cartOf(ctx);
  const s = Cart.applyCoupon(cart.id, ctx.body?.code);
  logEvent("coupon.apply", { userId: ctx.user?.id || null, payload: { code: ctx.body?.code } });
  return s;
});

api.get("/api/coupon/check", (ctx) => {
  const subtotal = cents(ctx.query.subtotal);
  const result = Cart.evaluateCoupon(ctx.query.code, subtotal);
  return { ...result, next: Cart.shippingFor(ctx.query.zone, Math.max(0, subtotal - result.discount)) };
});

api.get("/api/shipping", (ctx) => Cart.shippingFor(ctx.query.zone, cents(ctx.query.subtotal)));

/* Checkout ----------------------------------------------------------------- */

api.post("/api/checkout", (ctx) => {
  const cart = cartOf(ctx);
  const b = ctx.body || {};
  requireFields(b, ["email", "phone"]);
  requireFields(b.ship || {}, ["name", "phone", "region", "city"]);
  if (!isEmail(b.email)) throw badRequest("Enter a valid email", { email: "Invalid email" });
  if (!Cart.pricedLines(cart.id).length) throw badRequest("Your cart is empty");

  const order = Orders.checkout({
    cartId: cart.id,
    userId: ctx.user?.id || null,
    email: b.email, phone: b.phone,
    ship: b.ship,
    zoneId: b.zone_id ? Number(b.zone_id) : null,
    paymentMethod: b.payment_method,
    instructions: b.instructions,
  });
  ctx.status = 201;
  ctx.cookie(Cart.CART_COOKIE, "", { maxAge: 0 });
  return { order, pay: order.payments[0] };
});

api.get("/api/orders/:id", (ctx) => {
  const id = Number(ctx.params.id);
  const asCustomer = !ctx.user || ctx.user.role !== "admin";
  try {
    return { order: Orders.getOrder(id, asCustomer ? ctx.user?.id : null) };
  } catch {
    // guests may look up their order with the email they used
    const email = String(ctx.query.email || "").trim().toLowerCase();
    const owns = get(`SELECT id FROM orders WHERE id = ? AND lower(email) = ?`, id, email);
    if (!owns) throw notFound("Order not found");
    return { order: Orders.getOrder(id) };
  }
});

api.get("/api/track/:number", (ctx) => {
  const o = get(`SELECT id FROM orders WHERE number = ? COLLATE NOCASE`, ctx.params.number);
  if (!o) throw notFound("No order with that number");
  return { order: Orders.getOrder(o.id) };
});

api.post("/api/orders/:id/cancel", (ctx) => {
  const id = Number(ctx.params.id);
  if (ctx.user?.role === "admin") return Orders.transition(id, "cancelled", { actorId: ctx.user.id, reason: ctx.body?.reason });
  const u = needUser(ctx);
  Orders.getOrder(id, u.id);
  return Orders.transition(id, "cancelled", { actorId: u.id, reason: ctx.body?.reason, asCustomer: true });
});

api.post("/api/payments/:reference/confirm", (ctx) => Orders.confirmPayment(ctx.params.reference,
  { actorId: ctx.user?.id || null }));

/* Auth --------------------------------------------------------------------- */

api.post("/api/auth/register", (ctx) => {
  requireFields(ctx.body, ["name", "email", "password"]);
  const user = Users.createUser({
    name: ctx.body.name, email: ctx.body.email, password: ctx.body.password,
    phone: ctx.body.phone, lang: ctx.body.lang,
  });
  const token = Users.startSession(user.id, ctx.req);
  ctx.cookie(config.cookieName, token, { httpOnly: true, maxAge: config.sessionTtlMs / 1000 });
  ctx.user = user;
  Users.claimGuestOrders(user.id, user.email);   // adopt any guest orders for this email
  const cart = cartOf(ctx);                       // pulls any guest basket into the new account
  ctx.status = 201;
  return { user, cart: Cart.summary(cart.id) };
});

api.post("/api/auth/login", (ctx) => {
  requireFields(ctx.body, ["email", "password"]);
  const found = Users.checkPassword(ctx.body.email, ctx.body.password);
  const user = { id: found.id, name: found.name, email: found.email, phone: found.phone,
                 role: found.role, lang: found.lang, active: found.active, created_at: found.created_at };
  const token = Users.startSession(user.id, ctx.req);
  ctx.cookie(config.cookieName, token, { httpOnly: true, maxAge: config.sessionTtlMs / 1000 });
  ctx.user = user;
  const cart = cartOf(ctx);
  return { user, cart: Cart.summary(cart.id) };
});

api.post("/api/auth/logout", (ctx) => {
  Users.endSession(ctx.cookies[config.cookieName]);
  ctx.cookie(config.cookieName, "", { httpOnly: true, maxAge: 0 });
  return { ok: true };
});

api.get("/api/me", (ctx) => {
  if (!ctx.user) return { user: null, cart: Cart.summary(cartOf(ctx).id) };
  return {
    user: ctx.user,
    cart: Cart.summary(cartOf(ctx).id),
    wishlist: Users.wishlist(ctx.user.id),
    addresses: Users.listAddresses(ctx.user.id),
    orders: Orders.listOrders({ userId: ctx.user.id, limit: 20 }),
  };
});

api.patch("/api/me", (ctx) => ({ user: Users.updateProfile(needUser(ctx).id, ctx.body || {}) }));

api.post("/api/me/password", (ctx) => {
  const u = needUser(ctx);
  requireFields(ctx.body, ["current", "next"]);
  Users.changePassword(u.id, ctx.body.current, ctx.body.next);
  const token = Users.startSession(u.id, ctx.req);
  ctx.cookie(config.cookieName, token, { httpOnly: true, maxAge: config.sessionTtlMs / 1000 });
  return { ok: true };
});

/* Addresses, wishlist, reviews -------------------------------------------- */

api.get("/api/addresses", (ctx) => ({ items: Users.listAddresses(needUser(ctx).id) }));
api.post("/api/addresses", (ctx) => {
  const a = Users.saveAddress(needUser(ctx).id, ctx.body || {});
  ctx.status = 201;
  return { address: a };
});
api.patch("/api/addresses/:id", (ctx) => ({ address: Users.saveAddress(needUser(ctx).id, ctx.body || {}, Number(ctx.params.id)) }));
api.delete("/api/addresses/:id", (ctx) => { Users.deleteAddress(needUser(ctx).id, Number(ctx.params.id)); return { ok: true }; });

api.get("/api/wishlist", (ctx) => ({ items: Users.wishlist(needUser(ctx).id) }));
api.post("/api/wishlist/:productId", (ctx) => Users.toggleWish(needUser(ctx).id, Number(ctx.params.productId)));

api.post("/api/products/:id/reviews", (ctx) => {
  const u = needUser(ctx);
  const product = Catalog.findProduct(ctx.params.id);
  if (!product) throw notFound("Product not found");
  const review = Users.addReview(u.id, product.id, ctx.body || {});
  ctx.status = 201;
  return { review, product: Catalog.findProduct(product.id) };
});

api.get("/api/my/reviews", (ctx) => ({
  items: all(`SELECT r.id, r.rating, r.title, r.body, r.status, r.created_at, p.id AS product_id, p.slug, p.name
                FROM reviews r JOIN products p ON p.id = r.product_id
               WHERE r.user_id = ? ORDER BY r.created_at DESC`, needUser(ctx).id),
}));

/* Admin -------------------------------------------------------------------- */

/** Wraps a handler so it only runs for administrators. */
const asAdmin = (fn) => (ctx) => { needAdmin(ctx); return fn(ctx); };

api.get("/api/admin/metrics", asAdmin(() => Admin.metrics()));

api.get("/api/admin/products", asAdmin((ctx) => Admin.listAdminProducts(ctx.query)));
api.get("/api/admin/products/:id", asAdmin((ctx) => Admin.adminProduct(Number(ctx.params.id))));
api.post("/api/admin/products", asAdmin((ctx) => { ctx.status = 201; return Admin.createProduct(ctx.body || {}); }));
api.patch("/api/admin/products/:id", asAdmin((ctx) => Admin.updateProduct(Number(ctx.params.id), ctx.body || {})));
api.delete("/api/admin/products/:id", asAdmin((ctx) => Admin.deleteProduct(Number(ctx.params.id))));
api.post("/api/admin/inventory", asAdmin((ctx) => Admin.adjustStock({ ...ctx.body, actorId: ctx.user.id })));

api.get("/api/admin/categories", asAdmin(() => ({ items: Admin.listAdminCategories() })));
api.post("/api/admin/categories", asAdmin((ctx) => { ctx.status = 201; return Admin.saveCategory(ctx.body || {}); }));
api.patch("/api/admin/categories/:id", asAdmin((ctx) => Admin.saveCategory(ctx.body || {}, Number(ctx.params.id))));
api.delete("/api/admin/categories/:id", asAdmin((ctx) => Admin.deleteCategory(Number(ctx.params.id))));

api.get("/api/admin/orders", asAdmin((ctx) => ({
  items: Orders.listOrders({ status: ctx.query.status, q: ctx.query.q, limit: ctx.query.limit }),
  counts: all(`SELECT status, COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS cents FROM orders GROUP BY status`),
})));
api.patch("/api/admin/orders/:id", asAdmin((ctx) => Orders.transition(Number(ctx.params.id), ctx.body?.status,
  { actorId: ctx.user.id, reason: ctx.body?.reason })));

api.get("/api/admin/customers", asAdmin((ctx) => ({ items: Admin.listCustomers(ctx.query) })));
api.get("/api/admin/customers/:id", asAdmin((ctx) => ({ customer: Admin.customerDetail(Number(ctx.params.id)) })));
api.patch("/api/admin/customers/:id", asAdmin((ctx) =>
  Admin.setActiveCustomer(Number(ctx.params.id), Boolean(ctx.body?.active))));

api.get("/api/admin/coupons", asAdmin(() => ({ items: Admin.listCoupons() })));
api.post("/api/admin/coupons", asAdmin((ctx) => { ctx.status = 201; return Admin.saveCoupon(ctx.body || {}); }));
api.patch("/api/admin/coupons/:code", asAdmin((ctx) => Admin.saveCoupon(ctx.body || {}, ctx.params.code)));
api.delete("/api/admin/coupons/:code", asAdmin((ctx) => Admin.deleteCoupon(ctx.params.code)));

api.get("/api/admin/reviews", asAdmin((ctx) => ({ items: Admin.listReviews(ctx.query.status) })));
api.patch("/api/admin/reviews/:id", asAdmin((ctx) => Admin.moderateReview(Number(ctx.params.id), ctx.body?.status)));

api.get("/api/admin/movements", asAdmin((ctx) => ({
  items: all(`SELECT m.*, p.name AS product_name, p.sku FROM inventory_movements m
                JOIN products p ON p.id = m.product_id
               ${ctx.query.product ? "WHERE m.product_id = ?" : ""}
               ORDER BY m.id DESC LIMIT 200`, ...(ctx.query.product ? [Number(ctx.query.product)] : [])),
})));

api.get("/api/admin/events", asAdmin(() => ({
  items: all(`SELECT e.id, e.type, e.created_at, p.name AS product_name, u.email AS user_email
                FROM events e LEFT JOIN products p ON p.id = e.product_id LEFT JOIN users u ON u.id = e.user_id
               ORDER BY e.id DESC LIMIT 120`),
})));
