import { all, get, run, nowIso, config, logEvent } from "./config.js";
import { hashPassword, verifyPassword, randomToken, hashToken } from "./security.js";
import { badRequest, conflict, unauthorized, isEmail } from "./http.js";

/* Sessions are opaque random tokens; only their hash is stored. */

export const PUBLIC_USER = `id, name, email, phone, role, lang, active, created_at`;

export function createUser({ name, email, password, phone = null, role = "customer", lang = "en" }) {
  if (!isEmail(email)) throw badRequest("Enter a valid email address", { email: "Invalid email" });
  if (String(password || "").length < 8) {
    throw badRequest("Password must be at least 8 characters", { password: "Too short" });
  }
  const clean = String(email).trim().toLowerCase();
  if (get(`SELECT id FROM users WHERE email = ?`, clean)) {
    throw conflict("An account with that email already exists", { email: "Already registered" });
  }
  const now = nowIso();
  const r = run(`INSERT INTO users (name, email, phone, password_hash, role, lang, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    String(name).trim().slice(0, 120), clean, phone ? String(phone).trim() : null,
    hashPassword(password), role, lang === "am" ? "am" : "en", now, now);
  logEvent("user.register", { userId: Number(r.lastInsertRowid) });
  return get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, Number(r.lastInsertRowid));
}

export function checkPassword(email, password) {
  const user = get(`SELECT * FROM users WHERE email = ?`, String(email || "").trim().toLowerCase());
  if (!user || !verifyPassword(String(password || ""), user.password_hash)) {
    throw unauthorized("Email or password is not correct");
  }
  if (!user.active) throw unauthorized("This account is disabled");
  return user;
}

export function startSession(userId, req) {
  const token = randomToken(32);
  const now = Date.now();
  run(`INSERT INTO sessions (user_id, token_hash, ip, user_agent, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    userId, hashToken(token),
    (req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "").split(",")[0].trim(),
    String(req?.headers?.["user-agent"] || "").slice(0, 300),
    new Date(now).toISOString(), new Date(now + config.sessionTtlMs).toISOString());
  return token;
}

export function userFromToken(token) {
  if (!token) return null;
  const row = get(`SELECT u.${PUBLIC_USER.split(", ").join(", u.")}, s.token_hash, s.expires_at, s.id AS session_id
                     FROM sessions s JOIN users u ON u.id = s.user_id
                    WHERE s.token_hash = ?`, hashToken(token));
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    run(`DELETE FROM sessions WHERE id = ?`, row.session_id);
    return null;
  }
  // sliding expiry: refresh long-lived sessions instead of re-asking for a password
  run(`UPDATE sessions SET expires_at = ? WHERE id = ?`,
      new Date(Date.now() + config.sessionTtlMs).toISOString(), row.session_id);
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone,
    role: row.role, lang: row.lang, active: row.active, created_at: row.created_at,
  };
}

export function endSession(token) {
  if (token) run(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(token));
}

export function changePassword(userId, current, next) {
  const u = get(`SELECT password_hash FROM users WHERE id = ?`, userId);
  if (!u || !verifyPassword(String(current || ""), u.password_hash)) {
    throw badRequest("Current password is not correct", { current: "Wrong password" });
  }
  if (String(next || "").length < 8) throw badRequest("New password must be at least 8 characters",
    { next: "Too short" });
  run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, hashPassword(next), nowIso(), userId);
  run(`DELETE FROM sessions WHERE user_id = ?`, userId);   // sign out everywhere; caller issues a fresh cookie
  return true;
}

export function updateProfile(userId, fields) {
  const sets = [], params = [];
  if (fields.name !== undefined) { sets.push("name = ?"); params.push(String(fields.name).trim().slice(0, 120)); }
  if (fields.phone !== undefined) { sets.push("phone = ?"); params.push(fields.phone ? String(fields.phone).trim() : null); }
  if (fields.lang !== undefined) { sets.push("lang = ?"); params.push(fields.lang === "am" ? "am" : "en"); }
  if (!sets.length) return get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, userId);
  run(`UPDATE users SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...params, nowIso(), userId);
  return get(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`, userId);
}

/* Addresses --------------------------------------------------------------- */

const ADDRESS_FIELDS = ["label", "recipient", "phone", "region", "city", "subcity", "woreda", "landmark"];

export function listAddresses(userId) {
  return all(`SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id`, userId);
}

export function saveAddress(userId, body, id = null) {
  for (const req of ["recipient", "phone", "region", "city"]) {
    if (!String(body?.[req] || "").trim()) throw badRequest("Missing address fields", { [req]: "Required" });
  }
  const values = ADDRESS_FIELDS.map((k) => body?.[k] !== undefined && body[k] !== null ? String(body[k]).trim() : null);
  const [label, recipient, phone, region, city, subcity, woreda, landmark] = values;
  const isDefault = body?.is_default ? 1 : 0;

  if (isDefault) run(`UPDATE addresses SET is_default = 0 WHERE user_id = ?`, userId);

  if (id) {
    const owns = get(`SELECT id FROM addresses WHERE id = ? AND user_id = ?`, id, userId);
    if (!owns) throw badRequest("Address not found");
    run(`UPDATE addresses SET label=?, recipient=?, phone=?, region=?, city=?, subcity=?, woreda=?, landmark=?, is_default=?
          WHERE id = ?`,
        label || "Home", recipient, phone, region, city, subcity, woreda, landmark, isDefault, id);
    return get(`SELECT * FROM addresses WHERE id = ?`, id);
  }
  if (!get(`SELECT id FROM addresses WHERE user_id = ?`, userId)) {
    return insert(userId, label, recipient, phone, region, city, subcity, woreda, 1);
  }
  return insert(userId, label, recipient, phone, region, city, subcity, woreda, isDefault);
}

function insert(userId, label, recipient, phone, region, city, subcity, woreda, isDefault) {
  const r = run(`INSERT INTO addresses (user_id, label, recipient, phone, region, city, subcity, woreda, landmark, is_default, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, label || "Home", recipient, phone, region, city, subcity, woreda, null, isDefault, nowIso());
  return get(`SELECT * FROM addresses WHERE id = ?`, Number(r.lastInsertRowid));
}

export function deleteAddress(userId, id) {
  const owns = get(`SELECT id FROM addresses WHERE id = ? AND user_id = ?`, id, userId);
  if (!owns) throw badRequest("Address not found");
  run(`DELETE FROM addresses WHERE id = ?`, id);
  return true;
}

/* Wishlist ---------------------------------------------------------------- */

export function wishlist(userId) {
  return all(`SELECT p.id, p.slug, p.name, p.name_am, p.price_cents, p.stock, p.rating_avg, p.rating_count,
                     (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_url
                FROM wishitems w JOIN products p ON p.id = w.product_id
               WHERE w.user_id = ? ORDER BY w.created_at DESC`, userId);
}

export function toggleWish(userId, productId) {
  const exists = get(`SELECT 1 AS x FROM wishitems WHERE user_id = ? AND product_id = ?`, userId, productId);
  if (exists) {
    run(`DELETE FROM wishitems WHERE user_id = ? AND product_id = ?`, userId, productId);
    return { saved: false };
  }
  if (!get(`SELECT id FROM products WHERE id = ?`, productId)) throw badRequest("Product not found");
  run(`INSERT INTO wishitems (user_id, product_id, created_at) VALUES (?, ?, ?)`, userId, productId, nowIso());
  logEvent("wish.add", { userId, productId });
  return { saved: true };
}

/* Reviews ----------------------------------------------------------------- */

export function addReview(userId, productId, { rating, title, body, orderId = null }) {
  const n = Math.floor(Number(rating));
  if (!(n >= 1 && n <= 5)) throw badRequest("Pick a rating from 1 to 5", { rating: "Required" });
  if (!get(`SELECT id FROM products WHERE id = ?`, productId)) throw badRequest("Product not found");

  const bought = get(`SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
                       WHERE o.user_id = ? AND oi.product_id = ? AND o.status IN ('delivered','shipped')
                       LIMIT 1`, userId, productId);
  const existing = get(`SELECT id FROM reviews WHERE user_id = ? AND product_id = ?`, userId, productId);
  const now = nowIso();

  if (existing) {
    run(`UPDATE reviews SET rating=?, title=?, body=?, status='published', created_at=? WHERE id = ?`,
        n, title ? String(title).slice(0, 120) : null, body ? String(body).slice(0, 2000) : null, now, existing.id);
  } else {
    run(`INSERT INTO reviews (product_id, user_id, order_id, rating, title, body, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'published', ?)`,
        productId, userId, bought?.id || orderId || null, n,
        title ? String(title).slice(0, 120) : null, body ? String(body).slice(0, 2000) : null, now);
  }
  recomputeRating(productId);
  logEvent("review.add", { userId, productId, payload: { rating: n, verified: Boolean(bought) } });
  return get(`SELECT id, rating, title, body, status, created_at FROM reviews
               WHERE product_id = ? AND user_id = ?`, productId, userId);
}

export function recomputeRating(productId) {
  const r = get(`SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews
                  WHERE product_id = ? AND status = 'published'`, productId);
  run(`UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?`,
      Number((r?.avg || 0).toFixed(2)), r?.n || 0, productId);
}

/**
 * Adopt orders a shopper placed as a guest before they had an account.
 * Matched on the receipt email, so "track then register" keeps history.
 */
export function claimGuestOrders(userId, email) {
  if (!userId || !isEmail(email)) return 0;
  const before = get(`SELECT COUNT(*) AS n FROM orders WHERE user_id IS NULL AND lower(email) = lower(?)`,
                     String(email).trim());
  run(`UPDATE orders SET user_id = ? WHERE user_id IS NULL AND lower(email) = lower(?)`,
      userId, String(email).trim());
  return before?.n || 0;
}
