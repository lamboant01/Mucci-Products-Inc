"use strict";

const crypto = require("node:crypto");
const auth = require("./_admin-auth");
const db = require("./_admin-supabase");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROFILE_FIELDS = ["name", "company", "title", "phone", "email", "website", "linkedin", "instagram", "address", "bio", "logo_url", "profile_image_url"];
const FIELD_LIMITS = { name:120, company:160, title:160, phone:50, email:254, website:500, linkedin:500, instagram:500, address:500, bio:1000, logo_url:2000, profile_image_url:2000 };
const IMAGE_TYPES = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/svg+xml", "svg"]]);

async function logActivity(config, user, body, payload) {
  const events = {
    create:{ action:"digital_card_created", summary:"Digital card profile created." },
    update:{ action:"digital_card_updated", summary:"Digital card profile updated." },
    asset_ticket:{ action:"card_asset_upload_started", summary:"Secure digital card image upload started." }
  };
  const event = events[body.action];
  if (!event) return;
  try {
    await db.insert(config, "admin_activity", {
      actor_user_id:user.id, action:event.action, subject_type:"digital_card",
      subject_id:String(body.profileId || payload?.profile_id || "") || null,
      summary:event.summary,
      metadata:body.action === "asset_ticket" ? { field:String(body.field || "") } : {}
    });
  } catch (error) {
    console.warn("Admin activity could not be recorded", { action:event.action, statusCode:error?.statusCode });
  }
}

function uuid(value) { const clean = String(value || "").toLowerCase(); return UUID_PATTERN.test(clean) ? clean : ""; }

function profileValues(body) {
  const result = {};
  for (const field of PROFILE_FIELDS) {
    const value = String(body[field] || "").trim();
    if (value.length > FIELD_LIMITS[field]) throw new Error("Profile field is too long.");
    result[field] = value || null;
  }
  if (!result.name) throw new Error("Name is required.");
  result.is_active = body.is_active !== false;
  return result;
}

async function listCards(config) {
  const profiles = await db.select(config, "profiles", { select:"*", order:"created_at.asc" });
  if (!profiles.length) return { profiles:[], cards:[] };
  const ids = profiles.map((profile) => profile.id).join(",");
  const cards = await db.select(config, "physical_cards", { profile_id:`in.(${ids})`, select:"id,profile_id,public_token,card_label,is_active,created_at", order:"created_at.asc" });
  return { profiles, cards };
}

async function handleAction(config, user, body) {
  switch (body.action) {
    case "list": return listCards(config);
    case "create": {
      const values = profileValues(body.profile || {});
      const created = await db.rpc(config, "server_create_digital_card", {
        p_owner_user_id:user.id,
        ...Object.fromEntries(PROFILE_FIELDS.filter((field) => !["logo_url", "profile_image_url"].includes(field)).map((field) => [`p_${field}`, values[field]]))
      });
      return { created:created?.[0] || null };
    }
    case "update": {
      const profileId = uuid(body.profileId);
      if (!profileId) throw new Error("Invalid profile.");
      const values = profileValues(body.profile || {});
      const updated = await db.patch(config, "profiles", { id:`eq.${profileId}` }, values);
      if (!updated?.length) throw new Error("Profile not found.");
      return { profile:updated[0] };
    }
    case "asset_ticket": {
      const contentType = String(body.contentType || "").toLowerCase();
      const extension = IMAGE_TYPES.get(contentType);
      if (!extension) throw new Error("Unsupported image type.");
      const size = Number(body.size);
      if (!Number.isInteger(size) || size < 1 || size > 5 * 1024 * 1024) throw new Error("Invalid image size.");
      const field = String(body.field || "");
      if (!["logo_url", "profile_image_url"].includes(field)) throw new Error("Invalid image field.");
      const objectPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      return { ...(await db.signedUploadUrl(config, "card-assets", objectPath)), objectPath };
    }
    default: throw new Error("Invalid action.");
  }
}

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "POST") return auth.apiNotFound(res);
  try {
    const config = auth.configuration();
    if (!auth.requestIsSameOrigin(req, config)) return auth.apiNotFound(res);
    const administrator = await auth.authenticateAdmin(req, res, config);
    if (administrator.status !== "authorized") return auth.apiNotFound(res);
    const body = auth.requestBody(req);
    const payload = await handleAction(config, administrator.user, body);
    await logActivity(config, administrator.user, body, payload);
    console.info("Authorized card administration action", { action:String(body.action || ""), userId:administrator.user.id });
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Card administration action failed", { message:error?.message });
    return res.status(400).json({ error:"The administrative request could not be completed." });
  }
};

module.exports.handleAction = handleAction;
module.exports.profileValues = profileValues;
