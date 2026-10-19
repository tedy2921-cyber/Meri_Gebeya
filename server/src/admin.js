import { all, get, run, tx, nowIso } from "./config.js";
import { badRequest, conflict, notFound, slugify } from "./http.js";
import { recomputeRating } from "./users.js";

/* Products ---------------------------------------------------------------- */

const PRODUCT_COLS = `id, slug, name, name_am, description, description_am, brand, sku, unit,
                      price_cents, compare_at_price_cents, currency, stock, low_stock_at,
                      weight_grams, status, featured, rating_avg, rating_count, view_count,
                      category_id, created_at, updated_at`;

/** Accepts either dollars-style numbers or explicit cents; always stores cents. */
function toCents(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) throw badRequest("Price must be a number", { price: "Invalid" });
  return Math.round(n * 100);
}

export function adminProduct(id) {
  const p = get(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`, id);
  if (!p) throw notFound("Product not found");
  p.images = all(`SELECT id, url, alt, sort FROM product_images WHERE product_id = ? ORDER BY sort, id`, id);
  p.movements = all(`SELECT * FROM inventory_movements WHERE product_id = ? ORDER BY id DESC LIMIT 20`, id);
  return p;
}

export function listAdminProducts(query = {}) {
  const where = [], params = [];
  if (query.status && query.status !== "all") { where.push("status = ?"); params.push(query.status); }
  if (query.q) {
    const like = `%${String(query.q).replace(/[%_]/g, "")}%`;
    where.push(`(name LIKE ? OR name_am LIKE ? OR sku LIKE ? OR brand LIKE ?)`);
    params.push(like, like, like, like);
  }
  if (query.low === "1") where.push("stock <= low_stock_at");
  if (query.category) { where.push("category_id = (SELECT id FROM categories WHERE slug = ? OR id = ?)"); params.push(query.category, Number(query.category) || 0); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const per = Math.min(Math.max(Number(query.per) || 25, 1), 100);
  const page = Math.max(Number(query.page) || 1, 1);
  const total = get(`SELECT COUNT(*) AS n FROM products ${clause}`, ...params)?.n || 0;
  return {
    items: all(`SELECT ${PRODUCT_COLS},
                       (SELECT COUNT(*) FROM reviews r WHERE r.product_id = products.id) AS review_count,
                       (SELECT name FROM categories c WHERE c.id = products.category_id) AS category_name
                  FROM products ${clause}
                 ORDER BY products.updated_at DESC LIMIT ? OFFSET ?`, ...params, per, (page - 1) * per),
    total, page, per, pages: Math.max(1, Math.ceil(total / per)),
  };
}

function validateProduct(body, { partial }) {
  const fields = {};

  if (!partial || body.name !== undefined) {
    if (!String(body.name || "").trim()) throw badRequest("Name is required", { name: "Required" });
  }
  if (body.price_cents !== undefined) fields.price_cents = Number(body.price_cents);
  else if (body.price !== undefined) fields.price_cents = toCents(body.price);
  else if (!partial) throw badRequest("Price is required", { price: "Required" });

  if (body.compare_at_price !== undefined || body.compare_at_price_cents !== undefined) {
    const raw = body.compare_at_price_cents !== undefined ? body.compare_at_price_cents : body.compare_at_price;
    fields.compare_at_price_cents = raw === null || raw === "" ? null
      : (body.compare_at_price_cents !== undefined ? Number(raw) : toCents(raw));
  }
  if (!partial || body.sku !== undefined) {
    if (!String(body.sku || "").trim()) throw badRequest("SKU is required", { sku: "Required" });
  }
  if (!partial || body.slug !== undefined) {
    if (!String(body.slug || body.name || "").trim()) throw badRequest("Slug is required", { slug: "Required" });
  }

  const str = ["name", "name_am", "description", "description_am", "brand", "sku", "slug", "unit"];
  for (const k of str) if (body[k] !== undefined) fields[k] = body[k] === null ? null : String(body[k]);
  const num = ["stock", "low_stock_at", "weight_grams", "category_id"];
  for (const k of num) if (body[k] !== undefined) fields[k] = body[k] === null || body[k] === "" ? null : Number(body[k]);
  if (body.status !== undefined) {
    if (!["draft", "active", "archived"].includes(body.status)) throw badRequest("Unknown product status");
    fields.status = body.status;
  }
  if (body.featured !== undefined) fields.featured = body.featured ? 1 : 0;
  return fields;
}

export function createProduct(body) {
  const f = validateProduct(body, { partial: false });
  const now = nowIso();
  const slug = slugify(f.slug || f.name) || `p-${Date.now()}`;
  if (get(`SELECT id FROM products WHERE slug = ? OR sku = ?`, slug, f.sku)) {
    throw conflict("That slug or SKU is already used", { slug: "Already used", sku: "Already used" });
  }
  return tx(() => {
    const r = run(`INSERT INTO products (slug, name, name_am, description, description_am, brand, sku, unit,
                        price_cents, compare_at_price_cents, currency, stock, low_stock_at, weight_grams,
                        status, featured, category_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ETB', ?, ?, ?, ?, ?, ?, ?, ?)`,
      slug, f.name, f.name_am || null, f.description || "", f.description_am || null, f.brand || null,
      f.sku, f.unit || "piece", f.price_cents, f.compare_at_price_cents ?? null,
      f.stock ?? 0, f.low_stock_at ?? 5, f.weight_grams ?? null,
      f.status || "active", f.featured ?? 0, f.category_id ?? null, now, now);
    const id = Number(r.lastInsertRowid);
    if ((f.stock ?? 0) > 0) {
      run(`INSERT INTO inventory_movements (product_id, delta, reason, note, created_at)
           VALUES (?, ?, 'import', 'initial stock', ?)`, id, f.stock, now);
    }
    addImages(id, body.images || (body.image_url ? [body.image_url] : []));
    return adminProduct(id);
  });
}

export function updateProduct(id, body) {
  if (!get(`SELECT id FROM products WHERE id = ?`, id)) throw notFound("Product not found");
  const f = validateProduct(body, { partial: true });
  const now = nowIso();
  const before = get(`SELECT stock FROM products WHERE id = ?`, id).stock;

  return tx(() => {
    if (Object.keys(f).length) {
      const keys = Object.keys(f);
      run(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
          ...keys.map((k) => f[k]), now, id);
    }
    if (f.stock !== undefined && f.stock !== before) {
      run(`INSERT INTO inventory_movements (product_id, delta, reason, note, created_at)
           VALUES (?, ?, 'adjust', ?, ?)`, id, f.stock - before, `set by admin: ${before} → ${f.stock}`, now);
    }
    if (body.images) {
      run(`DELETE FROM product_images WHERE product_id = ?`, id);
      addImages(id, body.images);
    }
    return adminProduct(id);
  });
}

function addImages(id, images) {
  const list = Array.isArray(images) ? images : [];
  list.slice(0, 8).forEach((img, i) => {
    const url = typeof img === "string" ? img : img?.url;
    if (!url) return;
    run(`INSERT INTO product_images (product_id, url, alt, sort) VALUES (?, ?, ?, ?)`,
        id, String(url), typeof img === "object" && img.alt ? String(img.alt) : null, i);
  });
}

export function deleteProduct(id) {
  const p = get(`SELECT id, status FROM products WHERE id = ?`, id);
  if (!p) throw notFound("Product not found");
  const sold = get(`SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?`, id)?.n || 0;
  if (sold) {
    // never break order history — archive instead of deleting
    run(`UPDATE products SET status = 'archived', updated_at = ? WHERE id = ?`, nowIso(), id);
    return { archived: true, reason: "Product has order history, so it was archived instead of deleted" };
  }
  run(`DELETE FROM products WHERE id = ?`, id);
  return { deleted: true };
}

/** Stock adjustment with a ledger entry. */
export function adjustStock({ product_id, productId, delta, reason = "adjust", note = null, actorId = null }) {
  const id = Number(product_id ?? productId);
  const n = Math.floor(Number(delta));
  if (!id) throw badRequest("product_id is required");
  if (!n) throw badRequest("Adjustment must be a non-zero number", { delta: "Required" });
  if (!["restock", "return", "adjust"].includes(reason)) throw badRequest("Unknown movement reason");
  const p = get(`SELECT stock FROM products WHERE id = ?`, id);
  if (!p) throw notFound("Product not found");
  if (p.stock + n < 0) throw conflict(`Only ${p.stock} in stock, cannot reduce by ${Math.abs(n)}`);
  const now = nowIso();
  return tx(() => {
    run(`UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?`, n, now, id);
    run(`INSERT INTO inventory_movements (product_id, delta, reason, actor_user_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`, id, n, reason, actorId, note, now);
    return get(`SELECT id, sku, name, stock FROM products WHERE id = ?`, id);
  });
}

/* Categories -------------------------------------------------------------- */

export function listAdminCategories() {
  return all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
                FROM categories c ORDER BY c.sort, c.name`);
}

export function saveCategory(body, id = null) {
  const name = String(body?.name || "").trim();
  if (!name) throw badRequest("Category name is required", { name: "Required" });
  const slug = slugify(body.slug || name);
  if (!slug) throw badRequest("Category slug could be built", { slug: "Required" });
  const fields = {
    name, slug, name_am: body.name_am ? String(body.name_am) : null,
    blurb: body.blurb ? String(body.blurb) : null, icon: body.icon ? String(body.icon) : null,
    parent_id: body.parent_id ? Number(body.parent_id) : null,
    sort: body.sort !== undefined ? Number(body.sort) : 0,
    active: body.active === undefined ? 1 : (body.active ? 1 : 0),
  };
  if (id) {
    if (!get(`SELECT id FROM categories WHERE id = ?`, id)) throw notFound("Category not found");
    if (get(`SELECT id FROM categories WHERE slug = ? AND id <> ?`, slug, id)) {
      throw conflict("That slug is taken", { slug: "Already used" });
    }
    run(`UPDATE categories SET name=?, slug=?, name_am=?, blurb=?, icon=?, parent_id=?, sort=?, active=? WHERE id = ?`,
        fields.name, fields.slug, fields.name_am, fields.blurb, fields.icon, fields.parent_id, fields.sort, fields.active, id);
    return get(`SELECT * FROM categories WHERE id = ?`, id);
  }
  if (get(`SELECT id FROM categories WHERE slug = ?`, slug)) throw conflict("That slug is taken", { slug: "Already used" });
  const r = run(`INSERT INTO categories (name, slug, name_am, blurb, icon, parent_id, sort, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    fields.name, fields.slug, fields.name_am, fields.blurb, fields.icon, fields.parent_id, fields.sort, fields.active);
  return get(`SELECT * FROM categories WHERE id = ?`, Number(r.lastInsertRowid));
}

export function deleteCategory(id) {
  if (!get(`SELECT id FROM categories WHERE id = ?`, id)) throw notFound("Category not found");
  run(`UPDATE products SET category_id = NULL WHERE category_id = ?`, id);
  run(`UPDATE categories SET parent_id = NULL WHERE parent_id = ?`, id);
  run(`DELETE FROM categories WHERE id = ?`, id);
  return { deleted: true };
}

/* Coupons ----------------------------------------------------------------- */

export const listCoupons = () => all(`SELECT * FROM coupons ORDER BY active DESC, code`);

export function saveCoupon(body, code = null) {
  const c = String(body?.code || code || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(c)) throw badRequest("Coupon code must be 3-24 letters, digits or dashes",
    { code: "Invalid" });
  if (!["percent", "fixed"].includes(body?.kind)) throw badRequest("Coupon kind must be percent or fixed");
  const value = Math.round(Number(body?.value));
  if (!value || value < 1) throw badRequest("Coupon value must be positive", { value: "Required" });
  if (body.kind === "percent" && value > 100) throw badRequest("Percent cannot exceed 100", { value: "Max 100" });

  const fields = {
    kind: body.kind,
    value: body.kind === "fixed" ? Math.round(Number(body.value) * 100) : value,
    min_subtotal_cents: body.min_subtotal !== undefined ? Math.round(Number(body.min_subtotal) * 100) : 0,
    max_discount_cents: body.max_discount ? Math.round(Number(body.max_discount) * 100) : null,
    starts_at: body.starts_at || null,
    expires_at: body.expires_at || null,
    usage_limit: body.usage_limit === undefined || body.usage_limit === null || body.usage_limit === "" ? null : Number(body.usage_limit),
    active: body.active === undefined ? 1 : (body.active ? 1 : 0),
    note: body.note ? String(body.note).slice(0, 200) : null,
  };
  if (code) {
    if (!get(`SELECT code FROM coupons WHERE code = ?`, String(code).toUpperCase())) throw notFound("Coupon not found");
    run(`UPDATE coupons SET kind=?, value=?, min_subtotal_cents=?, max_discount_cents=?, starts_at=?,
                          expires_at=?, usage_limit=?, active=?, note=? WHERE code = ?`,
        fields.kind, fields.value, fields.min_subtotal_cents, fields.max_discount_cents, fields.starts_at,
        fields.expires_at, fields.usage_limit, fields.active, fields.note, String(code).toUpperCase());
  } else {
    if (get(`SELECT code FROM coupons WHERE code = ?`, c)) throw conflict("That coupon code exists", { code: "Already used" });
    run(`INSERT INTO coupons (code, kind, value, min_subtotal_cents, max_discount_cents, starts_at, expires_at,
                              usage_limit, used_count, active, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        c, fields.kind, fields.value, fields.min_subtotal_cents, fields.max_discount_cents,
        fields.starts_at, fields.expires_at, fields.usage_limit, fields.active, fields.note);
  }
  return get(`SELECT * FROM coupons WHERE code = ?`, c || String(code).toUpperCase());
}

export function deleteCoupon(code) {
  const c = String(code || "").toUpperCase();
  if (!get(`SELECT code FROM coupons WHERE code = ?`, c)) throw notFound("Coupon not found");
  run(`DELETE FROM coupons WHERE code = ?`, c);
  return { deleted: true };
}

/* Customers --------------------------------------------------------------- */

export function listCustomers(query = {}) {
  const like = query.q ? `%${String(query.q).replace(/[%_]/g, "")}%` : null;
  const params = [];
  let clause = "";
  if (like) { clause = "WHERE u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?"; params.push(like, like, like); }
  return all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.created_at,
                     (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
                     (SELECT COALESCE(SUM(o.total_cents),0) FROM orders o WHERE o.user_id = u.id AND o.status <> 'cancelled') AS spend_cents
                FROM users u ${clause} ORDER BY spend_cents DESC LIMIT 200`, ...params);
}

export function customerDetail(id) {
  const u = get(`SELECT id, name, email, phone, role, lang, active, created_at FROM users WHERE id = ?`, id);
  if (!u) throw notFound("Customer not found");
  u.orders = all(`SELECT id, number, status, total_cents, payment_method, placed_at FROM orders
                   WHERE user_id = ? ORDER BY placed_at DESC LIMIT 50`, id);
  u.addresses = all(`SELECT * FROM addresses WHERE user_id = ?`, id);
  u.reviews = all(`SELECT r.id, r.rating, r.title, r.status, r.created_at, p.name AS product_name
                     FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.user_id = ?`, id);
  return u;
}

export function setActiveCustomer(id, active) {
  if (get(`SELECT role FROM users WHERE id = ?`, id)?.role === "admin") {
    throw conflict("Admin accounts cannot be disabled from here");
  }
  run(`UPDATE users SET active = ?, updated_at = ? WHERE id = ?`, active ? 1 : 0, nowIso(), id);
  if (!active) run(`DELETE FROM sessions WHERE user_id = ?`, id);
  return get(`SELECT id, name, email, active FROM users WHERE id = ?`, id);
}

/* Reviews moderation ------------------------------------------------------ */

export const listReviews = (status = "all") => all(
  `SELECT r.*, u.name AS customer, p.name AS product_name, p.slug AS product_slug
     FROM reviews r JOIN users u ON u.id = r.user_id JOIN products p ON p.id = r.product_id
    ${status && status !== "all" ? "WHERE r.status = ?" : ""}
    ORDER BY r.created_at DESC LIMIT 200`, ...(status && status !== "all" ? [status] : []));

export function moderateReview(id, status) {
  if (!["pending", "published", "rejected"].includes(status)) throw badRequest("Unknown review status");
  const r = get(`SELECT * FROM reviews WHERE id = ?`, id);
  if (!r) throw notFound("Review not found");
  run(`UPDATE reviews SET status = ? WHERE id = ?`, status, id);
  recomputeRating(r.product_id);
  return get(`SELECT * FROM reviews WHERE id = ?`, id);
}

/* Dashboard --------------------------------------------------------------- */

export function metrics() {
  const scalar = (sql, ...p) => get(sql, ...p)?.v ?? 0;
  const day = (offset) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);

  const revenue = (extra = "") => scalar(`SELECT COALESCE(SUM(total_cents),0) AS v FROM orders
    WHERE status NOT IN ('cancelled','refunded') ${extra}`);

  return {
    revenue_cents: revenue(),
    revenue_7d_cents: revenue(`AND placed_at >= '${day(7)}'`),
    revenue_30d_cents: revenue(`AND placed_at >= '${day(30)}'`),
    orders: scalar(`SELECT COUNT(*) AS v FROM orders`),
    orders_today: scalar(`SELECT COUNT(*) AS v FROM orders WHERE placed_at >= ?`, day(0)),
    open_orders: scalar(`SELECT COUNT(*) AS v FROM orders WHERE status IN ('pending','confirmed','packing','shipped')`),
    customers: scalar(`SELECT COUNT(*) AS v FROM users WHERE role = 'customer'`),
    products: scalar(`SELECT COUNT(*) AS v FROM products WHERE status = 'active'`),
    drafts: scalar(`SELECT COUNT(*) AS v FROM products WHERE status = 'draft'`),
    units_sold: scalar(`SELECT COALESCE(SUM(oi.qty),0) AS v FROM order_items oi
                          JOIN orders o ON o.id = oi.order_id WHERE o.status NOT IN ('cancelled','refunded')`),
    avg_order_cents: scalar(`SELECT COALESCE(AVG(total_cents),0) AS v FROM orders WHERE status NOT IN ('cancelled','refunded')`),
    pending_reviews: scalar(`SELECT COUNT(*) AS v FROM reviews WHERE status = 'pending'`),
    low_stock: all(`SELECT id, sku, name, stock, low_stock_at FROM products
                     WHERE status = 'active' AND stock <= low_stock_at ORDER BY stock LIMIT 12`),
    by_day: all(`SELECT substr(placed_at,1,10) AS day, COUNT(*) AS orders,
                        COALESCE(SUM(total_cents),0) AS cents
                   FROM orders WHERE placed_at >= ? AND status NOT IN ('cancelled','refunded')
                  GROUP BY day ORDER BY day`, day(21)),
    top_products: all(`SELECT p.id, p.slug, p.name, SUM(oi.qty) AS units, SUM(oi.line_total_cents) AS cents
                         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
                        WHERE o.status NOT IN ('cancelled','refunded')
                        GROUP BY p.id ORDER BY units DESC LIMIT 8`),
    by_category: all(`SELECT c.name, COALESCE(SUM(oi.line_total_cents),0) AS cents, COALESCE(SUM(oi.qty),0) AS units
                        FROM categories c LEFT JOIN products p ON p.category_id = c.id
                        LEFT JOIN order_items oi ON oi.product_id = p.id
                        GROUP BY c.id ORDER BY cents DESC LIMIT 8`),
    recent_orders: all(`SELECT id, number, status, total_cents, payment_method, ship_name, placed_at
                          FROM orders ORDER BY placed_at DESC LIMIT 8`),
    events: all(`SELECT type, COUNT(*) AS n FROM events GROUP BY type ORDER BY n DESC LIMIT 10`),
  };
}
