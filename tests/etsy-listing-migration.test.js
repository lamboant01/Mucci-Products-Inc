const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "014_etsy_listing_preparation.sql"), "utf8");

test("adds the Etsy preparation fields, statuses, and snapshot history", () => {
  for (const column of ["final_price", "final_quantity", "admin_notes", "clarification_notes", "processing_time_override", "etsy_prepared_at"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"));
  }
  assert.match(sql, /status in \('pending','reviewed','etsy_prepared','completed','declined'\)/i);
  assert.match(sql, /create table if not exists public\.etsy_listing_preparations/i);
  for (const column of ["quote_code", "generated_title", "generated_description", "final_price", "listing_quantity", "physical_quantity", "processing_time", "generated_at", "generated_by"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  }
});

test("keeps estimate lookup and mutations restricted to the existing admin check", () => {
  assert.match(sql, /create or replace function public\.admin_find_print_estimate\(p_quote_code text\)/i);
  assert.match(sql, /where e\.quote_code = clean_code limit 1/i);
  assert.match(sql, /if not public\.is_mucci_card_admin\(\)/gi);
  assert.match(sql, /revoke all on function public\.admin_find_print_estimate\(text\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.admin_find_print_estimate\(text\) to authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete).*etsy_listing_preparations\s+to\s+anon/i);
});

test("history has admin-only RLS and is inserted through the protected RPC", () => {
  assert.match(sql, /alter table public\.etsy_listing_preparations enable row level security/i);
  assert.match(sql, /create policy "admin reads Etsy listing preparations"[\s\S]*using \(public\.is_mucci_card_admin\(\)\)/i);
  assert.match(sql, /insert into public\.etsy_listing_preparations/i);
  assert.match(sql, /status = 'etsy_prepared'/i);
});

test("new estimator submission wrapper stores dimensions without opening estimate reads", () => {
  assert.match(sql, /p_model_width_mm numeric default null/i);
  assert.match(sql, /model_width_mm = round\(p_model_width_mm, 2\)/i);
  assert.match(sql, /grant execute on function public\.submit_print_estimate\([\s\S]*\) to anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+select\s+on\s+public\.print_estimates\s+to\s+anon/i);
});
