const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("homepage provides an accessible top-right mobile menu", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const script = read("estimator", "mobile-menu.js");
  assert.match(html, /class="menu-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="mobile-menu"/);
  assert.match(html, /id="mobile-menu" class="mobile-menu"[^>]*hidden/);
  assert.match(html, /3D Printing Estimate/);
  assert.match(html, /estimator\/mobile-menu\.js/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.menu-toggle \{ display: grid; \}/);
  assert.match(css, /\.mobile-menu\s*\{[^}]*right: 0/);
  assert.match(script, /event\.key === "Escape"/);
});
