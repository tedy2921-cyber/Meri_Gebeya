# 07 · Skills and commands you need to build projects like this yourself

This is the handbook for your *next* project. It lists what you need to know,
where each skill shows up in Meri Gebeya so you can see it used for real, and
every command used to build, run, test and debug it.

You do not need to master everything before starting. Learn in the order in
[the learning path](#5-a-learning-path-in-order) and build something small at
each stage.

**Contents**

1. [The five languages](#1-the-five-languages)
2. [Concepts that matter more than any language](#2-concepts-that-matter-more-than-any-language)
3. [Your tools](#3-your-tools)
4. [Command cheat sheet](#4-command-cheat-sheet)
5. [A learning path, in order](#5-a-learning-path-in-order)
6. [Starter recipe for a new project](#6-starter-recipe-for-a-new-project)
7. [Mistakes everyone makes (and the fix)](#7-mistakes-everyone-makes-and-the-fix)

---

## 1. The five languages

A full-stack website uses five languages. Each one has one job.

| Language | Job | Where in Meri Gebeya | How much you need |
|----------|-----|----------------------|-------------------|
| **HTML** | Structure: what is on the page | `public/index.html`, the templates inside `app.js` | Solid basics — one week |
| **CSS** | Looks: colour, spacing, layout | `public/assets/styles.css`, `admin.css` | Flexbox + Grid + variables — two weeks |
| **JavaScript** | Behaviour, in the browser **and** on the server | everything in `public/assets/` and `server/src/` | The big one — months, keep learning |
| **SQL** | Store and query data | `db/schema.sql`, every `get/all/run` call | SELECT/INSERT/UPDATE/JOIN — two weeks |
| **JSON** | The format the browser and server talk in | every API response | One afternoon |

### HTML — what to know

- Document skeleton: `<!doctype html>`, `<head>`, `<meta charset="utf-8">`, `<meta name="viewport">`, `<body>`.
- Semantic tags: `<header>`, `<main>`, `<section>`, `<nav>`, `<footer>`, `<article>` — they help screen readers and search engines.
- Forms: `<form>`, `<input type="email|password|number|search">`, `<select>`, `<label>`, `required`, `autocomplete`.
- Attributes you will use daily: `id`, `class`, `href`, `src`, `alt`, and custom `data-*` (e.g. `data-add="7"` on the Add button, read in JS as `button.dataset.add`).

### CSS — what to know

- Selectors and the box model (`margin`, `border`, `padding`, `box-sizing: border-box`).
- **Custom properties (variables):** `:root { --brand: #0f6b4f }` then `color: var(--brand)` — see the top of `styles.css`.
- **Flexbox** for rows of things (header bar, buttons). **Grid** for cards (`grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`).
- **Media queries** for phones: `@media (max-width: 720px) { … }`.
- States and motion: `:hover`, `:focus-visible`, `transition`.

### JavaScript — the features this project actually uses

Learn these and you can read every file in the project.

| Feature | Example from Meri Gebeya |
|---------|--------------------------|
| `const` / `let`, arrow functions | `const ETB = (cents) => …` |
| Template literals (HTML in strings) | `` `<h3>${esc(p.name)}</h3>` `` |
| Destructuring and defaults | `function productCard(row, { wish = false } = {})` |
| Optional chaining `?.` and `??` | `ctx.body?.qty ?? 1` |
| Array methods | `lines.reduce((n, l) => n + l.line_total_cents, 0)`, `.map`, `.filter`, `.find` |
| Objects as lookup tables | `ORDER_STATUS[status].next` |
| ES modules | `import { api, t } from "./core.js"` / `export function …` |
| `async` / `await` + `try/catch` | `const h = await api.get("/home")` |
| `fetch` | inside `call()` in `core.js` |
| DOM | `document.querySelector`, `.innerHTML`, `.addEventListener`, `.closest()` |
| Event delegation | one `document.addEventListener("click", …)` for every Add button |
| Classes and custom errors | `class HttpError extends Error` in `http.js` |
| Regular expressions | the router turns `/product/:slug` into `^/product/([^/]+)$` |
| Closures | `router()` keeps `currentCleanup` between page changes |

**Node.js** is JavaScript outside the browser. Extra things to learn for the server side:

- `node:http` — `createServer((req, res) => …)`, `res.writeHead(status, headers)`, `res.end(body)`.
- `node:fs` and `node:path` — reading files, building paths safely with `join`.
- `process.env` — reading settings like `PORT`.
- `node:sqlite` — `new DatabaseSync(file)`, `db.prepare(sql).all(...)`.
- `node:crypto` — `randomBytes`, `scryptSync`, `createHmac`.
- `package.json` — `"type": "module"` and `"scripts"`.

### SQL — what to know

```sql
-- create
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL);
-- write
INSERT INTO products (name, price_cents) VALUES ('Berbere 1kg', 42000);
UPDATE products SET stock = stock - 2 WHERE id = 7;
DELETE FROM cart_items WHERE cart_id = 13;
-- read
SELECT name, price_cents FROM products WHERE stock > 0 ORDER BY price_cents DESC LIMIT 10;
-- combine tables
SELECT o.number, u.name FROM orders o JOIN users u ON u.id = o.user_id;
-- summarise
SELECT status, COUNT(*) AS n, SUM(total_cents) AS revenue FROM orders GROUP BY status;
```

Also learn: `PRIMARY KEY`, `FOREIGN KEY … REFERENCES`, `UNIQUE`, `CHECK`, `NOT NULL`,
`DEFAULT`, `CREATE INDEX`, and transactions (`BEGIN` / `COMMIT` / `ROLLBACK`).

Practise on the real data right now:

```bash
npm run sql -- ".tables"
npm run sql -- "SELECT status, COUNT(*) AS n FROM orders GROUP BY status"
```

---

## 2. Concepts that matter more than any language

Languages change; these ideas don't. Every web project uses all of them.

**Client and server.** The *client* (browser) shows things and collects
clicks. The *server* (Node) holds the data and the rules. They only talk
through HTTP requests. The client is never trusted — anyone can edit it in
DevTools — so prices, stock and permissions are always checked on the server.

**HTTP methods** say what you want to do:

| Method | Meaning | Example |
|--------|---------|---------|
| `GET` | read | `GET /api/products?category=coffee-tea` |
| `POST` | create / do an action | `POST /api/cart/items`, `POST /api/checkout` |
| `PATCH` | change part of something | `PATCH /api/cart/items/7` with `{"qty":3}` |
| `DELETE` | remove | `DELETE /api/cart/items/7` |

**Status codes** say how it went: `200` OK · `201` created · `400` your input
is wrong · `401` sign in first · `403` you're signed in but not allowed ·
`404` doesn't exist · `409` conflicts with current state (not enough stock,
illegal status change) · `500` the server broke.

**REST API.** URLs name *things* (`/api/orders/15`), methods say the
*action*. Responses are JSON. Errors are JSON too, with a message
(`{"error":"Only 3 left in stock"}`).

**Cookies and sessions.** HTTP forgets you between requests. On login the
server creates a random token, stores its hash, and sends the token in a
cookie. The browser sends it back on every request; the server looks it up
to know who you are.

**Hashing vs encryption.** Passwords are *hashed* (one-way, can't be
reversed), never encrypted or stored plainly.

**Transactions.** Several database changes that must all happen or none
happen — like checkout (order + items + payment + stock).

**Validation in two places.** In the browser for a nice experience; on the
server for safety. Only the server one actually protects you.

**Escaping output.** Any text a user typed must go through `esc()` before
being put into HTML, otherwise someone can inject a `<script>` (this attack
is called XSS).

**Single-page app (SPA) + routing.** One HTML page; JavaScript redraws the
middle when the URL hash changes (`#/cart`, `#/product/harar-longberry`).

**Separation of concerns.** Each file has one job (see doc 01). When something
breaks, you know which file to open.

**Environment variables.** Settings that change between your laptop and the
real server (port, secret key) live outside the code — in `.env` or the
hosting dashboard.

---

## 3. Your tools

You already have these installed on this machine:

| Tool | What it's for | Check it |
|------|---------------|----------|
| **Node.js** (v24) | Runs the server and the scripts | `node --version` |
| **npm** | Runs `package.json` scripts; installs packages when you use them | `npm --version` |
| **VS Code** | Editing code | `code .` opens the current folder |
| **Git** | Saves versions of your code | `git --version` |
| **curl** | Calls your API from the terminal | `curl --version` |
| **A browser + DevTools** | Testing the frontend | press **F12** |

Optional but useful later: **DB Browser for SQLite** (free app to look at the
`.db` file with a mouse), **Postman** or **Insomnia** (curl with buttons),
**Docker** (when you move to Postgres — it's already installed here).

### VS Code shortcuts worth learning on day one

| Shortcut | Does |
|----------|------|
| `Ctrl+P` | Open a file by typing part of its name |
| `Ctrl+Shift+F` | Search the whole project |
| `F12` on a name | Jump to where it's defined |
| `Ctrl+/` | Comment / uncomment lines |
| `Alt+↑/↓` | Move a line up or down |
| `Ctrl+D` | Select the next copy of the current word (multi-edit) |
| `` Ctrl+` `` | Open the terminal inside VS Code |
| `Shift+Alt+F` | Format the file |

### Browser DevTools (F12) — the four tabs you'll live in

| Tab | Use it to |
|-----|-----------|
| **Elements** | See the HTML your JS produced; tweak CSS live to try a colour or spacing |
| **Console** | See red JavaScript errors; run code like `await fetch("/api/health").then(r => r.json())` |
| **Network** | See every API call: URL, status code, what was sent, what came back. **The first place to look when "nothing happens".** |
| **Application → Cookies** | See `mg_session` / `mg_cart`; delete them to act as a brand-new visitor |

Tick **Network → Disable cache** while DevTools is open, and use
**Ctrl+Shift+R** (hard reload) after editing JS or CSS.

---

## 4. Command cheat sheet

Commands are shown for **Git Bash / macOS / Linux**. Where Windows
PowerShell is different, it's shown underneath.

### 4.1 Moving around the terminal

```bash
pwd                         # where am I?
ls                          # what's here?            (PowerShell: ls or dir)
cd meri-gebeya              # go into a folder
cd ..                       # go up one level
mkdir my-shop               # make a folder
code .                      # open this folder in VS Code
clear                       # clean the screen         (or Ctrl+L)
```

Press **Tab** to auto-complete file names and **↑** to repeat the last command.

### 4.2 This project's commands (run inside `meri-gebeya/`)

```bash
npm start                   # run the server on http://127.0.0.1:4000
npm run dev                 # same, auto-restarts when you save a server file
npm run start:env           # same as start, but reads settings from .env
npm run seed                # fill an empty database with demo data
npm run reset               # ⚠ wipe the database and re-seed it
npm run check               # syntax-check every JS file
npm run sql -- ".tables"                         # list tables
npm run sql -- ".schema orders"                  # show how a table is defined
npm run sql -- "SELECT * FROM coupons"           # query anything (read-only)
npm run sql -- --write "UPDATE products SET stock = 50 WHERE id = 1"   # change data
```

Stop the server with **Ctrl+C** in the terminal where it's running.

### 4.3 Node itself

```bash
node --version              # which Node? (this project needs 22.5 or newer)
node file.js                # run a file
node --watch file.js        # re-run on every save
node --check file.js        # find syntax errors without running
node --env-file=.env file.js     # load settings from .env
node                        # interactive console — try 0.1 + 0.2, then 10 + 20 (why cents!)
```

### 4.4 Settings / environment variables

```bash
PORT=5000 npm start                       # Git Bash, macOS, Linux
```
```powershell
$env:PORT = "5000"; npm start             # PowerShell
```
Or copy `.env.example` to `.env`, edit it, and use `npm run start:env`.

### 4.5 npm, for future projects

```bash
npm init -y                 # create package.json in a new folder
npm install express         # add a package (goes in node_modules/, listed in package.json)
npm install -D nodemon      # add a tool only needed while developing
npm install                 # install everything listed in package.json (after cloning)
npm run <name>              # run a script from package.json
npm outdated                # which packages have updates?
npm audit                   # known security problems in your packages?
```

Meri Gebeya needs none of these — but almost every other project will.

### 4.6 Git — save your work

```bash
git init                            # start tracking a folder (once)
git status                          # what changed?
git diff                            # show the exact changes
git add server/src/cart.js          # stage one file
git add .                           # stage everything (check .gitignore first!)
git commit -m "Add coupon support"  # save a version with a message
git log --oneline                   # list saved versions
git switch -c feature/reviews       # new branch for a new feature
git switch master                   # back to the main branch
git merge feature/reviews           # bring the feature in
git restore cart.js                 # ⚠ throw away unsaved changes to a file
```

Publishing to GitHub (once you've created an empty repo there):

```bash
git remote add origin https://github.com/<you>/meri-gebeya.git
git push -u origin master           # first time
git push                            # every time after
git clone https://github.com/<you>/meri-gebeya.git   # get it on another computer
```

`.gitignore` already keeps `data/` (your database), `.env` (secrets) and
`node_modules/` out of Git. **Never commit passwords or API keys.**

Habit: commit every time something works. Small commits with clear messages
let you go back when you break things.

### 4.7 curl — test the API without a browser

```bash
# read
curl -s http://127.0.0.1:4000/api/health
curl -s "http://127.0.0.1:4000/api/products?q=coffee&sort=price_asc"

# write JSON, keeping cookies in jar.txt like a browser would
curl -s -c jar.txt -b jar.txt -X POST http://127.0.0.1:4000/api/cart/items \
     -H "content-type: application/json" -d '{"product_id":1,"qty":2}'

# sign in, then call an admin endpoint with that session
curl -s -c jar.txt -b jar.txt -X POST http://127.0.0.1:4000/api/auth/login \
     -H "content-type: application/json" -d '{"email":"admin@merigebeya.et","password":"Admin12345"}'
curl -s -b jar.txt http://127.0.0.1:4000/api/admin/metrics

# see the status code and headers too
curl -i http://127.0.0.1:4000/api/products/does-not-exist
```

| Flag | Means |
|------|-------|
| `-s` | silent (no progress bar) |
| `-i` | show response headers + status |
| `-X POST` | which HTTP method |
| `-H "…"` | add a header |
| `-d '…'` | the request body |
| `-c jar.txt` / `-b jar.txt` | save / send cookies |

On PowerShell, type `curl.exe` instead of `curl` (plain `curl` there is a
different command), and put JSON in a file: `-d "@body.json"`.

### 4.8 "Port 4000 is already in use"

An old server is still running. Stop it:

```bash
# macOS / Linux
lsof -ti :4000 | xargs kill
```
```powershell
# Windows PowerShell
Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```
Or just use another port: `PORT=4001 npm start`.

---

## 5. A learning path, in order

Each stage ends with a small project. **Building is how it sticks** — reading
alone won't.

| Stage | Learn | Build | Then read in Meri Gebeya |
|-------|-------|-------|--------------------------|
| 1 · Static pages (2–3 wk) | HTML, CSS, Flexbox, Grid, media queries | A 3-page personal site that works on a phone | `index.html`, `styles.css` |
| 2 · JavaScript basics (4–6 wk) | Variables, functions, arrays, objects, DOM, events | A to-do list that saves to `localStorage` | `core.js` helpers (`esc`, `ETB`, `t`) |
| 3 · Async + APIs (2 wk) | Promises, `async/await`, `fetch`, JSON | A weather page using a free public API | `call()` in `core.js` |
| 4 · Terminal + Git (1 wk, alongside) | Commands in section 4 | Put stages 1–3 on GitHub | `.gitignore`, `package.json` |
| 5 · Node server (3 wk) | `node:http`, routing, JSON responses, status codes | A notes API: GET/POST/DELETE `/api/notes` stored in a JSON file | `http.js`, `server.js` |
| 6 · SQL (2–3 wk) | Tables, keys, SELECT/JOIN/GROUP BY, transactions | Move the notes API into SQLite | `schema.sql`, `config.js` |
| 7 · Accounts (2 wk) | Hashing, cookies, sessions, 401 vs 403 | Add sign-up/login so each user sees only their notes | `security.js`, `users.js` |
| 8 · Full stack (4+ wk) | Everything together, SPA routing | Your own project — e.g. a booking system, a school portal, a small shop | the whole repo, doc 01 |
| 9 · Grow up (ongoing) | Express, React, PostgreSQL, Docker, deployment, testing | Port one of your projects using doc 05 as a guide | `05-roadmap.md` |

Free, high-quality places to learn: **MDN Web Docs** (developer.mozilla.org)
for HTML/CSS/JS, **javascript.info** for JavaScript in depth, the official
**Node.js docs** (nodejs.org/docs), **SQLBolt** (sqlbolt.com) for interactive
SQL, and **The Odin Project** or **freeCodeCamp** for a full guided course.

---

## 6. Starter recipe for a new project

Copy this structure — it's Meri Gebeya stripped to the bones.

```
my-project/
├── package.json          "type": "module", scripts: start / dev / seed / check
├── .gitignore            data/  .env  node_modules/  *.log
├── .env.example          PORT=4000  NODE_ENV=development  SECRET=change-me
├── README.md             what it is + how to run it in 3 commands
├── db/
│   └── schema.sql        CREATE TABLE IF NOT EXISTS …
├── server/src/
│   ├── config.js         settings + database connection + all/get/run/tx
│   ├── http.js           HttpError, Router, buildContext, sendJson, serveStatic
│   ├── security.js       hashPassword, verifyPassword, tokens, cookies
│   ├── <area>.js         one file per business area — the only place with SQL
│   ├── api.js            routes: thin wrappers calling the area files
│   ├── seed.js           demo data
│   └── server.js         wires it all together and listens
└── public/
    ├── index.html        page shell with <main id="view">
    └── assets/
        ├── core.js       api client, router, esc, formatting
        ├── app.js        one function per page + the routes table
        └── styles.css    :root tokens first, then components
```

Fastest start: **copy `config.js`, `http.js`, `security.js`, `server.js` and
`core.js` from Meri Gebeya** — they're generic and contain no shop logic —
then write your own `schema.sql`, area files, `api.js` and pages.

Then follow the 15-step order in [06-how-it-was-built.md](06-how-it-was-built.md).

---

## 7. Mistakes everyone makes (and the fix)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Edited the code, nothing changed | Browser cache, or server not restarted | Ctrl+Shift+R; use `npm run dev` |
| `Cannot use import statement outside a module` | Missing `"type": "module"` | Add it to `package.json` |
| `EADDRINUSE: address already in use` | Old server still running | Section 4.8 |
| `Failed to fetch` in the console | Server isn't running, or wrong URL | Check the terminal; open `/api/health` |
| API returns 401 in the browser but works in curl | Cookie not sent | `credentials: "same-origin"` in `fetch` |
| Totals off by 0.01 | Money stored as decimals | Store integer cents |
| Two people bought the last item | Stock not re-checked inside a transaction | `tx()` + re-check (see `orders.js`) |
| `FOREIGN KEY constraint failed` | Inserting a child before its parent, or deleting a parent | Insert parents first; use `ON DELETE` rules |
| A user's name breaks the page layout | Text inserted without escaping | Always `esc()` user text |
| `undefined` shown on the page | Guessed a field name | `console.log` the real API response first |
| "Works on my machine" only | Settings hard-coded | Use `process.env` + `.env` |
| Lost a day's work | No commits | `git commit` every time something works |

The one habit that prevents most of these: **when something is wrong, look
at the real data before changing code** — the Network tab, `console.log`,
`npm run sql`, or `curl -i`. Guessing is slower than looking.
