const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", "admin", "estimates", name), "utf8");
const readApi = (name) => fs.readFileSync(path.join(__dirname, "..", "api", name), "utf8");

test("server-rendered owner area loads only the protected estimate client", () => {
  const page = readApi("admin-page.js");
  assert.match(page, /noindex,nofollow,noarchive,nosnippet/i);
  assert.match(page, /management-estimates\.js/i);
  assert.doesNotMatch(page, /signInWithPassword|supabase-js/i);
});

test("admin workflow uses protected exact-match RPCs and private signed file access", () => {
  const source = read("estimates.js");
  const server = readApi("admin-estimates.js");
  assert.match(source, /fetch\("\/api\/admin-estimates"/);
  assert.match(source, /trim\(\)\.toUpperCase\(\)/);
  assert.doesNotMatch(source, /maxlength="8"/);
  assert.match(server, /"admin_find_print_estimate"/);
  assert.match(server, /"admin_prepare_etsy_listing"/);
  assert.match(server, /signedStorageUrl\(config, "print-estimate-files"/);
  assert.match(server, /authenticateAdmin/);
  assert.match(server, /requestIsSameOrigin/);
  assert.doesNotMatch(source, /\.from\("print_estimates"\)\.select/);
  assert.doesNotMatch(source, /supabase|signInWithPassword|service_role/i);
});

test("admin workflow includes review safety, copy actions, filters, and manual Etsy handoff", () => {
  const source = read("estimates.js");
  const config = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
  for (const phrase of [
    "Prepare Etsy Listing", "Final Etsy Price", "Etsy Listing Quantity", "Admin override",
    "Copy Quote Code", "Copy Customer Email", "Copy Description", "Copy Etsy Reply",
    "Copy All Etsy Details", "Open Etsy Messages", "Mark Reviewed", "Mark Completed", "Decline"
  ]) assert.match(source, new RegExp(phrase));
  assert.match(source, /\["all", \.\.\.statuses, "manual_review"\]/);
  assert.match(source, /config\.etsyMessagesUrl/);
  assert.match(config, /etsyMessagesUrl:\s*"https:\/\/www\.etsy\.com\/messages\?ref=seller-platform-mcnav"/);
  assert.doesNotMatch(source, /playwright|selenium|etsy.*cookie|etsy.*password/i);
});

test("admin stylesheet has phone and tablet adaptations", () => {
  const css = read("estimates.css");
  assert.match(css, /@media \(max-width: 840px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
});

test("Files tab manages Drive quote folders without deletion", () => {
  const operations = fs.readFileSync(path.join(__dirname, "..", "admin", "operations.js"), "utf8");
  const server = readApi("admin-estimates.js");
  for (const phrase of ["One private folder per quote", "Manage files", "Open in Google Drive", "Upload a late customer file", "View", "Download"]) {
    assert.match(operations, new RegExp(phrase));
  }
  for (const action of ["drive_files", "drive_upload_start", "drive_upload_complete"]) assert.match(server, new RegExp(action));
  assert.doesNotMatch(operations, /delete quote file|delete from drive|remove file/i);
  assert.match(operations, /25 \* 1024 \* 1024/);
});
