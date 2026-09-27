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

test("minimum-order migration clamps the total to 40 CAD instead of adding 40 CAD", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "013_enforce_estimator_minimum_order.sql"), "utf8");
  assert.match(sql, /base_price\s*=\s*40\.00/i);
  assert.match(sql, /greatest\(cfg\.base_price,\s*hours_min\s*\*\s*cfg\.hourly_production_factor\s*\+/i);
  assert.match(sql, /greatest\(cfg\.base_price,\s*hours_max\s*\*\s*cfg\.hourly_production_factor\s*\+/i);
  assert.doesNotMatch(sql, /cfg\.base_price\s*\+\s*hours_(?:min|max)/i);
});
