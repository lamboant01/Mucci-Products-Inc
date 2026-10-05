const test = require("node:test");
const assert = require("node:assert/strict");
const { projectFiles, publicEstimate } = require("../api/admin-projects");
const shopify = require("../api/_shopify-admin");

test("project files include every persisted customer upload once", () => {
  const files = projectFiles({
    created_at:"2026-10-04T10:00:00Z",
    file_path:"root/model.stl",
    original_file_name:"part.stl",
    model_files:[
      { path:"root/model.stl", name:"part.stl", size_bytes:1200 },
      { path:"root/project.3mf", name:"assembly.3mf", size_bytes:2400 },
      { path:null, name:"preliminary model" }
    ],
    reference_files:[{ path:"root/references/front.jpg", name:"front.jpg", size_bytes:3200, content_type:"image/jpeg" }]
  });
  assert.deepEqual(files.map((file) => file.name), ["part.stl", "assembly.3mf", "front.jpg"]);
  assert.equal(files[0].viewable, false);
  assert.equal(files[2].viewable, true);
});

test("project payload omits private customer and checkout tokens", () => {
  const result = publicEstimate({
    id:"project", quote_code:"MP-4GDBH", notification_token:"private",
    shopify_draft_order_claim_token:"private", another_token:"private", shopify_invoice_url:"https://checkout.example"
  });
  assert.deepEqual(result, { id:"project", quote_code:"MP-4GDBH" });
});

test("Shopify reconciliation maps a Draft Order to the completed order and admin URL", async () => {
  const responses = [
    { ok:true, json:async () => ({ access_token:"secret", expires_in:3600 }) },
    { ok:true, json:async () => ({ data:{ nodes:[{
      id:"gid://shopify/DraftOrder/99", name:"#D12", status:"COMPLETED",
      order:{ id:"gid://shopify/Order/1001", name:"#1001", displayFinancialStatus:"PAID", displayFulfillmentStatus:"UNFULFILLED" }
    }] } }) }
  ];
  const fetchImplementation = async () => responses.shift();
  const result = await shopify.projectStates(["gid://shopify/DraftOrder/99"], {
    SHOPIFY_SHOP:"mucci-test.myshopify.com", SHOPIFY_API_KEY:"client", SHOPIFY_API_SECRET:"secret"
  }, fetchImplementation);
  const project = result.projects.get("gid://shopify/DraftOrder/99");
  assert.equal(project.shopify_order_number, "#1001");
  assert.equal(project.shopify_payment_status, "PAID");
  assert.equal(project.shopify_fulfillment_status, "UNFULFILLED");
  assert.equal(project.shopify_admin_url, "https://admin.shopify.com/store/mucci-test/orders/1001");
});

test("Shopify reconciliation falls back to Draft Order data when read_orders is unavailable", async () => {
  const responses = [
    { ok:true, json:async () => ({ access_token:"secret", expires_in:3600 }) },
    { ok:true, json:async () => ({ errors:[{ message:"Access denied for order field." }] }) },
    { ok:true, json:async () => ({ data:{ nodes:[{ id:"gid://shopify/DraftOrder/77", name:"#D10", status:"OPEN" }] } }) }
  ];
  const result = await shopify.projectStates(["gid://shopify/DraftOrder/77"], {
    SHOPIFY_SHOP:"mucci-fallback.myshopify.com", SHOPIFY_API_KEY:"client", SHOPIFY_API_SECRET:"secret"
  }, async () => responses.shift());
  const project = result.projects.get("gid://shopify/DraftOrder/77");
  assert.equal(result.orderAccess, "read_orders_required");
  assert.equal(project.shopify_order_number, null);
  assert.equal(project.shopify_admin_url, "https://admin.shopify.com/store/mucci-fallback/draft_orders/77");
});

test("Shopify order detail uses current customer contact fields and bounded shipping data", async () => {
  const responses = [
    { ok:true, json:async () => ({ access_token:"secret", expires_in:3600 }) },
    { ok:true, json:async () => ({ data:{ node:{
      id:"gid://shopify/Order/1001", createdAt:"2026-10-04T10:00:00Z", note:"Leave at desk",
      customer:{ displayName:"Alex", defaultEmailAddress:{ emailAddress:"alex@example.test" }, defaultPhoneNumber:{ phoneNumber:"555-0100" } },
      shippingAddress:{ formattedArea:"Toronto ON, Canada", address1:"1 Main St", address2:null, zip:"M1M 1M1", phone:"555-0101" }
    } } }) }
  ];
  const result = await shopify.orderDetails("gid://shopify/Order/1001", {
    SHOPIFY_SHOP:"mucci-detail.myshopify.com", SHOPIFY_API_KEY:"client", SHOPIFY_API_SECRET:"secret"
  }, async () => responses.shift());
  assert.equal(result.customer.email, "alex@example.test");
  assert.equal(result.customer.phone, "555-0100");
  assert.equal(result.shippingAddress.postalCode, "M1M 1M1");
});
