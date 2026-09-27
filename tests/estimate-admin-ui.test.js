const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", "admin", "estimates", name), "utf8");

test("admin estimate route loads the listing configuration before the dashboard", () => {
  const html = read("index.html");
  assert.match(html, /etsy-listing-config\.js[\s\S]*etsy-listing\.js[\s\S]*estimates\.js/i);
  assert.match(html, /noindex,nofollow,noarchive/i);
});

test("admin workflow uses protected exact-match RPCs and private signed file access", () => {
  const source = read("estimates.js");
  assert.match(source, /client\.rpc\("admin_find_print_estimate"/);
  assert.match(source, /trim\(\)\.toUpperCase\(\)/);
  assert.doesNotMatch(source, /maxlength="8"/);
  assert.match(source, /client\.rpc\("admin_prepare_etsy_listing"/);
  assert.match(source, /storage\.from\("print-estimate-files"\)\.createSignedUrl\(path, 60\)/);
  assert.doesNotMatch(source, /\.from\("print_estimates"\)\.select/);
});

test("admin workflow includes review safety, copy actions, filters, and manual Etsy handoff", () => {
  const source = read("estimates.js");
  for (const phrase of [
    "Prepare Etsy Listing", "Final Etsy Price", "Etsy Listing Quantity", "Admin override",
    "Copy Quote Code", "Copy Customer Email", "Copy Description", "Copy Etsy Reply",
    "Copy All Etsy Details", "Open Etsy Messages", "Mark Reviewed", "Mark Completed", "Decline"
  ]) assert.match(source, new RegExp(phrase));
  assert.match(source, /\["all", \.\.\.adminConfig\.statuses, "manual_review"\]/);
  assert.doesNotMatch(source, /playwright|selenium|etsy.*cookie|etsy.*password/i);
});

test("admin stylesheet has phone and tablet adaptations", () => {
  const css = read("estimates.css");
  assert.match(css, /@media \(max-width: 840px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
});
