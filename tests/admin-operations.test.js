const test = require("node:test");
const assert = require("node:assert/strict");
const { customersFrom } = require("../api/admin-operations");

test("customer view groups estimate activity by normalized email without inventing accounts", () => {
  const customers = customersFrom([
    { quote_code:"MP-ABCDE", name:"Alex", email:"Alex@example.com", status:"pending", created_at:"2026-09-20T10:00:00Z", final_price:40 },
    { quote_code:"MP-BCDEF", name:"Alex M", email:" alex@EXAMPLE.com ", status:"completed", created_at:"2026-09-21T10:00:00Z", final_price:60 },
    { quote_code:"MP-CDEFG", name:null, email:null, status:"pending", created_at:"2026-09-22T10:00:00Z", final_price:null }
  ]);
  assert.equal(customers.length, 2);
  assert.equal(customers[0].key, "quote:MP-CDEFG");
  assert.equal(customers[1].email, "alex@example.com");
  assert.equal(customers[1].requestCount, 2);
  assert.equal(customers[1].totalQuoted, 100);
  assert.equal(customers[1].name, "Alex M");
});
