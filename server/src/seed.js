/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, get, run, tx, migrate, config, nowIso, setSetting, db } from "./config.js";
import { hashPassword } from "./security.js";
import { slugify } from "./http.js";
import { recomputeRating } from "./users.js";
import { evaluateCoupon } from "./cart.js";

/* ------------------------------------------------------------------ *
 * Demo data for Meri Gebeya. Idempotent: running it twice on a fresh
 * database gives the same shop; use `npm run reset` to wipe and rebuild.
 *   npm run seed     -> adds data if the shop is empty
 *   npm run reset    -> drops every table, then seeds
 * ------------------------------------------------------------------ */

const FRESH = process.argv.includes("--fresh");
const ISOT = (daysAgo, hour = 10) =>
  new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 11) + String(hour).padStart(2, "0") + ":00:00.000Z";

const TABLES = ["events", "wishitems", "reviews", "inventory_movements", "payments", "order_items",
  "orders", "cart_items", "carts", "delivery_zones", "coupons", "product_images", "products",
  "categories", "addresses", "sessions", "users", "settings"];

if (FRESH) {
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const t of TABLES) run(`DROP TABLE IF EXISTS ${t}`);
  db.exec("PRAGMA foreign_keys = ON;");
  console.log("dropped every table");
}
migrate();

if (!FRESH && get(`SELECT COUNT(*) AS n FROM products`)?.n > 0) {
  console.log("Database already has products — nothing to do. Use `npm run reset` to rebuild it.");
  process.exit(0);
}

/* Images: hand-built SVG tiles so the demo needs no network or binary assets. */
const IMG_DIR = join(config.publicDir, "img");
mkdirSync(IMG_DIR, { recursive: true });

const PALETTE = {
  coffee:   ["#3b2417", "#8a5a2b", "☕"],
  spices:   ["#5c1f12", "#c2571f", "🌶️"],
  grains:   ["#4a3b17", "#b39237", "🌾"],
  pantry:   ["#123a2e", "#2f8f6b", "🫙"],
  home:     ["#16294d", "#3b6fc4", "🧼"],
  beauty:   ["#4a1740", "#b0509e", "🧴"],
  fashion:  ["#3d1f3a", "#a25fa6", "👗"],
  tech:     ["#0f2233", "#2c7fa8", "🔌"],
  school:   ["#123243", "#3991a8", "📚"],
  fresh:    ["#1c3d1c", "#4e9b3c", "🥬"],
};

function makeImage(slug, categoryKey, name, emoji) {
  const [dark, light, glyph] = PALETTE[categoryKey] || ["#1b1b2a", "#5a5a88", "🛍️"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" role="img" aria-label="${esc(name)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <radialGradient id="v" cx="50%" cy="42%" r="72%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.28"/>
    </radialGradient>
  </defs>
  <rect width="600" height="450" fill="url(#g)"/>
  <rect width="600" height="450" fill="url(#v)"/>
  <circle cx="300" cy="196" r="112" fill="#ffffff" opacity="0.12"/>
  <text x="300" y="238" font-size="120" text-anchor="middle">${emoji || glyph}</text>
  <text x="300" y="356" font-size="30" font-family="system-ui,Segoe UI,Noto Sans Ethiopic,sans-serif"
        font-weight="700" fill="#fff" text-anchor="middle">${esc(short(name))}</text>
  <text x="300" y="392" font-size="17" font-family="system-ui,sans-serif" fill="#ffffff"
        opacity="0.75" text-anchor="middle" letter-spacing="3">MERI GEBEYA</text>
</svg>`;
  writeFileSync(join(IMG_DIR, `${slug}.svg`), svg, "utf8");
  return `/img/${slug}.svg`;
}
const short = (s) => (s.length > 26 ? s.slice(0, 25) + "…" : s);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Categories --------------------------------------------------------------- */

const CATEGORIES = [
  ["coffee",  "Coffee & Tea",   "ቡናና ሻይ",        "Yirgacheffe to Harar, roasted weekly.",          "☕"],
  ["spices",  "Spices & Herbs", "ትዝና አበሻሾች",     "Berbere, shiro and mitmita from local women's unions.", "🌶️"],
  ["grains",  "Grains & Flours","ዕህልና ዱቄት",      "Teff, wheat and rice, milled on order.",         "🌾"],
  ["pantry",  "Pantry & Dairy", "የቤት እቃና ወተት",   "Oil, honey, milk and yogurt, cold-chain kept.",  "🫙"],
  ["fresh",   "Fruits & Greens","ፍራፍራና አረም",    "Picked at Atkilt Tera the morning you order.",   "🥬"],
  ["home",    "Home & Cleaning","የቤት ጽዳት",       "Detergent, soap and kitchenware.",               "🧼"],
  ["beauty",  "Beauty & Care",  "ውበትና እንክብካቤ",  "Shea, hair care and skin care.",                 "🧴"],
  ["fashion", "Clothing",       "ልብስ",            "Habesha kemis, netela and everyday wear.",       "👗"],
  ["tech",    "Electronics",    "ኤሌክትሮኒክስ",      "Small kitchen appliances and gadgets.",          "🔌"],
  ["school",  "Books & School", "መጽሐፍና ትምህርት", "Notebooks, dictionaries and pens.",              "📚"],
];

const catId = {};
for (const [key, name, name_am, blurb, icon] of CATEGORIES) {
  const slug = slugify(name);
  run(`INSERT INTO categories (parent_id, name, name_am, slug, blurb, icon, sort, active)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, 1)`, name, name_am, slug, blurb, icon, Object.keys(catId).length);
  catId[key] = Number(get(`SELECT id FROM categories WHERE slug = ?`, slug).id);
}

/* Products ---------------------------------------------------------------- */
/* [key, name, name_am, cat, brand, priceETB, wasETB|null, stock, unit, emoji, desc, desc_am, featured] */

const PRODUCTS = [
  ["yirg-cheleki", "Yirgacheffe Cheleki Coffee Beans 500g", "የኢርጋጨፌ ቺሌቂ ቡና 500 ግራም", "coffee", "Tomosa", 340, 390, 120, "pack", "☕",
    "Washed Heirloom beans from 1,900 masl. Floral, bergamot and stone-fruit notes. Roasted to order for filter or espresso.",
    "ከ1,900 ሜትር በላይ የሰፈነ፣ የታጠበ ቡና። ለፊልተርና ለኤስፕሬሶ በሚስማማ መልኩ ተቆላ።", 1],
  ["sidamo-natural", "Sidamo Natural Coffee Beans 1kg", "የሲዳማ ቡና 1 ኪሎ ግራም", "coffee", "Sidama Farmers", 520, null, 60, "bag", "☕",
    "Sun-dried whole beans, wine-like body with cocoa finish. Bulk pack for the whole month.",
    "በፀሐይ የተነበረ ጠንካራ ቡና፤ የወይን ጣዕምና ኮኮዋ።", 1],
  ["harar-longberry", "Harar Longberry Beans 500g", "የሐረር ሎንግቤሪ ቡና", "coffee", "Harar Co-op", 400, 460, 45, "pack", "☕",
    "Wild-grown, moka-forward beans from eastern Ethiopia. The classic jebena roast.",
    "ከምዕራብ ኢትዮጵያ የተሰባሰበ፣ ለጀበና ቡና ተስማሚ።", 0],
  ["tea-leaf-congo", "Congo Tea Leaves 250g", "ኮንጎ ሻይ 250 ግራም", "coffee", "Congo", 120, null, 200, "pack", "🍵",
    "Bold black leaf tea for the everyday Ethiopian macchiato and shai.",
    "ለዕለት ተዕለት ሻይና ማኪያቶ የሚሆን ጠንካራ ሻይ።", 0],
  ["berbere-kg", "Fine Berbere 1kg", "በርበሬ 1 ኪሎ", "spices", "Yeabesha", 380, 420, 90, "kg", "🌶️",
    "Sun-dried chilli blended with rue, basil, corander and nine spices. Medium-hot, no additives.",
    "ከአሥር ዓይነት ቅመማ ቅመሞች የተዘጋጀ ጥሩ ትዝ።", 1],
  ["shiro-milled", "Shiro Milled Pea Flour 500g", "ሽሮ 500 ግራም", "spices", "Merona", 150, null, 150, "pack", "🥣",
    "Roasted chickpea and faba-bean flour with kolo spice — shiro in ten minutes.",
    "የተጠበሰ አገልና ክክ ሽንት፣ በ10 ደቂቃ ሽሮ ያብሱ።", 0],
  ["mitmita", "Mitmita Hot Blend 250g", "ሚጥሚጣ 250 ግራም", "spices", "Yeabesha", 130, null, 80, "pack", "🌶️",
    "Bird's-eye chilli with timiz and cardamom. For kitfo and ayib.",
    "ለክትፎና ለገበታ የሚሆን ሚጥሚጣ።", 0],
  ["niter-kibbeh", "Niter Kibbeh Spiced Butter 400g", "ንጥር ቅባት 400 ግራም", "spices", "Tsehai", 420, 470, 40, "jar", "🧈",
    "Slow-simmered clarified butter infused with ginger, fenugreek and rue.",
    "የዘሎ ገናና ቅባት ከአዝሞገስና ሠላጭ ጋር።", 0],
  ["white-teff-kg", "White Teff Grain 1kg", "ነጭ ጤፍ 1 ኪሎ", "grains", "Qocho", 190, 215, 220, "kg", "🌾",
    "Highland white teff, cleaned and graded for injera. Iron-rich and gluten-free.",
    "ለእንጀራ የሚሆን ንጹህ ነጭ ጤፍ፤ ግሉተን የሌለው።", 1],
  ["red-teff-kg", "Red Teff Grain 1kg", "ቀይ ጤፍ 1 ኪሎ", "grains", "Qocho", 165, null, 140, "kg", "🌾",
    "Nutty red teff for porridge, kolo and baking blends.",
    "ለጥጥብና ለቆሎ የሚሆን ቀይ ጤፍ።", 0],
  ["wheat-flour", "Bread Flour Premium 5kg", "የዱቄት 5 ኪሎ", "grains", "Alema", 320, null, 70, "bag", "🥖",
    "Milled to 12% protein for dabo, bread and pastry.",
    "ለዳቦና ለዳሪ ዘር የሚሆን ዱቄት።", 0],
  ["rice-kg", "Aghams Rice 5kg", "አጋምስ ላውዝ 5 ኪሎ", "grains", "Midi", 780, 850, 55, "bag", "🍚",
    "Long-grain lowland rice from the Metehara scheme. Fluffy, non-sticky.",
    "ረጅም ፍርፍር የላውዝ እህል።", 0],
  ["sesame-oil", "Sesame Oil 500ml", "ዘይት አጕድ 500 ሚሊ", "pantry", "Guzo", 260, null, 100, "bottle", "🫗",
    "Cold-pressed Hum sesame oil for cooking and for finishing tibs.",
    "ለአሽክና ለትርጉም የሚሆን የአጕድ ዘይት።", 0],
  ["honey-hmf", "Honey From Hum Zone 850g", "ሀምር ማር 850 ግራም", "pantry", "Beeke", 540, 600, 60, "jar", "🍯",
    "Raw, unfiltered forest honey with white tea. Every jar is traceable to its cooperative.",
    "ንጹህና ያልተጣራ የጫካ ማር።", 1],
  ["milk-1l", "Fresh Milk 1 Litre", "ጠጥብ 1 ሊትር", "pantry", "Giorgis", 92, null, 300, "litre", "🥛",
    "Pasteurised full-cream milk, cold-chain delivered before 8am.",
    "አዲስ የተጣበረ ጠጥብ።", 0],
  ["yogurt-ergo", "Ergo Fermented Milk 500ml", "እርጎ 500 ሚሊ", "pantry", "Dera", 110, null, 120, "cup", "🥛",
    "Traditional thickened sour milk, lightly salted.",
    "ወገብ የሆነ እርጎ።", 0],
  ["avocado-kg", "Ripe Avocado (Biro) 1kg", "አቮካዶ 1 ኪሎ", "fresh", "Atkilt", 130, 160, 90, "kg", "🥑",
    "Four to five medium Bioiro avocados, ripened for today's avocado-banana shake.",
    "ለአቮካዶ-ባናና ሼክ የሚሆኑ የበሰሉ ፍራፍራ።", 0],
  ["banana-bunch", "Sweet Banana Bunch 3kg", "ማቱላ 3 ኪሎ", "fresh", "Atkilt", 175, null, 80, "bunch", "🍌",
    "Hand-picked mid-ripeness so they last the week.",
    "ለሳምንት የሚቆይ ማቱላ።", 0],
  ["tomato-kg", "Peeled Tomato 1kg", "ለንዳ 1 ኪሎ", "fresh", "Atkilt", 85, null, 150, "kg", "🍅",
    "Roma type for wot — low water, deep colour.",
    "ለወጥ የሚሆን ለንዳ።", 0],
  ["detergent-powder", "Washing Powder 3kg", "የአጠባቢ ፓውደር 3 ኪሎ", "home", "Fantaseya", 340, 380, 95, "box", "🧺",
    "High-foam formula for hand wash and machines, eucalyptus scent.",
    "ለእጅና ለማሽን የሚሆን ፓውደር።", 0],
  ["dettol-liquid", "Antiseptic Liquid 1L", "አንቲሴፕቲክ 1 ሊትር", "home", "Savon", 260, null, 120, "bottle", "🧴",
    "Multi-purpose disinfectant for laundry, floors and first aid.",
    "ለቤት ጽዳትና ለሌላም የሚጠቅም።", 0],
  ["clay-jebena", "Handmade Clay Jebena", "ሐዳ ጀበና", "home", "Shewa Crafts", 480, 560, 35, "piece", "🏺",
    "Wood-fired pot from Shashemene potters, seasoned and ready for the first roast.",
    "ከሻሸመኔ ሙያተኞች የተሰራ የሸክላ ጀበና።", 1],
  ["non-stick-pan", "Non-stick Frying Pan 28cm", "ማጣጫ 28 ሴሜ", "home", "Tigray Home", 1250, null, 30, "piece", "🍳",
    "Three-layer coating, induction friendly, bakelite handle.",
    "ለሁሉም መበኛ የሚሆን ማጣጫ።", 0],
  ["shea-butter", "Pure Shea Butter 300g", "ካራቴ 300 ግራም", "beauty", "Daka", 220, 250, 110, "jar", "🧴",
    "Unrefined West-Ghana shea for skin and hair. No perfume, no parabens.",
    "ንጹህ ካራቴ ለፀሐይና ለሾና።", 0],
  ["hair-oil", "Castor & Rosemary Hair Oil 200ml", "የጸጉር ዘይት 200 ሚሊ", "beauty", "Zema", 290, null, 70, "bottle", "💆",
    "Cold-pressed castor base with rosemary and black seed.",
    "ከምርና ረዘንጭ ጋር የተዘጋጀ።", 0],
  ["habesha-kemis", "Habesha Kemis — Hand-woven", "የሀበሻ ጀብና", "fashion", "Yemeshekan", 4200, 4900, 18, "piece", "👗",
    "Cotton shemma woven in Aksum with gold-thread tibeb. Made to measure in three sizes.",
    "በአክሱም የተሰራ ባህላዊ ገብና።", 1],
  ["netela-shawl", "Netela Shawl with Tibeb", "ነጠላ", "fashion", "Yemeshekan", 1600, null, 40, "piece", "🧣",
    "Light cotton wrap for church, coffee ceremony and holidays.",
    "ቀላልና ውብ ነጠላ።", 0],
  ["leather-loafers", "Leather Loafers — Handmade", "ቆዳ ጫማ", "fashion", "Sabahar", 1850, 2100, 26, "pair", "👞",
    "Full-grain Ethiopian leather, stitched sole, sizes 39-45.",
    "ከኢትዮጵያ ቆዳ የተሰራ ጫማ።", 0],
  ["electric-kettle", "Electric Kettle 1.7L", "ኤሌክትሪክ ኢላማ ማፍያ", "tech", "Pulse", 1450, 1700, 45, "piece", "🫖",
    "Stainless body, boil-dry protection, 220V. Tea in ninety seconds.",
    "ብረት የሆነ፣ ውሃ ሲያልቅ የሚጠፋ።", 0],
  ["blender-1-5l", "Countertop Blender 1.5L", "ብሌንደር 1.5 ሊትር", "tech", "Pulse", 3200, null, 22, "piece", "🥤",
    "Four-speed with pulse for spris, avocado shake and sauces.",
    "ለስፕሪስና ለአቮካዶ ሼክ።", 0],
  ["power-bank", "20,000mAh Power Bank", "ፓወር ባንክ", "tech", "Nahom", 1750, 1990, 60, "piece", "🔋",
    "Dual USB-A + USB-C PD, 22.5W. Two days of phone backup for the blackout.",
    "ሁለት USB እና USB-C አለው።", 0],
  ["wirebuds", "Wireless Earbuds Pro", "ጆሮ ማዳመጫ", "tech", "Nahom", 2100, null, 48, "piece", "🎧",
    "ANC, 28-hour case battery, IPX5. Amharic voice prompts built in.",
    "ድምፅ የሚቀንስ፣ ለ28 ሰዓት የሚያገለግል።", 0],
  ["notebook-a4", "A4 Ruled Notebook 200 pages", "ኤ4 ደብተር", "school", "Vivid", 130, null, 400, "piece", "📓",
    "90gsm paper, lay-flat binding, 200 pages.",
    "200 ገፅ ያለው ደብተር።", 0],
  ["amharic-dictionary", "Etymological Dictionary of Amharic", "የአማርኛ መዝገበ ቃላት", "school", "Berhann", 950, null, 25, "piece", "📖",
    "The standard 1,000-page reference for students and editors.",
    "ለተማሪዎችና ለአዘጋጆች የሚሆን መዝገበ ቃላት።", 0],
  ["gel-pen-set", "Gel Pen Set (12 colours)", "የፑኒ ፒኔ ስብስብ", "school", "Vivid", 210, 240, 160, "set", "🖊️",
    "0.5mm quick-dry nibs, smudge-free for lefties.",
    "12 ቀለም ያላቸው ፒኔዎች።", 0],
];

const ids = {};
for (const [key, name, name_am, cat, brand, price, was, stock, unit, emoji, desc, desc_am, featured] of PRODUCTS) {
  const slug = key;
  const now = nowIso();
  const r = run(`INSERT INTO products (slug, name, name_am, description, description_am, category_id, brand, sku,
                unit, price_cents, compare_at_price_cents, currency, stock, low_stock_at, weight_grams,
                status, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ETB', ?, ?, ?, 'active', ?, ?, ?)`,
    slug, name, name_am, desc, desc_am, catId[cat], brand,
    `MG-${String(cat).slice(0, 3).toUpperCase()}-${slug.slice(0, 6).toUpperCase()}`,
    unit, Math.round(price * 100), was ? Math.round(was * 100) : null, stock,
    cat === "fresh" ? 20 : 8, 500, featured, ISOT(30), now);
  ids[key] = Number(r.lastInsertRowid);
  const url = makeImage(slug, cat, name, emoji);
  run(`INSERT INTO product_images (product_id, url, alt, sort) VALUES (?, ?, ?, 0)`, ids[key], url, name);
}
console.log(`catalog: ${PRODUCTS.length} products, ${CATEGORIES.length} categories`);

/* Zones ------------------------------------------------------------------- */
/* name, Amharic, region, fee (ETB), free above (ETB), ETA hours */

const ZONES = [
  ["Addis Ababa", "አዲስ አበባ", "Addis Ababa", 70, 1200, 4],
  ["Adama", "አዳማ", "Oromia", 120, 2000, 12],
  ["Bishoftu", "ቢሾፍቱ", "Oromia", 130, 2000, 12],
  ["Hawassa", "ሀዋሳ", "Sidama", 200, 3000, 24],
  ["Bahir Dar", "ባህር ዳር", "Amhara", 250, 3500, 36],
  ["Gondar", "ጎንደር", "Amhara", 280, 4000, 48],
  ["Dire Dawa", "ድሬ ዳዋ", "Dire Dawa", 260, 4000, 48],
  ["Mekelle", "መቄሌ", "Tigray", 300, 4500, 48],
];
const zoneId = {};
for (const [name, name_am, region, fee, freeOver, eta] of ZONES) {
  const r = run(`INSERT INTO delivery_zones (name, name_am, fee_cents, free_over_cents, eta_hours, active)
                 VALUES (?, ?, ?, ?, ?, 1)`, name, name_am, fee * 100, freeOver * 100, eta);
  zoneId[name] = Number(r.lastInsertRowid);
}

/* Coupons ----------------------------------------------------------------- */

const COUPONS = [
  { code: "MERI10",   kind: "percent", value: 10,  min: 500,  max: 300,  limit: null, note: "Launch discount — 10% off, capped at 300 ETB" },
  { code: "FIRST50",  kind: "fixed",   value: 50,  min: 800,  max: null, limit: 500,  note: "50 ETB off a first basket over 800 ETB" },
  { code: "COFFEE15", kind: "percent", value: 15,  min: 700,  max: 400,  limit: 40,   note: "Weekend coffee sale — 15% off" },
  { code: "FREESHIP", kind: "fixed",   value: 70,  min: 1200, max: null, limit: null, note: "Covers the Addis Ababa delivery fee" },
];
for (const c of COUPONS) {
  run(`INSERT INTO coupons (code, kind, value, min_subtotal_cents, max_discount_cents, starts_at, expires_at,
                            usage_limit, used_count, active, note)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 0, 1, ?)`,
    c.code, c.kind,
    c.kind === "percent" ? c.value : c.value * 100,
    (c.min || 0) * 100,
    c.max ? c.max * 100 : null,
    c.limit, c.note);
}
console.log(`coupons: ${COUPONS.length}`);

/* People ------------------------------------------------------------------ */

const now = nowIso();
const users = [];
function addUser({ name, email, phone, password, role = "customer", lang = "en", created = ISOT(120) }) {
  const r = run(`INSERT INTO users (name, email, phone, password_hash, role, lang, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    name, email, phone, hashPassword(password), role, lang, created, now);
  const id = Number(r.lastInsertRowid);
  users.push({ id, name, email, role });
  return id;
}

const adminId = addUser({ name: "Meri Gebeya Admin", email: "admin@merigebeya.et", phone: "+251911223344",
  password: "Admin12345", role: "admin" });
const saraId = addUser({ name: "Sara Bekele", email: "sara@example.et", phone: "+251912334455", password: "Password123", lang: "am", created: ISOT(90) });
const liyaId = addUser({ name: "Liya Tadesse", email: "liya@example.et", phone: "+251923445566", password: "Password123", created: ISOT(60) });
const danielId = addUser({ name: "Daniel Girma", email: "daniel@example.et", phone: "+251934556677", password: "Password123", created: ISOT(45) });
const hannaId = addUser({ name: "Hanna Alemu", email: "hanna@example.et", phone: "+251945667788", password: "Password123", lang: "am", created: ISOT(28) });
const yonasId = addUser({ name: "Yonas Kassa", email: "yonas@example.et", phone: "+251956778899", password: "Password123", created: ISOT(14) });

run(`INSERT INTO addresses (user_id, label, recipient, phone, region, city, subcity, woreda, landmark, is_default, created_at)
     VALUES (?, 'Home', 'Sara Bekele', '+251912334455', 'Addis Ababa', 'Addis Ababa', 'Bole', 'Woreda 08',
             'Behind Edna Mall, Bole Medhanealem', 1, ?)`, saraId, ISOT(88));
run(`INSERT INTO addresses (user_id, label, recipient, phone, region, city, subcity, woreda, landmark, is_default, created_at)
     VALUES (?, 'Office', 'Liya Tadesse', '+251923445566', 'Addis Ababa', 'Addis Ababa', 'Kirkos', 'Woreda 03',
             'Sunshine Building, 4th floor', 1, ?)`, liyaId, ISOT(58));

/* Orders (history) -------------------------------------------------------- */

const HIST = [
  // [user, zone, daysAgo, status, payment, payment_status, [[productKey, qty], …], coupon|null]
  [saraId, "Addis Ababa", 18, "delivered", "telebirr", "paid", [["yirg-cheleki", 2], ["white-teff-kg", 3], ["berbere-kg", 1]], "MERI10"],
  [liyaId, "Addis Ababa", 15, "delivered", "cod", "unpaid", [["shiro-milled", 4], ["niter-kibbeh", 1], ["honey-hmf", 1]], null],
  [danielId, "Adama", 12, "delivered", "cbe_birr", "paid", [["electric-kettle", 1], ["tea-leaf-congo", 3], ["gel-pen-set", 2]], "FIRST50"],
  [hannaId, "Addis Ababa", 9, "delivered", "telebirr", "paid", [["habesha-kemis", 1], ["netela-shawl", 2]], "MERI10"],
  [yonasId, "Bahir Dar", 7, "shipped", "card", "paid", [["power-bank", 1], ["wirebuds", 1], ["notebook-a4", 5]], null],
  [saraId, "Addis Ababa", 6, "delivered", "telebirr", "paid", [["avocado-kg", 3], ["banana-bunch", 2], ["milk-1l", 6]], null],
  [liyaId, "Addis Ababa", 5, "packing", "cod", "unpaid", [["clay-jebena", 1], ["sidamo-natural", 1], ["mitmita", 2]], "COFFEE15"],
  [danielId, "Hawassa", 4, "confirmed", "bank", "paid", [["rice-kg", 2], ["sesame-oil", 2], ["detergent-powder", 1]], null],
  [hannaId, "Addis Ababa", 3, "pending", "telebirr", "authorized", [["non-stick-pan", 1], ["shea-butter", 2]], null],
  [yonasId, "Addis Ababa", 2, "delivered", "cod", "unpaid", [["white-teff-kg", 5], ["berbere-kg", 2], ["shiro-milled", 3], ["red-teff-kg", 2]], "MERI10"],
  [saraId, "Addis Ababa", 1, "shipped", "card", "paid", [["blender-1-5l", 1], ["banana-bunch", 1], ["tomato-kg", 4]], null],
  [liyaId, "Bishoftu", 1, "cancelled", "telebirr", "failed", [["harar-longberry", 1]], null],
];

let orderSeq = 1000;
for (const [userId, zoneName, daysAgo, status, method, payStatus, lines, coupon] of HIST) {
  const placedAt = ISOT(daysAgo, 9 + (daysAgo % 9));
  const deliveredAt = status === "delivered" ? ISOT(Math.max(0, daysAgo - 2)) : null;
  const u = get(`SELECT name, email, phone FROM users WHERE id = ?`, userId);
  const zone = get(`SELECT * FROM delivery_zones WHERE id = ?`, zoneId[zoneName]);
  const region = ZONES.find((z) => z[0] === zoneName)[2];

  const items = lines.map(([key, qty]) => {
    const p = get(`SELECT id, slug, name, name_am, sku, price_cents FROM products WHERE id = ?`, ids[key]);
    return { p, qty, total: p.price_cents * qty };
  });
  const subtotal = items.reduce((n, i) => n + i.total, 0);
  const discount = evaluateCoupon(coupon, subtotal).discount;
  const free = zone.free_over_cents !== null && (subtotal - discount) >= zone.free_over_cents;
  const delivery = free ? 0 : zone.fee_cents;
  const total = subtotal - discount + delivery;
  const number = `MG-${placedAt.slice(0, 10).replace(/-/g, "")}-${String(orderSeq++).padStart(4, "0")}`;
  const updatedAt = ["delivered", "cancelled"].includes(status) ? (deliveredAt || placedAt) : placedAt;

  tx(() => {
    const o = run(`INSERT INTO orders (number, user_id, cart_id, email, phone, status, payment_method, payment_status,
              subtotal_cents, discount_cents, delivery_cents, total_cents, currency, coupon_code, zone_id,
              ship_name, ship_phone, ship_region, ship_city, ship_subcity, ship_woreda, ship_landmark,
              instructions, placed_at, updated_at, delivered_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ETB', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      number, userId, u.email, u.phone, status, method, payStatus,
      subtotal, discount, delivery, total, coupon, zone.id,
      u.name, u.phone, region, zone.name, "Bole", "Woreda 08",
      placedAt, updatedAt, deliveredAt);
    const orderId = Number(o.lastInsertRowid);

    for (const it of items) {
      run(`INSERT INTO order_items (order_id, product_id, name_snapshot, name_am_snapshot, sku_snapshot, image_url,
                                    unit_price_cents, qty, line_total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId, it.p.id, it.p.name, it.p.name_am, it.p.sku, `/img/${it.p.slug}.svg`,
        it.p.price_cents, it.qty, it.total);

      const returned = status === "cancelled";
      if (!returned) run(`UPDATE products SET stock = stock - ? WHERE id = ?`, it.qty, it.p.id);
      run(`INSERT INTO inventory_movements (product_id, delta, reason, order_id, actor_user_id, note, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        it.p.id, returned ? 0 : -it.qty, returned ? "cancel" : "sale", orderId, `${number} · seeded history`, placedAt);
    }

    run(`INSERT INTO payments (order_id, provider, reference, amount_cents, status, meta, created_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      orderId, method, `PAY-${method.toUpperCase()}-${String(orderId).padStart(4, "0")}`, total,
      payStatus === "paid" ? "captured" : payStatus === "authorized" ? "authorized"
        : payStatus === "failed" ? "failed" : "created",
      JSON.stringify({ seeded: true }), placedAt, payStatus === "paid" ? placedAt : null);

    if (coupon && status !== "cancelled") run(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ?`, coupon);
  });
}
console.log(`orders: ${HIST.length} placed`);

/* Reviews ---------------------------------------------------------------- */

const REVIEWS = [
  [saraId, "yirg-cheleki", 5, "Best roast I've ordered online", "Arrived two days after roasting. The jebena foam was perfect. Will repeat."],
  [liyaId, "white-teff-kg", 5, "Clean teff, no stones", "Milled it into fine flour and the injera came out with big eyes. Good price too."],
  [danielId, "electric-kettle", 4, "Fast boil, lid is stiff", "Boils in about a minute and a half. The lid takes two hands at first."],
  [hannaId, "habesha-kemis", 5, "Wore it for Timket", "The tibeb is exactly the pattern I sent. Measurements were spot on."],
  [yonasId, "power-bank", 4, "Survived the blackout", "Charged my phone five times. USB-C output is genuinely fast."],
  [saraId, "honey-hmf", 5, "Real forest honey", "Crystallised in the fridge like proper honey should. Tasted of thyme."],
  [liyaId, "berbere-kg", 4, "Hot and fragrant", "Rue comes through clearly. I asked for medium and that is what I got."],
  [hannaId, "niter-kibbeh", 5, "No additives", "Clean flavour, no orange colouring. Half the jar is already gone."],
  [danielId, "wirebuds", 3, "Good sound, app is English only", "ANC works well on the bus. I wish the companion app spoke Amharic."],
  [yonasId, "shiro-milled", 5, "Shiro in ten minutes", "Just water, oil and garlic. Tastes like my grandmother's."],
];
for (const [userId, key, rating, title, body] of REVIEWS) {
  run(`INSERT INTO reviews (product_id, user_id, order_id, rating, title, body, status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'published', ?)`,
    ids[key], userId, rating, title, body, ISOT(4 + (rating % 5), 12));
  recomputeRating(ids[key]);
}

const PENDING = [[liyaId, "clay-jebena", 4, "Holds heat well", "First coffee ceremony in it went great, just rinse out the dust."],
                 [danielId, "gel-pen-set", 5, "No smudging", "My left-handed daughter can finally write without a shiny sleeve."]];
for (const [userId, key, rating, title, body] of PENDING) {
  run(`INSERT INTO reviews (product_id, user_id, order_id, rating, title, body, status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?)`, ids[key], userId, rating, title, body, ISOT(1, 15));
}

/* Wishlist, views, events ------------------------------------------------- */

for (const [userId, keys] of [[saraId, ["sidamo-natural", "clay-jebena", "amharic-dictionary"]],
                              [liyaId, ["blender-1-5l", "habesha-kemis"]],
                              [yonasId, ["harar-longberry", "non-stick-pan", "honey-hmf"]]]) {
  for (const key of keys) {
    run(`INSERT INTO wishitems (user_id, product_id, created_at) VALUES (?, ?, ?)`, userId, ids[key], ISOT(3));
  }
}

for (let i = 0; i < 220; i++) {
  const key = PRODUCTS[i % PRODUCTS.length][0];
  run(`UPDATE products SET view_count = view_count + 1 WHERE id = ?`, ids[key]);
  run(`INSERT INTO events (type, product_id, user_id, payload, created_at) VALUES ('product.view', ?, ?, NULL, ?)`,
    ids[key], [saraId, liyaId, danielId, hannaId, yonasId][i % 5], ISOT(i % 20, 8 + (i % 12)));
}
for (const c of all(`SELECT user_id, COUNT(*) AS n FROM orders GROUP BY user_id`)) {
  run(`INSERT INTO events (type, product_id, user_id, payload, created_at) VALUES ('order.placed', NULL, ?, NULL, ?)`,
    c.user_id, ISOT(5));
}

setSetting("shop_name", "Meri Gebeya");
setSetting("shop_name_am", "መሪ ገበያ");
setSetting("tagline", "Fresh from the gebeya, to your door.");
setSetting("support_phone", "+251 911 000 111");
setSetting("free_gift_over_cents", 200000);
setSetting("default_lang", "en");

console.log(`users: ${users.length} (admin@merigebeya.et / Admin12345 · sara@example.et / Password123)`);
console.log(`reviews: ${REVIEWS.length + PENDING.length}, images in ${IMG_DIR}`);
console.log("\nDone. Start the server with:  npm start");
