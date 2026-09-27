"use strict";

function headers(config, extra = {}) {
  return { apikey:config.serviceKey, Authorization:`Bearer ${config.serviceKey}`, ...extra };
}

async function request(config, path, options = {}) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers:headers(config, options.headers),
    signal:AbortSignal.timeout(options.timeout || 10000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = text; }
  }
  if (!response.ok) {
    const error = new Error(`Supabase request failed with status ${response.status}.`);
    error.statusCode = response.status;
    error.detail = data;
    throw error;
  }
  return data;
}

async function rpc(config, name, body) {
  return request(config, `/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(body || {})
  });
}

function queryPath(table, parameters) {
  const query = new URLSearchParams(parameters);
  return `/rest/v1/${encodeURIComponent(table)}?${query}`;
}

async function select(config, table, parameters) {
  return request(config, queryPath(table, parameters));
}

async function patch(config, table, parameters, body) {
  return request(config, queryPath(table, parameters), {
    method:"PATCH",
    headers:{ "Content-Type":"application/json", Prefer:"return=representation" },
    body:JSON.stringify(body)
  });
}

async function signedStorageUrl(config, bucket, objectPath, expiresIn = 60) {
  const encoded = String(objectPath).split("/").map(encodeURIComponent).join("/");
  const data = await request(config, `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encoded}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ expiresIn })
  });
  const value = data?.signedURL || data?.signedUrl;
  if (!value) throw new Error("Storage did not return a signed URL.");
  return /^https:\/\//.test(value) ? value : `${config.supabaseUrl}/storage/v1${value}`;
}

async function signedUploadUrl(config, bucket, objectPath) {
  const encoded = String(objectPath).split("/").map(encodeURIComponent).join("/");
  const data = await request(config, `/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encoded}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:"{}"
  });
  if (!data?.url) throw new Error("Storage did not return a signed upload URL.");
  const signedUrl = /^https:\/\//.test(data.url) ? data.url : `${config.supabaseUrl}/storage/v1${data.url}`;
  const publicUrl = `${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encoded}`;
  return { signedUrl, publicUrl };
}

module.exports = { headers, patch, queryPath, request, rpc, select, signedStorageUrl, signedUploadUrl };
