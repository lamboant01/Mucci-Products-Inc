/**
 * Public browser configuration. The Supabase anon key is safe to publish only
 * when the SQL migration and Row Level Security policies are installed.
 * Never put a service-role key in this file.
 */
window.MUCCI_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  publicSiteUrl: "https://mucciproducts.ca",
});
