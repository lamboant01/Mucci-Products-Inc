const test = require("node:test");
const assert = require("node:assert/strict");
const common = require("../api/_wallet-common.js");

test("wallet token reader accepts one valid opaque token", () => {
  assert.equal(common.requestToken({ query: { token: "f4DK_9q0Lw2-a8Zx" } }), "f4DK_9q0Lw2-a8Zx");
  assert.equal(common.requestToken({ query: { token: "short" } }), "");
});

test("wallet card URL uses the canonical non-www domain", () => {
  const previous = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://mucciproducts.com/";
  assert.equal(common.cardUrl("f4DK_9q0Lw2-a8Zx"), "https://mucciproducts.com/card/f4DK_9q0Lw2-a8Zx");
  if (previous === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = previous;
});

test("wallet logo rejects non-HTTPS profile URLs", () => {
  assert.equal(common.publicLogoUrl({ logo_url: "javascript:alert(1)" }), "https://mucciproducts.com/assets/mucci-products-logo.png");
});
