/* =============================================================================
   Meri Gebeya (መሪ ገበያ) — schema for SQLite (node:sqlite / better-sqlite3 compatible)
   Money is always INTEGER cents. Dates are ISO-8601 UTC strings.
   Applied automatically at boot by server/db.js (idempotent).
   ============================================================================= */

PRAGMA foreign_keys = ON;

-- 1. Identity ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  lang          TEXT    NOT NULL DEFAULT 'en'       CHECK (lang IN ('en','am')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS addresses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT    NOT NULL DEFAULT 'Home',
  recipient   TEXT    NOT NULL,
  phone       TEXT    NOT NULL,
  region      TEXT    NOT NULL,
  city        TEXT    NOT NULL,
  subcity     TEXT,
  woreda      TEXT,
  landmark    TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_addresses_user ON addresses(user_id);

-- 2. Catalog ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name      TEXT    NOT NULL,
  name_am   TEXT,
  slug      TEXT    NOT NULL UNIQUE,
  blurb     TEXT,
  icon      TEXT,
  sort      INTEGER NOT NULL DEFAULT 0,
  active    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_categories_sort ON categories(sort);

CREATE TABLE IF NOT EXISTS products (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT    NOT NULL UNIQUE,
  name                  TEXT    NOT NULL,
  name_am               TEXT,
  description           TEXT    NOT NULL DEFAULT '',
  description_am        TEXT,
  category_id           INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  brand                 TEXT,
  sku                   TEXT    NOT NULL UNIQUE,
  unit                  TEXT    NOT NULL DEFAULT 'piece',
  price_cents           INTEGER NOT NULL CHECK (price_cents >= 0),
  compare_at_price_cents INTEGER CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents >= 0),
  currency              TEXT    NOT NULL DEFAULT 'ETB',
  stock                 INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_at          INTEGER NOT NULL DEFAULT 5,
  weight_grams          INTEGER,
  status                TEXT    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('draft','active','archived')),
  featured              INTEGER NOT NULL DEFAULT 0,
  rating_avg            REAL    NOT NULL DEFAULT 0,
  rating_count          INTEGER NOT NULL DEFAULT 0,
  view_count            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_products_category ON products(category_id, status);
CREATE INDEX IF NOT EXISTS ix_products_status   ON products(status, featured, price_cents);
CREATE INDEX IF NOT EXISTS ix_products_name     ON products(name, name_am);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT    NOT NULL,
  alt        TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_images_product ON product_images(product_id, sort);

-- 3. Cart & promotions ------------------------------------------------------

CREATE TABLE IF NOT EXISTS carts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL UNIQUE,      -- guest cart key held in a cookie
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted')),
  coupon_code TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_carts_user ON carts(user_id, status);

CREATE TABLE IF NOT EXISTS cart_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id          INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL,        -- snapshot: price changes never mutate a live cart silently
  added_at         TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_item ON cart_items(cart_id, product_id);

CREATE TABLE IF NOT EXISTS coupons (
  code              TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value             INTEGER NOT NULL,       -- percent: 1-100 · fixed: cents off
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  max_discount_cents INTEGER,
  starts_at         TEXT,
  expires_at        TEXT,
  usage_limit       INTEGER,
  used_count        INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  note              TEXT
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  name_am        TEXT,
  fee_cents      INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  free_over_cents INTEGER,                  -- free delivery above this subtotal
  eta_hours      INTEGER NOT NULL DEFAULT 48,
  active         INTEGER NOT NULL DEFAULT 1
);

-- 4. Orders -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  number          TEXT    NOT NULL UNIQUE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cart_id         INTEGER REFERENCES carts(id) ON DELETE SET NULL,
  email           TEXT    NOT NULL,
  phone           TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','packing','shipped',
                                      'delivered','cancelled','refunded')),
  payment_method  TEXT    NOT NULL
                    CHECK (payment_method IN ('cod','telebirr','cbe_birr','bank','card')),
  payment_status  TEXT    NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','authorized','paid','failed','refunded')),
  subtotal_cents  INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  delivery_cents  INTEGER NOT NULL DEFAULT 0 CHECK (delivery_cents >= 0),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  currency        TEXT    NOT NULL DEFAULT 'ETB',
  coupon_code     TEXT,
  zone_id         INTEGER REFERENCES delivery_zones(id) ON DELETE SET NULL,
  ship_name       TEXT    NOT NULL,
  ship_phone      TEXT    NOT NULL,
  ship_region     TEXT    NOT NULL,
  ship_city       TEXT    NOT NULL,
  ship_subcity    TEXT,
  ship_woreda     TEXT,
  ship_landmark   TEXT,
  instructions    TEXT,
  cancelled_reason TEXT,
  placed_at       TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  delivered_at    TEXT
);
CREATE INDEX IF NOT EXISTS ix_orders_user   ON orders(user_id, placed_at);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status, placed_at);

CREATE TABLE IF NOT EXISTS order_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name_snapshot  TEXT    NOT NULL,
  name_am_snapshot TEXT,
  sku_snapshot   TEXT    NOT NULL,
  image_url      TEXT,
  unit_price_cents INTEGER NOT NULL,
  qty            INTEGER NOT NULL CHECK (qty > 0),
  line_total_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_order_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_order_items_product ON order_items(product_id);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider     TEXT    NOT NULL,
  reference    TEXT    NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'created'
                 CHECK (status IN ('created','authorized','captured','failed','refunded')),
  meta         TEXT,
  created_at   TEXT    NOT NULL,
  confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  reason        TEXT    NOT NULL CHECK (reason IN ('sale','restock','return','adjust','cancel','import')),
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_movements_product ON inventory_movements(product_id, created_at);

-- 5. Social proof & insight -------------------------------------------------

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title      TEXT,
  body       TEXT,
  status     TEXT    NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected')),
  created_at TEXT    NOT NULL,
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_reviews_product ON reviews(product_id, status);

CREATE TABLE IF NOT EXISTS wishitems (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL,
  product_id INTEGER,
  user_id    INTEGER,
  payload    TEXT,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_type ON events(type, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
