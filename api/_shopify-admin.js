"use strict";

const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const DRAFT_ORDER_PATTERN = /^gid:\/\/shopify\/DraftOrder\/([0-9]+)$/;
const ORDER_PATTERN = /^gid:\/\/shopify\/Order\/([0-9]+)$/;
const SHOPIFY_API_VERSION = "2026-10";

const DRAFT_ORDER_PROJECTS = `#graphql
  query MucciAdminDraftOrderProjects($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on DraftOrder {
        id
        name
        status
        order {
          id
          name
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

const ORDER_DETAIL = `#graphql
  query MucciAdminOrderDetail($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        createdAt
        note
        customer {
          displayName
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
        }
        shippingAddress { formattedArea address1 address2 zip phone }
      }
    }
  }
`;

const DRAFT_ORDER_PROJECTS_FALLBACK = `#graphql
  query MucciAdminDraftOrders($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on DraftOrder {
        id
        name
        status
      }
    }
  }
`;

let cachedToken = null;

function configuration(environment = process.env) {
  const rawShop = String(environment.SHOPIFY_SHOP || "").trim().toLowerCase();
  const shop = rawShop && !rawShop.endsWith(".myshopify.com") ? `${rawShop}.myshopify.com` : rawShop;
  const config = {
    shop,
    clientId:String(environment.SHOPIFY_API_KEY || "").trim(),
    clientSecret:String(environment.SHOPIFY_API_SECRET || "").trim(),
    apiVersion:SHOPIFY_API_VERSION
  };
  if (!config.shop && !config.clientId && !config.clientSecret) return null;
  if (!SHOP_PATTERN.test(config.shop) || !config.clientId || !config.clientSecret) {
    const error = new Error("Shopify Admin reconciliation is only partially configured.");
    error.statusCode = 503;
    throw error;
  }
  return config;
}

function numericId(value, pattern) {
  return String(value || "").match(pattern)?.[1] || "";
}

function adminUrl(config, type, gid) {
  const id = numericId(gid, type === "order" ? ORDER_PATTERN : DRAFT_ORDER_PATTERN);
  if (!config || !id) return null;
  const handle = config.shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/${type === "order" ? "orders" : "draft_orders"}/${id}`;
}

async function accessToken(config, fetchImplementation = fetch) {
  const cacheKey = `${config.shop}:${config.clientId}`;
  if (cachedToken?.cacheKey === cacheKey && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await fetchImplementation(`https://${config.shop}/admin/oauth/access_token`, {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({ grant_type:"client_credentials", client_id:config.clientId, client_secret:config.clientSecret }),
    signal:AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`Shopify authentication failed with status ${response.status}.`);
  cachedToken = {
    cacheKey,
    value:payload.access_token,
    expiresAt:Date.now() + Math.max(60, Number(payload.expires_in) || 86399) * 1000
  };
  return cachedToken.value;
}

async function graphql(config, token, query, variables, fetchImplementation = fetch) {
  const response = await fetchImplementation(`https://${config.shop}/admin/api/${config.apiVersion}/graphql.json`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "X-Shopify-Access-Token":token },
    body:JSON.stringify({ query, variables }),
    signal:AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const error = new Error(payload.errors?.[0]?.message || `Shopify Admin API returned ${response.status}.`);
    error.statusCode = response.status || 502;
    error.graphqlErrors = payload.errors || [];
    throw error;
  }
  return payload.data;
}

function projectState(config, node, orderAccess) {
  if (!node?.id) return null;
  const order = node.order || null;
  return {
    shopify_draft_order_id:node.id,
    shopify_draft_order_name:node.name || null,
    shopify_draft_order_live_status:node.status || null,
    shopify_order_id:order?.id || null,
    shopify_order_number:order?.name || null,
    shopify_payment_status:order?.displayFinancialStatus || null,
    shopify_fulfillment_status:order?.displayFulfillmentStatus || null,
    shopify_total_amount:order?.totalPriceSet?.shopMoney?.amount || null,
    shopify_currency_code:order?.totalPriceSet?.shopMoney?.currencyCode || null,
    shopify_admin_url:adminUrl(config, order ? "order" : "draft", order?.id || node.id),
    shopify_order_access:orderAccess
  };
}

async function orderDetails(orderId, environment = process.env, fetchImplementation = fetch) {
  if (!ORDER_PATTERN.test(String(orderId || ""))) return null;
  const config = configuration(environment);
  if (!config) return null;
  const token = await accessToken(config, fetchImplementation);
  const data = await graphql(config, token, ORDER_DETAIL, { id:orderId }, fetchImplementation);
  const order = data?.node;
  if (!order?.id) return null;
  return {
    createdAt:order.createdAt || null,
    note:order.note || null,
    customer:order.customer ? {
      name:order.customer.displayName || null,
      email:order.customer.defaultEmailAddress?.emailAddress || null,
      phone:order.customer.defaultPhoneNumber?.phoneNumber || null
    } : null,
    shippingAddress:order.shippingAddress ? {
      area:order.shippingAddress.formattedArea || null,
      address1:order.shippingAddress.address1 || null,
      address2:order.shippingAddress.address2 || null,
      postalCode:order.shippingAddress.zip || null,
      phone:order.shippingAddress.phone || null
    } : null
  };
}

async function fetchBatch(config, token, ids, fetchImplementation) {
  try {
    const data = await graphql(config, token, DRAFT_ORDER_PROJECTS, { ids }, fetchImplementation);
    return (data?.nodes || []).map((node) => projectState(config, node, "available")).filter(Boolean);
  } catch (error) {
    const data = await graphql(config, token, DRAFT_ORDER_PROJECTS_FALLBACK, { ids }, fetchImplementation);
    return (data?.nodes || []).map((node) => projectState(config, node, "read_orders_required")).filter(Boolean);
  }
}

async function projectStates(draftOrderIds, environment = process.env, fetchImplementation = fetch) {
  const config = configuration(environment);
  if (!config) return { configured:false, orderAccess:"not_configured", projects:new Map() };
  const ids = [...new Set(draftOrderIds.map(String).filter((id) => DRAFT_ORDER_PATTERN.test(id)))];
  if (!ids.length) return { configured:true, orderAccess:"available", projects:new Map() };
  const token = await accessToken(config, fetchImplementation);
  const projects = new Map();
  let orderAccess = "available";
  for (let index = 0; index < ids.length; index += 50) {
    const rows = await fetchBatch(config, token, ids.slice(index, index + 50), fetchImplementation);
    for (const row of rows) {
      projects.set(row.shopify_draft_order_id, row);
      if (row.shopify_order_access !== "available") orderAccess = row.shopify_order_access;
    }
  }
  return { configured:true, orderAccess, projects };
}

module.exports = {
  DRAFT_ORDER_PROJECTS,
  DRAFT_ORDER_PROJECTS_FALLBACK,
  ORDER_DETAIL,
  adminUrl,
  configuration,
  orderDetails,
  projectStates
};
