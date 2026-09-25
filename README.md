# Mucci Products — Projects, Etsy & Digital Cards

A responsive personal portfolio showcasing independent digital products and linking to an Etsy shop.

## Mucci Digital Cards

The static site now includes a mobile-first NFC digital-card structure:

- `/card/{publicToken}` public capability URL (served by the GitHub Pages `404.html` fallback)
- `/my-cards/` browser-local history containing only cards opened on that device
- `/card-dashboard/` passwordless owner sign-in and owner-scoped profile editor
- a Supabase migration with narrow public RPC lookup and Row Level Security

Contact downloads and Apple/Google Wallet buttons are intentionally non-functional placeholders. Real wallet passes require a secure server-side signing service.

### Setup

1. Create a Supabase project and run `supabase/migrations/001_mucci_digital_cards.sql` in its SQL editor.
2. In Supabase Authentication, enable Email and add the deployed `/card-dashboard/` URL to Redirect URLs.
3. Set `supabaseUrl`, `supabaseAnonKey`, and the final `publicSiteUrl` in `config.js`. The anon key is public by design; never use the service-role key in this repository.
4. Create an Auth user. In the SQL editor, insert a `profiles` row using that user's UUID, then insert one or more `physical_cards` rows referencing the profile. Omit `public_token` so PostgreSQL generates a random 48-character token.
5. Program the displayed `https://mucciproducts.ca/card/{token}` URL onto the NFC tag with NFC Tools or NXP TagWriter.

The `card-assets` public Storage bucket accepts PNG, JPEG, WebP, and SVG files up to 5 MB. Owner uploads must use an object path beginning with their Auth UUID. The current dashboard accepts image URLs but does not yet include an upload control.

### Local testing

Serve the repository through a local HTTP server (opening HTML from `file://` will not emulate routes):

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/card.html?token=sample-preview-2026&preview=1` for a local-only layout preview, or use a configured valid token without the preview parameter. Run dependency-free unit tests with:

```powershell
node --test tests/card-core.test.js
```

### GitHub Pages limitation

GitHub Pages has no rewrite rules. Clean `/card/{token}` URLs are handled by the custom `404.html`; the card renders at that URL, but the HTTP status remains 404. For correct 200 responses and stronger caching/analytics, use a host with rewrites (Cloudflare Pages, Netlify, or Vercel) or put a worker/proxy in front of GitHub Pages.

### Security model

Anonymous roles cannot select the `profiles`, `physical_cards`, or `saved_profiles` tables. The `get_public_card_profile` security-definer RPC accepts one token and returns only approved public fields for an active card and active profile. Owner edits and saved-profile rows are isolated by `auth.uid()` RLS policies. Admin issuance is intentionally limited to the Supabase dashboard or a future authenticated Edge Function; there is no public admin UI or browser service-role key.

## Live site

[Visit the Mucci Products website](https://lamboant01.github.io/Mucci-Products-Inc./)

## Personalize

The Etsy destination is configured in `script.js`. Project copy and links live in `index.html`.

## GitHub Pages

The included workflow publishes the site whenever `main` is updated. In the repository settings, set **Pages → Source** to **GitHub Actions** if it is not selected automatically.
