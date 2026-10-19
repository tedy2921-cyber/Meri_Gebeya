import { all, get, run, nowIso } from "./config.js";
import { randomToken } from "./security.js";
import { badRequest, conflict, notFound } from "./http.js";

/* ------------------------------------------------------------------ *
 * A cart belongs either to a signed-in user or to a guest cookie token.
 * Every line snapshots the price it was added at; we reprice on read so
 * the checkout total can never differ from what the shopper last saw.
 * ------------------------------------------------------------------ */

export const CART_COOKIE = "mg_cart";

const CART_SELECT = `SELECT id, token, user_id, status, coupon_code, created_at, updated_at
                       FROM carts WHERE id = ?`;

export function newCart({ userId = null, token = null } = {}) {
  const t = token || randomToken(18);
  const now = nowIso();
  const r = run(`INSERT INTO carts (token, user_id, status, created_at, updated_at)
                 VALUES (?, ?, 'open', ?, ?)`, t, userId, now, now);
  return get(CART_SELECT, r.lastInsertRowid);
}

export const cartByToken = (token) =>
  token ? get(`SELECT id, token, user_id, status, coupon_code FROM carts WHERE token = ?`, token) : null;

/**
 * The cart for this request, created if it does not exist.
 * Adds `issuedToken` when the client needs a brand new guest cookie,
 * and `justMerged` when a guest cart was folded into the user's cart.
 */
export function resolveCart(ctx) {
  if (ctx.user) {
    let cart = get(`SELECT id, token, user_id, status, coupon_code FROM carts
                     WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, ctx.user.id);
    const guest = cartByToken(ctx.cookies[CART_COOKIE]);
    if (!cart) cart = newCart({ userId: ctx.user.id });
    if (guest && guest.id !== cart.id && !guest.user_id) {
      mergeGuestInto(cart, guest);
      cart = get(CART_SELECT, cart.id);
      return { ...cart, justMerged: true };
    }
    return cart;
  }

  const existing = cartByToken(ctx.cookies[CART_COOKIE]);
  if (existing && existing.status === "open" && !existing.user_id) return existing;
  const fresh = newCart();
  return { ...fresh, issuedToken: fresh.token };
}

/** Fold a guest cart into the user's cart, adding quantities where a product repeats. */
export function mergeGuestInto(target, guest) {
  if (!guest || guest.id === target.id) return;
  for (const line of all(`SELECT product_id, qty FROM cart_items WHERE cart_id = ?`, guest.id)) {
    const stock = get(`SELECT stock, status FROM products WHERE id = ?`, line.product_id);
    if (!stock || stock.status !== "active") continue;
    const here = get(`SELECT qty FROM cart_items WHERE cart_id = ? AND product_id = ?`,
                     target.id, line.product_id)?.qty || 0;
    const qty = Math.min(here + line.qty, stock.stock);
    if (qty <= 0) continue;
    setLine(target.id, line.product_id, qty);
  }
  if (target.coupon_code === null) {
    const guestCoupon = get(`SELECT coupon_code FROM carts WHERE id = ?`, guest.id)?.coupon_code;
    if (guestCoupon) run(`UPDATE carts SET coupon_code = ? WHERE id = ?`, guestCoupon, target.id);
  }
  run(`DELETE FROM cart_items WHERE cart_id = ?`, guest.id);
  run(`UPDATE carts SET status = 'converted', updated_at = ? WHERE id = ?`, nowIso(), guest.id);
  touch(target.id);
}

const touch = (cartId) => run(`UPDATE carts SET updated_at = ? WHERE id = ?`, nowIso(), cartId);

function setLine(cartId, productId, qty) {
  const price = get(`SELECT price_cents FROM products WHERE id = ?`, productId)?.price_cents ?? 0;
  run(`INSERT INTO cart_items (cart_id, product_id, qty, unit_price_cents, added_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cart_id, product_id) DO UPDATE SET qty = excluded.qty,
                                                      unit_price_cents = excluded.unit_price_cents,
                                                      added_at = excluded.added_at`,
      cartId, productId, qty, price, nowIso());
}

/** Add n units of a product (stock-capped). */
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

/** Set an exact quantity; 0 removes the line. */
export function setQty(cartId, productId, qty) {
  const n = Math.floor(Number(qty));
  if (Number.isNaN(n) || n < 0) throw badRequest("Quantity must be a whole number");
  if (n === 0) return removeItem(cartId, productId);
  const product = get(`SELECT stock, status, name FROM products WHERE id = ?`, productId);
  if (!product) throw notFound("Product not found");
  if (product.status !== "active") throw conflict("This item is no longer on sale");
  if (n > product.stock) throw conflict(`Only ${product.stock} left in stock`, { qty: `Maximum ${product.stock}` });
  setLine(cartId, productId, n);
  touch(cartId);
  return summary(cartId);
}

export function removeItem(cartId, productId) {
  run(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`, cartId, productId);
  touch(cartId);
  return summary(cartId);
}

export function clearCart(cartId) {
  run(`DELETE FROM cart_items WHERE cart_id = ?`, cartId);
  run(`UPDATE carts SET coupon_code = NULL, updated_at = ? WHERE id = ?`, nowIso(), cartId);
  return summary(cartId);
}

/* Coupon ------------------------------------------------------------------ */

export function evaluateCoupon(code, subtotalCents) {
  if (!code) return { code: null, discount: 0, reason: null };
  const c = get(`SELECT * FROM coupons WHERE code = ? COLLATE NOCASE`, String(code).trim());
  const now = Date.now();
  if (!c) return { code: String(code), discount: 0, reason: "Coupon not recognised" };
  if (!c.active) return { code: c.code, discount: 0, reason: "Coupon is no longer active" };
  if (c.starts_at && Date.parse(c.starts_at) > now) return { code: c.code, discount: 0, reason: "Coupon starts later" };
  if (c.expires_at && Date.parse(c.expires_at) < now) return { code: c.code, discount: 0, reason: "Coupon has expired" };
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) {
    return { code: c.code, discount: 0, reason: "Coupon has been fully redeemed" };
  }
  if (subtotalCents < c.min_subtotal_cents) {
    return { code: c.code, discount: 0,
             reason: `Add ${(Math.max(0, c.min_subtotal_cents - subtotalCents) / 100).toFixed(2)} ETB more to use this coupon` };
  }
  let discount = c.kind === "percent" ? Math.round(subtotalCents * c.value / 100) : Math.min(c.value, subtotalCents);
  if (c.max_discount_cents !== null) discount = Math.min(discount, c.max_discount_cents);
  return { code: c.code, discount: Math.min(discount, subtotalCents), reason: null };
}

export function applyCoupon(cartId, code) {
  if (!code) {
    run(`UPDATE carts SET coupon_code = NULL, updated_at = ? WHERE id = ?`, nowIso(), cartId);
    return summary(cartId);
  }
  const s = summary(cartId);
  const result = evaluateCoupon(code, s.subtotal_cents);
  if (result.reason) throw badRequest(result.reason, { coupon: result.reason });
  run(`UPDATE carts SET coupon_code = ?, updated_at = ? WHERE id = ?`, result.code, nowIso(), cartId);
  return summary(cartId);
}

/* Delivery ---------------------------------------------------------------- */

export const zoneById = (id) =>
  get(`SELECT id, name, name_am, fee_cents, free_over_cents, eta_hours
        FROM delivery_zones WHERE id = ? AND active = 1`, id);

export function shippingFor(zoneId, subtotalAfterDiscount) {
  if (!zoneId) return { zone: null, fee_cents: 0, eta_hours: null, free: false };
  const z = zoneById(zoneId);
  if (!z) throw notFound("That delivery zone is not available");
  const free = z.free_over_cents !== null && subtotalAfterDiscount >= z.free_over_cents;
  return { zone: z, fee_cents: free ? 0 : z.fee_cents, eta_hours: z.eta_hours, free };
}

export const activeZones = () =>
  all(`SELECT id, name, name_am, fee_cents, free_over_cents, eta_hours
         FROM delivery_zones WHERE active = 1 ORDER BY fee_cents, name`);

/* Summary ----------------------------------------------------------------- */

const LINE_SELECT = `
  SELECT ci.id, ci.product_id, ci.qty, ci.unit_price_cents AS snapshot_cents,
         p.name, p.name_am, p.slug, p.sku, p.unit, p.stock, p.status, p.low_stock_at,
         p.price_cents AS current_cents,
         (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_url
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
   WHERE ci.cart_id = ?
   ORDER BY ci.added_at, ci.id`;

/** Price the cart, capping every line at live stock. */
export function summary(cartId) {
  const cart = get(`SELECT id, user_id, status, coupon_code FROM carts WHERE id = ?`, cartId);
  if (!cart) throw notFound("Cart not found");

  const issues = [];
  for (const line of all(LINE_SELECT, cartId)) {
    if (line.status !== "active") { issues.push(`${line.name} is no longer on sale — remove it to check out`); continue; }
    if (line.current_cents !== line.snapshot_cents) {
      run(`UPDATE cart_items SET unit_price_cents = ? WHERE id = ?`, line.current_cents, line.id);
    }
    if (line.qty > line.stock) {
      if (line.stock === 0) issues.push(`${line.name} just sold out — remove it to check out`);
      else {
        run(`UPDATE cart_items SET qty = ? WHERE id = ?`, line.stock, line.id);
        issues.push(`Quantity for ${line.name} was reduced to ${line.stock}`);
      }
    }
  }

  const items = all(LINE_SELECT, cartId)
    .filter((l) => l.status === "active" && l.stock > 0)
    .map((l) => ({
      product_id: l.product_id,
      slug: l.slug,
      name: l.name,
      name_am: l.name_am,
      sku: l.sku,
      unit: l.unit,
      image_url: l.image_url,
      qty: l.qty,
      stock: l.stock,
      unit_price_cents: l.current_cents,
      line_total_cents: l.current_cents * l.qty,
      price_changed: l.current_cents !== l.snapshot_cents,
      low_stock: l.stock <= l.low_stock_at,
    }));

  const subtotal = items.reduce((n, l) => n + l.line_total_cents, 0);
  const coupon = evaluateCoupon(cart.coupon_code, subtotal);
  const discount = coupon.discount;

  return {
    cart_id: cartId,
    items,
    item_count: items.reduce((n, l) => n + l.qty, 0),
    subtotal_cents: subtotal,
    discount_cents: discount,
    coupon_code: discount ? coupon.code : null,
    coupon_reason: cart.coupon_code && !discount ? coupon.reason : null,
    total_cents: Math.max(0, subtotal - discount),
    issues,
    can_checkout: items.length > 0 && issues.length === 0,
  };
}

/** The exact rows a checkout will snapshot onto the order. */
export function pricedLines(cartId) {
  return all(LINE_SELECT, cartId).map((l) => ({
    product_id: l.product_id,
    name: l.name,
    name_am: l.name_am,
    slug: l.slug,
    sku: l.sku,
    image_url: l.image_url,
    unit_price_cents: l.current_cents,
    qty: l.qty,
    stock: l.stock,
    status: l.status,
    line_total_cents: l.current_cents * l.qty,
  }));
}
