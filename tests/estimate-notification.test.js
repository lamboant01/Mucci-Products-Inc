const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/estimate-notification");

function responseRecorder() {
  return {
    statusCode:200, headers:{}, body:null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("sends one protected estimate summary to the owner", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const originalEnvironment = { ...process.env };
  context.after(() => {
    global.fetch = originalFetch;
    process.env = originalEnvironment;
  });
  Object.assign(process.env, {
    SUPABASE_URL:"https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY:"service-role-test",
    RESEND_API_KEY:"resend-test",
    PUBLIC_SITE_URL:"https://mucciproducts.com"
  });

  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://api.resend.com/emails") return new Response(JSON.stringify({ id:"email-1" }), { status:200 });
    if (init.method === "PATCH") return new Response(null, { status:204 });
    return new Response(JSON.stringify([{
      quote_code:"MP-A42K7", name:"Anthony", original_file_name:"bracket.stl",
      file_path:"model/path.stl", file_status:"ready", quantity:1,
      print_hours_per_item:1, print_minutes_per_item:5, size_category:null,
      colour_count:"2", design_level:"none", assembly_required:false, notes:"Blue",
      estimated_material_grams:11, estimated_price:15.2, estimated_price_max:15.2,
      requires_manual_review:false, print_profile:"standard", purge_waste_percent:10,
      filament_grams_per_item:10, email_notification_sent_at:null
    }]), { status:200, headers:{ "Content-Type":"application/json" } });
  };

  const req = {
    method:"POST",
    body:{ quoteCode:"MP-A42K7", notificationToken:"123e4567-e89b-42d3-a456-426614174000" }
  };
  const res = responseRecorder();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { sent:true });
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /notification_token=eq\.123e4567-e89b-42d3-a456-426614174000/);
  const emailCall = calls.find((call) => call.url === "https://api.resend.com/emails");
  const payload = JSON.parse(emailCall.init.body);
  assert.equal(payload.from, "Mucci Products <order@mucciproducts.com>");
  assert.deepEqual(payload.to, ["anthony@mucciproducts.com"]);
  assert.match(payload.text, /admin\/estimates\/\?quote=MP-A42K7/);
  assert.match(payload.text, /bracket\.stl/);
  assert.equal(payload.attachments, undefined);
  assert.equal(emailCall.init.headers["Idempotency-Key"], "estimate-submitted/MP-A42K7");
});

test("rejects a request without the private notification token", async () => {
  const res = responseRecorder();
  await handler({ method:"POST", body:{ quoteCode:"MP-A42K7" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error:"Invalid notification request." });
});
