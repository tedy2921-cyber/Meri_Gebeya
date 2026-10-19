import { createServer } from "node:http";
import { config, migrate } from "./config.js";
import { api, authenticate } from "./api.js";
import { buildContext, sendJson, sendError, serveStatic, notFound, HttpError } from "./http.js";
import { cookie } from "./security.js";

migrate();                                     // idempotent — safe on every boot

const server = createServer(async (req, res) => {
  const started = Date.now();
  let ctx;

  try {
    ctx = await buildContext(req, res);
  } catch (err) {
    // body could not be read/parsed
    const status = err instanceof HttpError ? err.status : 400;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err.message || "Bad request" }));
    return;
  }

  // Cookies set by handlers are written straight onto the response so they
  // survive even when the handler ends it (sendJson closes the head).
  ctx.cookie = (name, value, opts) => {
    const prev = res.getHeader("Set-Cookie");
    const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
    list.push(cookie(name, value, opts));
    res.setHeader("Set-Cookie", list);
  };

  try {
    authenticate(ctx);
    const hit = api.match(ctx.method, ctx.path);

    if (ctx.path.startsWith("/api/")) {
      if (!hit) throw notFound(`No endpoint for ${ctx.method} ${ctx.path}`);
      ctx.params = hit.params;
      const out = await hit.handler(ctx);
      if (!res.headersSent) sendJson(ctx, ctx.status || 200, out ?? { ok: true });
      log(req, res, started);
      return;
    }

    if (hit) throw new HttpError(405, "Use the JSON API for that");

    if (["GET", "HEAD"].includes(req.method)) {
      const served = await serveStatic(ctx);
      if (served) { log(req, res, started); return; }
    }

    // Unknown page: a small inline 404 keeps the browser experience clean.
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>404 — Meri Gebeya</title>
<body style="font:16px/1.6 system-ui;background:#0b1020;color:#e8ecf8;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:44px;margin:0 0 8px">404</h1>
<p>That page is not on the shelf.</p><p><a style="color:#7dd3fc" href="/">Back to the shop</a></p></div>`);
    log(req, res, started);
  } catch (err) {
    if (!res.headersSent) sendError(ctx, err);
    else { console.error("[post-response]", err); res.end(); }
    log(req, res, started, err);
  }
});

function log(req, res, started, err) {
  if (config.env === "test") return;
  const flag = res.statusCode >= 500 ? "✖" : res.statusCode >= 400 ? "!" : " ";
  console.log(`${flag} ${req.method.padEnd(6)} ${res.statusCode} ${String(req.url).slice(0, 70).padEnd(70)} ${Date.now() - started}ms${err ? ` ${err.message}` : ""}`);
}

server.listen(config.port, config.host, () => {
  console.log(`\n  Meri Gebeya (መሪ ገበያ) is running`);
  console.log(`  store   http://${config.host}:${config.port}/`);
  console.log(`  admin   http://${config.host}:${config.port}/admin`);
  console.log(`  api     http://${config.host}:${config.port}/api/health`);
  console.log(`  db      ${config.dataDir}\n`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n  ${sig} received — closing down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
