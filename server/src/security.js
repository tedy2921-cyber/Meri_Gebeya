import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

/* Passwords ---------------------------------------------------------------- */

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, salt, hex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* Tokens ------------------------------------------------------------------- */

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hashToken = (token) => createHmac("sha256", "mg-token").update(token).digest("hex");

export function sign(value) {
  return createHmac("sha256", process.env.MG_SECRET || "dev-only-change-me")
    .update(JSON.stringify(value))
    .digest("base64url");
}

/* Cookies ------------------------------------------------------------------ */

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k) out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function cookie(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (opts.maxAge) bits.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) bits.push("HttpOnly");
  if (process.env.NODE_ENV === "production") bits.push("Secure");
  return bits.join("; ");
}
