/* Tiny SQL console for learning and debugging — uses the same database the
   server uses. Read-only by default; pass --write to allow changes.

     npm run sql -- "SELECT id, name, stock FROM products LIMIT 5"
     npm run sql -- ".tables"
     npm run sql -- ".schema products"
     npm run sql -- --write "UPDATE products SET stock = 50 WHERE id = 1"
*/
import { db, all } from "./config.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const sql = args.filter((a) => a !== "--write").join(" ").trim();

if (!sql) {
  console.log('Usage: npm run sql -- "SELECT * FROM products LIMIT 5"   (.tables, .schema <table>, --write)');
  process.exit(0);
}

try {
  if (sql === ".tables") {
    console.log(all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .map((r) => r.name).join("\n"));
  } else if (sql.startsWith(".schema")) {
    const table = sql.split(/\s+/)[1];
    const rows = all(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ${table ? "AND tbl_name = ?" : ""}`, ...(table ? [table] : []));
    console.log(rows.map((r) => r.sql + ";").join("\n\n") || `No table named ${table}`);
  } else if (/^\s*(select|with|pragma|explain)\b/i.test(sql)) {
    const rows = all(sql);
    console.table(rows.map((r) => ({ ...r })));
    console.log(`${rows.length} row(s)`);
  } else if (!write) {
    console.error("That statement changes data. Re-run with --write if you mean it.");
    process.exit(1);
  } else {
    const info = db.prepare(sql).run();
    console.log(`OK — ${info.changes} row(s) changed`);
  }
} catch (err) {
  console.error("SQL error:", err.message);
  process.exit(1);
}
