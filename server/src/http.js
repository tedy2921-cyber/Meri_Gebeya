import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { config } from "./config.js";
import { parseCookies, cookie } from "./security.js";

export class HttpError extends Error {
  constructor(status, message, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
export const badRequest = (m, fields) => new HttpError(400, m, fields);
export const unauthorized = (m = "Sign in first") => new HttpError(401, m);
export const forbidden = (m = "Not allowed") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m, fields) => new HttpError(409, m, fields);

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

/* Router ------------------------------------------------------------------- */

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    const names = [];
    const regex = new RegExp(
      "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\//g, "/")
        .replace(/:(\w+)/g, (_, key) => { names.push(key); return "([^/]+)"; }) + "$"
    );
    this.routes.push({ method, regex, names, handler });
    return this;
  }
  get(p, h)    { return this.add("GET", p, h); }
  post(p, h)   { return this.add("POST", p, h); }
  patch(p, h)  { return this.add("PATCH", p, h); }
  put(p, h)    { return this.add("PUT", p, h); }
  delete(p, h) { return this.add("DELETE", p, h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === "HEAD" && r.method === "GET")) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }
}

/* Request context ---------------------------------------------------------- */

const MAX_BODY = 512 * 1024;

export async function buildContext(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const cookies = parseCookies(req.headers.cookie || "");
  const setCookies = [];

  const ctx = {
    req, res, url,
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    cookies,
    body: null,
    user: null,
    params: {},
    respondWith: null,
    cookie(name, value, opts) { setCookies.push(cookie(name, value, opts)); },
  };

  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    ctx.body = await readBody(req);
  }
  ctx.setCookies = setCookies;
  return ctx;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw badRequest("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = (req.headers["content-type"] || "").split(";")[0];
  try {
    if (type === "application/json") return JSON.parse(raw);
    if (type === "application/x-www-form-urlencoded") {
      return Object.fromEntries(new URLSearchParams(raw));
    }
    return JSON.parse(raw);
  } catch {
    throw badRequest("Body must be valid JSON");
  }
}

/* Responses ---------------------------------------------------------------- */

export function sendJson(ctx, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  ctx.res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  ctx.res.end(ctx.method === "HEAD" ? undefined : body);
}

export function sendError(ctx, err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error("[500]", err);
  sendJson(ctx, status, {
    error: status >= 500 ? "Something went wrong on our side" : err.message,
    code: err.code || undefined,
    fields: err.fields || undefined,
  });
}

/* Static files ------------------------------------------------------------- */

const SPA_FALLBACK = { "/": "index.html", "/admin": "admin.html", "/admin/": "admin.html" };

export async function serveStatic(ctx) {
  let pathname = decodeURIComponent(ctx.path);
  if (pathname in SPA_FALLBACK) pathname = "/" + SPA_FALLBACK[pathname];
  const root = resolve(config.publicDir);
  const target = normalize(join(root, pathname));
  if (!target.startsWith(root)) throw forbidden("Nope");

  try {
    const info = await stat(target);
    if (info.isDirectory()) throw notFound();
    const data = await readFile(target);
    const ext = extname(target).toLowerCase();
    /* Dev must always see the file you just edited. In production, HTML still
       revalidates but hashed/static assets get a short public cache. */
    const cache = config.env === "production" && ext !== ".html"
      ? "public, max-age=3600"
      : "no-cache";
    ctx.res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
    });
    ctx.res.end(ctx.method === "HEAD" ? undefined : data);
    return true;
  } catch {
    return false;
  }
}

/* Small validators used by the routes -------------------------------------- */

export const isEmail = (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const isPhone = (v) => typeof v === "string" && /^[+]?[\d\s-]{9,17}$/.test(v.trim());
export const slugify = (v) => String(v).toLowerCase().trim()
  .replace(/[^a-z0-9\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

export function pickFields(obj, allowed) {
  const out = {};
  for (const key of allowed) if (obj?.[key] !== undefined) out[key] = obj[key];
  return out;
}

export function requireFields(body, names) {
  const fields = {};
  for (const n of names) {
    const v = body?.[n];
    if (v === undefined || v === null || String(v).trim() === "") fields[n] = `${n} is required`;
  }
  if (Object.keys(fields).length) throw badRequest("Check the highlighted fields", fields);
}
