import { randomBytes } from "node:crypto";
import { all, get, run, tx, nowIso, logEvent } from "./config.js";
import { badRequest, conflict, notFound } from "./http.js";
import { pricedLines, evaluateCoupon, shippingFor } from "./cart.js";

/* ------------------------------------------------------------------ *
 * Checkout is one transaction: re-validate stock, decrement it, write
 * the order + snapshot lines + payment record + inventory ledger rows.
 * ------------------------------------------------------------------ */

export const PAYMENT_METHODS = ["cod", "telebirr", "cbe_birr", "bank", "card"];

const STATUS_FLOW = {
  pending:   ["confirmed", "cancelled"],
  confirmed: ["packing", "cancelled"],
  packing:   ["shipped", "cancelled"],
  shipped:   ["delivered", "cancelled"],
  delivered: ["refunded"],
  cancelled: ["refunded"],
  refunded:  [],
};

const ORDER_SELECT = `
  SELECT o.*, z.name AS zone_name, z.name_am AS zone_name_am, z.eta_hours
    FROM orders o
    LEFT JOIN delivery_zones z ON z.id = o.zone_id
   WHERE o.id = ?`;

const money = (cents) => Math.max(0, Math.round(Number(cents) || 0));

function nextNumber() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `MG-${day}-${suffix}`;
}

/**
 * input: { cartId, userId, email, phone, ship:{name,phone,region,city,subcity,woreda,landmark},
 *          zoneId, paymentMethod, instructions }
 * Returns the created order (with items).
 */
export function checkout(input) {
  const lines = pricedLines(input.cartId);
  if (!lines.length) throw badRequest("Your cart is empty");

  for (const l of lines) {
    if (l.status !== "active") throw conflict(`${l.name} is no longer on sale`);
    if (l.qty > l.stock) throw conflict(`Not enough stock for ${l.name} — only ${l.stock} left`);
  }

  const method = String(input.paymentMethod || "");
  if (!PAYMENT_METHODS.includes(method)) throw badRequest("Choose a valid payment method");

  const subtotal = lines.reduce((n, l) => n + l.line_total_cents, 0);
  const cart = get(`SELECT coupon_code FROM carts WHERE id = ?`, input.cartId);
  const coupon = evaluateCoupon(cart?.coupon_code, subtotal);
  if (cart?.coupon_code && !coupon.discount && coupon.reason) throw badRequest(coupon.reason, { coupon: coupon.reason });
  const ship = shippingFor(input.zoneId, Math.max(0, subtotal - coupon.discount));

  const discount = coupon.discount;
  const delivery = ship.fee_cents;
  const total = Math.max(0, subtotal - discount) + delivery;

  const now = nowIso();
  const s = input.ship || {};

  return tx(() => {
    // re-check inside the transaction — another request may have taken the stock
    for (const l of lines) {
      const live = get(`SELECT stock, status FROM products WHERE id = ?`, l.product_id);
      if (!live || live.status !== "active") throw conflict(`${l.name} is no longer on sale`);
      if (live.stock < l.qty) throw conflict(`Not enough stock for ${l.name} — only ${live.stock} left`);
    }

    const o = run(`INSERT INTO orders (number, user_id, cart_id, email, phone, status, payment_method,
                                       payment_status, subtotal_cents, discount_cents, delivery_cents,
                                       total_cents, currency, coupon_code, zone_id, ship_name, ship_phone,
                                       ship_region, ship_city, ship_subcity, ship_woreda, ship_landmark,
                                       instructions, placed_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'ETB', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nextNumber(), input.userId || null, input.cartId,
      String(input.email).trim().toLowerCase(), String(input.phone).trim(),
      method, method === "cod" ? "unpaid" : "authorized",
      money(subtotal), money(discount), money(delivery), money(total),
      coupon.code || null, input.zoneId || null,
      s.name, s.phone, s.region, s.city, s.subcity || null, s.woreda || null, s.landmark || null,
      input.instructions ? String(input.instructions).slice(0, 500) : null, now, now);

    const orderId = Number(o.lastInsertRowid);

    for (const l of lines) {
      run(`INSERT INTO order_items (order_id, product_id, name_snapshot, name_am_snapshot, sku_snapshot,
                                    image_url, unit_price_cents, qty, line_total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId, l.product_id, l.name, l.name_am, l.sku, l.image_url,
        l.unit_price_cents, l.qty, l.line_total_cents);

      const before = get(`SELECT stock FROM products WHERE id = ?`, l.product_id).stock;
      run(`UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?`, l.qty, now, l.product_id);
      run(`INSERT INTO inventory_movements (product_id, delta, reason, order_id, actor_user_id, note, created_at)
           VALUES (?, ?, 'sale', ?, ?, ?, ?)`,
        l.product_id, -l.qty, orderId, input.userId || null,
        `order ${orderId} · stock ${before} → ${before - l.qty}`, now);
    }

    const reference = `PAY-${method.toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`;
    run(`INSERT INTO payments (order_id, provider, reference, amount_cents, status, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      orderId, method, reference, money(total),
      method === "cod" ? "created" : "authorized",
      JSON.stringify({ captured: false, simulated: true, placed_at: now }), now);

    if (coupon.code) {
      run(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ?`, coupon.code);
    }
    run(`UPDATE carts SET status = 'converted', coupon_code = NULL, updated_at = ? WHERE id = ?`, now, input.cartId);
    logEvent("order.placed", { userId: input.userId || null, payload: { orderId, total, method } });

    return getOrder(orderId);
  });
}

export function getOrder(id, userId = null) {
  const order = get(ORDER_SELECT, id);
  if (!order) throw notFound("Order not found");
  if (userId && order.user_id && order.user_id !== userId) throw notFound("Order not found");
  order.items = all(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id`, id);
  order.payments = all(`SELECT provider, reference, amount_cents, status, created_at, confirmed_at
                           FROM payments WHERE order_id = ? ORDER BY id`, id);
  order.timeline = buildTimeline(order);
  return order;
}

const FLOW_LABELS = [["pending", "Placed"], ["confirmed", "Confirmed"], ["packing", "Packed"],
                     ["shipped", "On the way"], ["delivered", "Delivered"]];

function buildTimeline(order) {
  const reached = order.status === "refunded" ? 5
    : order.status === "cancelled" ? -1
    : FLOW_LABELS.findIndex(([s]) => s === order.status);
  const steps = FLOW_LABELS.map(([status, label], i) => ({
    status,
    label,
    done: reached >= i,
    at: i === 0 ? order.placed_at : (reached >= i ? order.updated_at : null),
  }));
  if (order.status === "cancelled") {
    steps.push({ status: "cancelled", done: true, at: order.updated_at,
                 label: "Cancelled" + (order.cancelled_reason ? ` — ${order.cancelled_reason}` : "") });
  }
  if (order.status === "refunded") {
    steps.push({ status: "refunded", done: true, at: order.updated_at, label: "Refunded" });
  }
  return steps;
}

export function listOrders({ userId = null, status = null, q = null, limit = 100 } = {}) {
  const where = [], params = [];
  if (userId) { where.push("o.user_id = ?"); params.push(userId); }
  if (status && status !== "all") { where.push("o.status = ?"); params.push(status); }
  if (q) {
    where.push(`(o.number LIKE ? OR o.email LIKE ? OR o.ship_name LIKE ? OR o.phone LIKE ?)`);
    const like = `%${String(q).replace(/[%_]/g, "")}%`;
    params.push(like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return all(`SELECT o.*, z.name AS zone_name,
                     (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS line_count
                FROM orders o LEFT JOIN delivery_zones z ON z.id = o.zone_id
               ${clause} ORDER BY o.placed_at DESC LIMIT ?`, ...params, Math.min(Number(limit) || 100, 500));
}

/** Status machine used by both the admin console and the customer cancel button. */
export function transition(orderId, to, { actorId = null, reason = null, asCustomer = false } = {}) {
  const order = get(ORDER_SELECT, orderId);
  if (!order) throw notFound("Order not found");

  if (asCustomer && order.status !== "pending") {
    throw conflict("This order can no longer be cancelled");
  }
  if (asCustomer && to !== "cancelled") throw badRequest("You can only cancel an order");

  const allowed = STATUS_FLOW[order.status] || [];
  if (!allowed.includes(to)) {
    throw conflict(`Cannot move an order from ${order.status} to ${to}`,
                   { status: `Allowed next: ${allowed.join(", ") || "none"}` });
  }

  const now = nowIso();
  return tx(() => {
    if (to === "cancelled" || to === "refunded") {
      // put the goods back on the shelf
      for (const item of all(`SELECT product_id, qty FROM order_items WHERE order_id = ?`, orderId)) {
        if (!item.product_id) continue;
        run(`UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?`, item.qty, now, item.product_id);
        run(`INSERT INTO inventory_movements (product_id, delta, reason, order_id, actor_user_id, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            item.product_id, item.qty, to === "cancelled" ? "cancel" : "return",
            orderId, actorId, `stock returned for order ${orderId}`, now);
      }
      run(`UPDATE payments SET status = ?, confirmed_at = ? WHERE order_id = ? AND status IN ('created','authorized','captured')`,
          to === "cancelled" ? "failed" : "refunded", now, orderId);
      if (order.coupon_code) run(`UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?`, order.coupon_code);
    }

    if (to === "delivered") {
      run(`UPDATE payments SET status = 'captured', confirmed_at = COALESCE(confirmed_at, ?) WHERE order_id = ?`, now, orderId);
    }
    if (to === "confirmed") {
      run(`UPDATE payments SET status = CASE WHEN provider = 'cod' THEN status ELSE 'captured' END,
                                  confirmed_at = COALESCE(confirmed_at, ?)
                            WHERE order_id = ? AND status = 'authorized'`, now, orderId);
    }

    run(`UPDATE orders SET status = ?, updated_at = ?, delivered_at = ?, cancelled_reason = ?
          WHERE id = ?`,
        to, now,
        to === "delivered" ? (order.delivered_at || now) : order.delivered_at,
        to === "cancelled" ? (reason ? String(reason).slice(0, 300) : null) : order.cancelled_reason,
        orderId);

    const payment_status = to === "refunded" ? "refunded"
      : to === "cancelled" ? (order.payment_method === "cod" ? "unpaid" : "failed")
      : order.payment_status;
    if (payment_status !== order.payment_status) {
      run(`UPDATE orders SET payment_status = ? WHERE id = ?`, payment_status, orderId);
    }

    logEvent("order.status", { userId: actorId, payload: { orderId, from: order.status, to } });
    return getOrder(orderId);
  });
}

/* Mock payment provider ---------------------------------------------------- */

export const providers = () => [
  { id: "cod",       label: "Cash on delivery", label_am: "ገንዘብ በማድረሻ", icon: "🚚", needs_ref: false },
  { id: "telebirr",  label: "Telebirr",         label_am: "ቴሌብር",        icon: "📱", needs_ref: true  },
  { id: "cbe_birr",  label: "CBE Birr",         label_am: "ሲቢኢ ብር",      icon: "🏦", needs_ref: true  },
  { id: "bank",      label: "Bank transfer",    label_am: "የባንክ ዝውውር",   icon: "💳", needs_ref: true  },
  { id: "card",      label: "Card",             label_am: "ካርድ",         icon: "🪙", needs_ref: true  },
];

/** Simulates a gateway redirect + confirmation. Swap this file for a real SDK later. */
export function confirmPayment(reference, { actorId = null } = {}) {
  const pay = get(`SELECT * FROM payments WHERE reference = ?`, reference);
  if (!pay) throw notFound("Payment reference not found");
  const order = get(`SELECT * FROM orders WHERE id = ?`, pay.order_id);
  if (!order) throw notFound("Order not found");
  if (pay.status === "captured") return getOrder(order.id);
  if (pay.provider === "cod") throw conflict("Cash on delivery is paid when the parcel arrives");
  if (order.status === "cancelled") throw conflict("This order was cancelled");

  const now = nowIso();
  return tx(() => {
    run(`UPDATE payments SET status = 'captured', confirmed_at = ?, meta = ? WHERE id = ?`,
        now, JSON.stringify({ simulated: true, confirmed_at: now, actor: actorId }), pay.id);
    /* A captured mobile-money payment confirms the order too — no double work
       for staff, and the shopper sees "Confirmed" right away. */
    run(`UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ?`, now, order.id);
    if (order.status === "pending") {
      run(`UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?`, now, order.id);
      run(`UPDATE payments SET status = 'authorized' WHERE order_id = ? AND status = 'created'`, order.id);
    }
    logEvent("payment.captured", { userId: actorId, payload: { orderId: order.id, reference } });
    return getOrder(order.id);
  });
}
