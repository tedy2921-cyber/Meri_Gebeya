import { all, get, run, logEvent } from "./config.js";

const BASE_SELECT = `
  SELECT p.id, p.slug, p.name, p.name_am, p.description, p.description_am, p.brand, p.sku,
         p.unit, p.price_cents, p.compare_at_price_cents, p.currency, p.stock, p.low_stock_at,
         p.status, p.featured, p.rating_avg, p.rating_count, p.view_count,
         p.category_id, c.name AS category_name, c.name_am AS category_name_am, c.slug AS category_slug,
         (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_url
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id`;

const SORTS = {
  newest:  "p.id DESC",
  price_asc: "p.price_cents ASC",
  price_desc: "p.price_cents DESC",
  rating:  "p.rating_avg DESC, p.rating_count DESC",
  popular: "p.view_count DESC, p.rating_count DESC",
  name:    "p.name ASC",
};

/** Public catalog listing with search, filters, sorting and pagination. */
export function listProducts(query = {}, { includeDrafts = false } = {}) {
  const where = [];
  const params = [];

  if (!includeDrafts) where.push("p.status = 'active'");
  else if (query.status && query.status !== "all") { where.push("p.status = ?"); params.push(query.status); }

  if (query.q) {
    const like = `%${String(query.q).trim().replace(/[%_]/g, "")}%`;
    where.push(`(p.name LIKE ? OR p.name_am LIKE ? OR p.description LIKE ?
                OR p.brand LIKE ? OR p.sku LIKE ? OR c.name LIKE ? OR c.name_am LIKE ?)`);
    params.push(like, like, like, like, like, like, like);
  }
  if (query.category) {
    where.push(`(c.slug = ? OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))`);
    params.push(query.category, query.category);
  }
  if (query.featured === "1") where.push("p.featured = 1");
  if (query.onSale === "1") where.push("p.compare_at_price_cents IS NOT NULL");
  if (query.inStock === "1") where.push("p.stock > 0");
  if (query.min) { where.push("p.price_cents >= ?"); params.push(toCents(query.min)); }
  if (query.max) { where.push("p.price_cents <= ?"); params.push(toCents(query.max)); }

  const sort = SORTS[query.sort] || (query.q ? "p.featured DESC, p.rating_avg DESC, p.id DESC" : "p.featured DESC, p.id DESC");
  const per = Math.min(Math.max(Number(query.per) || 12, 1), 60);
  const page = Math.max(Number(query.page) || 1, 1);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = get(`SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id ${clause}`, ...params)?.n ?? 0;
  const items = all(
    `${BASE_SELECT} ${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
    ...params, per, (page - 1) * per
  );

  return { items, total, page, per, pages: Math.max(1, Math.ceil(total / per)) };
}

export function findProduct(slugOrId) {
  const row = /^\d+$/.test(String(slugOrId))
    ? get(`${BASE_SELECT} WHERE p.slug = ? OR p.id = ?`, String(slugOrId), Number(slugOrId))
    : get(`${BASE_SELECT} WHERE p.slug = ?`, String(slugOrId));
  if (!row) return null;
  row.images = all("SELECT url, alt FROM product_images WHERE product_id = ? ORDER BY sort, id", row.id);
  row.reviews = all(
    `SELECT r.id, r.rating, r.title, r.body, r.created_at, u.name AS author
       FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.product_id = ? AND r.status = 'published'
      ORDER BY r.created_at DESC LIMIT 20`, row.id);
  return row;
}

export function relatedProducts(productId, limit = 8) {
  const p = get("SELECT category_id FROM products WHERE id = ?", productId);
  if (!p) return [];
  return all(
    `${BASE_SELECT} WHERE p.status = 'active' AND p.id <> ?
       AND (p.category_id = ? OR p.brand = (SELECT brand FROM products WHERE id = ?))
     ORDER BY p.rating_avg DESC, p.view_count DESC LIMIT ?`,
    productId, p.category_id, productId, limit
  );
}

/** Products that share a basket with the given one — the co-purchase signal. */
export function frequentlyBoughtTogether(productId, limit = 4) {
  return all(
    `${BASE_SELECT}
       JOIN order_items o2 ON o2.product_id = p.id
       JOIN order_items o1 ON o1.order_id = o2.order_id
      WHERE o1.product_id = ? AND p.status = 'active' AND p.id <> ?
      GROUP BY p.id ORDER BY COUNT(*) DESC LIMIT ?`,
    productId, productId, limit
  );
}

export function bestSellers(limit = 8) {
  return all(
    `${BASE_SELECT}
       LEFT JOIN order_items oi ON oi.product_id = p.id
      WHERE p.status = 'active'
      GROUP BY p.id
      ORDER BY COALESCE(SUM(oi.qty), 0) DESC, p.view_count DESC LIMIT ?`, limit);
}

export function categories() {
  const rows = all(
    `SELECT c.id, c.slug, c.name, c.name_am, c.blurb, c.icon, c.parent_id, c.sort,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'active') AS product_count
       FROM categories c WHERE c.active = 1 ORDER BY c.sort, c.name`);
  const tops = rows.filter((r) => !r.parent_id);
  return tops.map((t) => ({ ...t, children: rows.filter((r) => r.parent_id === t.id) }));
}

export function priceBounds() {
  const r = get("SELECT MIN(price_cents) AS min, MAX(price_cents) AS max FROM products WHERE status = 'active'");
  return { min: r?.min ?? 0, max: r?.max ?? 0 };
}

export function recordView(productId, userId = null) {
  run("UPDATE products SET view_count = view_count + 1 WHERE id = ?", productId);
  logEvent("product.view", { productId, userId });
}

export const toCents = (value) => Math.round(Number(value) * 100);
