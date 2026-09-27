const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("latest estimator pricing migration uses the requested time and filament rates", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "012_update_print_pricing_rates.sql"), "utf8");
  assert.match(sql, /base_price\s*=\s*0\.00/i);
  assert.match(sql, /hourly_production_factor\s*=\s*2\.50/i);
  assert.match(sql, /material_rate_per_gram\s*=\s*0\.40/i);
  assert.match(sql, /where\s+singleton\s*=\s*true/i);
});
