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

1. Create a Supabase project and run `supabase/migrations/001_mucci_digital_cards.sql`, followed by `supabase/migrations/002_owner_profile_setup.sql`, in its SQL editor.
2. In Supabase Authentication, enable Email. Set the Site URL to `https://mucciproducts.com` and add `https://mucciproducts.com/card-dashboard/` to Redirect URLs.
3. Set `supabaseUrl`, `supabaseAnonKey`, and the final `publicSiteUrl` in `config.js`. The anon key is public by design; never use the service-role key in this repository.
4. In **Authentication → Users**, invite or create the owner's email. Open `/card-dashboard/`, request a sign-in link, and complete the first-card setup form. Public self-registration is disabled; the authenticated RPC creates the invited owner's profile and one physical card with a random 48-character token.
5. Program the displayed `https://mucciproducts.com/card/{token}` URL onto the NFC tag with NFC Tools or NXP TagWriter.

### Branded sign-in email

For a hosted Supabase project, committed templates are not applied automatically. In **Supabase Dashboard → Authentication → Email Templates**:

1. Under **Magic Link**, set the subject to `Your Mucci Digital Cards sign-in link` and copy `supabase/templates/magic-link.html` into the message body.
2. Under **Invite user**, set the subject to `Your Mucci Digital Cards invitation` and copy `supabase/templates/invite.html` into the message body.
3. Optionally brand **Confirm signup** with `supabase/templates/confirmation.html` if you later enable public signup.
4. Save the templates and test with one invited owner and one existing owner account.

The template uses Supabase's `{{ .ConfirmationURL }}` and `{{ .Email }}` variables. For production delivery beyond project team addresses, configure custom SMTP in Supabase and disable provider click tracking so authentication links are not rewritten.

The `card-assets` public Storage bucket accepts PNG, JPEG, WebP, and SVG files up to 5 MB. Owner uploads use an object path beginning with their Auth UUID. The dashboard supports profile-photo and company-logo uploads after the first profile is created.

### Local testing

Serve the repository through a local HTTP server (opening HTML from `file://` will not emulate routes):

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/card.html?token=sample-preview-2026&preview=1` for a local-only layout preview, or use a configured valid token without the preview parameter. Run dependency-free unit tests with:

```powershell
node --test tests/card-core.test.js
```

### Hosting and clean routes

The production site is hosted on Vercel. Configure a rewrite so `/card/{token}` serves `card.html` while preserving the public URL. The included `404.html` remains a fallback for static hosting.

### Security model

Anonymous roles cannot select the `profiles`, `physical_cards`, or `saved_profiles` tables. The `get_public_card_profile` security-definer RPC accepts one token and returns only approved public fields for an active card and active profile. Owner edits and saved-profile rows are isolated by `auth.uid()` RLS policies. Admin issuance is intentionally limited to the Supabase dashboard or a future authenticated Edge Function; there is no public admin UI or browser service-role key.

## Live site

[Visit the Mucci Products website](https://mucciproducts.com/)

## Personalize

The Etsy destination is configured in `script.js`. Project copy and links live in `index.html`.

## Deployment

Vercel is the production host. The legacy GitHub Pages workflow remains in the repository but is not the production domain target.
