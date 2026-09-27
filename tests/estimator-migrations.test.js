const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = (name) => fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", name), "utf8");

test("email notification migration separates the estimator core from the public RPC", () => {
  const sql = migration("007_estimate_email_notifications.sql");
  assert.match(sql, /rename to submit_print_estimate_core/i);
  assert.match(sql, /from public\.submit_print_estimate_core\s*\(/i);
});

test("overload repair migration is safe to run after the corrected migration chain", () => {
  const sql = migration("011_fix_estimate_submission_overload.sql");
  assert.match(sql, /to_regprocedure\s*\(/i);
  assert.match(sql, /create or replace function public\.submit_print_estimate\s*\(/i);
  assert.doesNotMatch(sql, /drop\s+(table|schema)/i);
});
