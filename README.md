# Mucci Products — Projects, Etsy & Digital Cards

A responsive personal portfolio showcasing independent digital products and linking to an Etsy shop.

## 3D printing estimator

The customer estimator is available at `/estimator/`. It calculates through a
narrow Supabase function, submits requests under a short quote code, and uploads
optional model files to a private Storage bucket. The protected lookup page is
served only from a private server-configured path and is not linked publicly.
Customers upload an STL, 3MF, OBJ, STEP, or STP model, inspect it in an
interactive 3D preview, and have it converted to G-code locally in a Web Worker
with the vendored Three Slicer WASM engine. Standard Detail (0.20 mm) and
Efficient Larger Prints (0.24 mm) profiles affect the calculated time. Both use
50 mm/s for the initial layer and a conservative 200 mm/s general print speed.
The current browser slicer exposes one general speed, so the A1 slicer's more
specific 105 mm/s initial infill, 230 mm/s inner/infill, 50% small-perimeter,
and 80% vertical-shell values are retained as documented reference settings but
are not falsely presented as active per-feature controls. The fixed
0.4 mm nozzle, three walls, and
30% infill are defined in `estimator/slicer-config.js` and are not shown in the
customer interface. Multi-colour purge allowances are stored centrally in the
private estimator configuration: 0% for one colour, 10% for two, 18% for three,
and 25% for four. Slicer filament length is converted to weight using 1.75 mm
filament and the selected density: 1.24 g/cm³ for PLA or 1.27 g/cm³ for PETG.
The sliced-print price is $2.50 CAD per total
production hour plus $0.40 CAD per total filament gram, with the colour purge
allowance applied to both totals. Design and assembly are separate optional
charges. The total order is subject to a $40 CAD minimum; that minimum is not
added on top of the calculated price.

When no model file exists, the customer must choose **3D Design Only** or
**3D Design + 3D Printing** and provide the maximum finished length, width,
height, and unit. Design-only estimates contain no manufacturing charge. For
design-and-print requests, the browser slices a temporary dimension-based box
at 30% infill, four walls, and 0.20 mm layers to produce a conservative
preliminary printing estimate. That virtual model is an estimation aid, not a
claim that the finished object will be a solid block. Design, preliminary
printing, and combined totals remain separate in the customer result, database,
owner email, and admin review. Printing requests also require the customer's
wanted colour names or shades, with a clear notice that the closest filament
match depends on current market availability.

Customers can also attach up to 10 PNG, JPEG, WebP, HEIC, HEIF, or GIF reference
images, each no larger than 10 MB. The form asks for specific project details to
reduce follow-up delays. Reference images remain private and are copied into the
same quote-code Google Drive folder as the uploaded model.

The printer build volume remains 250 × 250 × 250 mm. Finished dimensions up to
2500 mm per axis are accepted for no-file design requests. If any finished
dimension exceeds 250 mm, the customer must approve splitting the design into
printable sections and assembly. The preliminary printing calculation uses
balanced sections that each fit the build volume, stores the estimated section
count, and always requires manual confirmation. Uploaded models must still fit
the build volume because automatic geometry cutting is not performed.

The viewer and slicer support touch input on phones and tablets. Complex models
can exceed a mobile browser's available memory; in that case the estimator asks
the customer to use a desktop computer for that model. Browser slicing depends
on the pinned Three.js and OCCT browser modules. The AGPL Three Slicer engine,
its licence, and its third-party notices are kept under
`estimator/vendor/three-slicer/` so the worker does not depend on a remote path.

Run migrations 004 through 020 in order after migrations 001 through 003. All
private pricing values and fallback-time assumptions are centralized in
the single-row `print_estimator_config` table created by that migration. Update
that row in Supabase to change pricing without editing the public website.

Submitted estimates can send a one-time owner notification through the Vercel
function at `/api/estimate-notification`. Configure `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `RESEND_API_KEY` as server-only Vercel
environment variables. The default sender is
`Mucci Products <order@mucciproducts.com>` and the `mucciproducts.com` domain
must be verified by Resend. `ESTIMATE_EMAIL_FROM` can override that sender.
`ESTIMATE_EMAIL_TO` is optional and defaults to `order@mucciproducts.com`.
The email includes the quote code but never includes the private administration
address. The model itself remains private and is opened only from the protected
owner area with a short-lived signed URL.

Uploaded models can also be mirrored privately into a Google Drive folder by
the server function at `/api/estimate-drive`. Configure `GOOGLE_DRIVE_CLIENT_ID`,
`GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI`, and
`GOOGLE_DRIVE_FOLDER_ID` as server-only Vercel variables. Then sign in to the
admin estimate portal and select **Connect Google Drive**. The server requests
the narrow `drive.file` scope with offline access and stores the resulting
refresh token in the RLS-locked integration table; it is never returned to the
browser. `GOOGLE_DRIVE_REDIRECT_URI` must exactly match the Google Cloud OAuth
client redirect URI and should point to
`https://mucciproducts.com/api/google-drive-callback`. The destination folder
must remain private. Supabase stays the primary private file store, so a Drive
outage does not block estimate submission; after a successful mirror, the admin
portal shows an **Open in Google Drive** link. Each quote is stored in a private
subfolder named after its quote code, and retries reuse that folder.

The public Etsy shop destination is set as `etsyUrl` and the private admin
Messages destination is set as `etsyMessagesUrl` in `config.js`. No additional
environment variables are required beyond the existing public Supabase URL and
anon key. Uploaded customer files are private; the admin page creates a
short-lived signed link when the administrator opens a file.

### Estimate review and Etsy preparation

The protected owner area supports exact quote-code
lookup, recent-estimate filters, final price and quantity review, a confirmation
checklist, status changes, and a saved Etsy listing-preparation history. The
**Prepare Etsy Listing** action saves a snapshot and generates copyable title,
price, listing quantity, processing window, customer-safe description, and Etsy
reply text. It does not connect to Etsy, publish a listing, read messages, or
send customer communication. Final Etsy actions remain manual.

Migration `014_etsy_listing_preparation.sql` adds the review fields, model
dimensions, `etsy_prepared` and `declined` statuses, protected admin RPCs, and
the RLS-protected `etsy_listing_preparations` history table. Apply it manually
in Supabase before using the upgraded dashboard. It does not change the private
Storage bucket. Migration `015_server_only_google_admin.sql` removes direct
browser administrator table/RPC access and makes those operations server-only.

Migration `016_admin_operations_dashboard.sql` adds the server-private admin
activity log and the `awaiting_customer`, `accepted`, and `in_production`
estimate statuses used by the operations dashboard. Apply it after migration
015 before using the expanded status control or Activity section. The dashboard
does not create duplicate customer or order tables: Customers are grouped from
the contact details already saved with estimates, and Orders / Projects shows
accepted, in-production, and completed estimate records.

Migration `017_separate_design_and_print_estimates.sql` adds the service intent,
submitted dimension, oversized-part acceptance/section count, and separate
design/printing/total price fields. It keeps
the legacy estimator RPCs available for compatibility while new form
submissions use the component-based calculation and submission RPCs.
Migration `018_estimator_material_and_oversized_upgrade.sql` upgrades databases
where an earlier version of migration 017 was already applied, installs the
current PLA/PETG and oversized-part RPC signatures, and refreshes the PostgREST
schema cache.
Migration `019_reference_images_and_a1_speed_update.sql` adds validated private
reference-image metadata, narrow upload policies, and the submission RPC used
by the attachment-enabled form.
Migration `020_larger_finished_dimensions.sql` raises the no-file finished-part
limit to 2500 mm per dimension while retaining split approval and the existing
64-section safeguard.

The protected admin area is available at `/admin` after Google sign-in and now
includes Dashboard, Requests / Estimates, Orders / Projects, Customers,
Digital Cards, Files, Activity, and Settings & Security. Only sections backed
by existing Mucci Products data are included. All reads and mutations continue
through same-origin Vercel functions that re-check the exact verified Google
email configured as `ADMIN_EMAIL` server-side. Admin pages send `noindex` and `nofollow` directives in both HTML
and response headers.

The customer-facing listing templates, statuses, default listing quantity, and
processing-time mapping are implemented in the server-only
`api/_etsy-listing.js` module. The Etsy destination remains the single
`etsyUrl` value in `config.js`.

## Mucci Digital Cards

The static site now includes a mobile-first NFC digital-card structure:

- `/card/{publicToken}` public capability URL (served by the GitHub Pages `404.html` fallback)
- `/my-cards/` browser-local history containing only cards opened on that device
- a private, unlinked Google-authenticated owner area for card and estimate management
- a Supabase migration with narrow public RPC lookup and Row Level Security
- downloadable vCard contacts plus Apple Wallet and Google Wallet pass endpoints

Contact downloads work entirely in the browser. Wallet passes are generated by Vercel serverless functions because Apple and Google signing credentials must never be exposed to browser code.

### Setup

1. Create a Supabase project and run the SQL files in `supabase/migrations/` in numeric order in its SQL editor.
2. In Supabase Authentication, enable Google and configure the generic callback URL used by the server. Do not enable an administrator password flow.
3. Set `supabaseUrl`, `supabaseAnonKey`, and the final `publicSiteUrl` in `config.js`. The anon key is public by design; never put the service-role key in public configuration.
4. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SITE_URL`, and `ADMIN_EMAIL` as server-only Vercel variables. Set `ADMIN_EMAIL` to the exact Google email address allowed to administer the site. No administrator UUID is required.
5. Keep `/admin` unlinked and keep the administrator identity out of public pages, analytics, sitemap, and robots files. The administrator can create multiple profiles; every profile receives a separate random public card token.
6. Program the displayed `https://mucciproducts.com/card/{token}` URL onto the NFC tag with NFC Tools or NXP TagWriter.

### Wallet pass setup

These are contact/business-card passes, not Apple Pay or Google Pay payment cards. Every pass displays the cardholder name, company branding, a QR link to the live card, and the contact fields stored on the profile.

Add these shared values in **Vercel → Project → Settings → Environment Variables**, then redeploy:

- `SUPABASE_URL`: the same Supabase project URL used by the site
- `SUPABASE_ANON_KEY`: the project's public anon key, not the service-role key
- `PUBLIC_SITE_URL`: `https://mucciproducts.com`

For Apple Wallet:

1. An active Apple Developer Program membership is required.
2. In Certificates, Identifiers & Profiles, create a Pass Type ID and a Pass Type ID certificate.
3. Export the pass certificate and private key as PEM files and download Apple's current WWDR intermediate certificate.
4. Base64-encode the complete file contents and set:
   - `APPLE_PASS_TYPE_IDENTIFIER`
   - `APPLE_TEAM_IDENTIFIER`
   - `APPLE_PASS_CERTIFICATE_BASE64`
   - `APPLE_PASS_PRIVATE_KEY_BASE64`
   - `APPLE_WWDR_CERTIFICATE_BASE64`
   - `APPLE_PASS_PRIVATE_KEY_PASSPHRASE` only when the private key is encrypted

For Google Wallet:

1. Create or use a Google Pay & Wallet Console issuer account and Google Cloud project.
2. Enable the Google Wallet API, create a service account, and add that service account as a **Developer** in the Wallet console.
3. Create a JSON key for that service account. Base64-encode the entire JSON file and set:
   - `GOOGLE_WALLET_ISSUER_ID`
   - `GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64`
4. Google starts new issuers in Demo Mode. Add test accounts while testing, then request publishing access before offering passes to everyone.

The Vercel environment values are secrets. Do not put certificate files, private keys, or the service-account JSON in Git. The public buttons return a clear setup error until the required issuer configuration is present.

### Administrator authentication

Administrator access uses Supabase Google OAuth only. The callback is generic
and contains no private route. Authorization is enforced by the Vercel server
against the exact verified `ADMIN_EMAIL`,
and the account must contain a real Google identity. Browser JavaScript never receives the
service-role key and cannot call administrator tables or RPCs directly. Protect
the authorized Google account with Google 2-Step Verification or a passkey.
Each login attempt carries its own encrypted, ten-minute PKCE state through the
OAuth callback. This prevents repeated or simultaneous sign-in attempts from
overwriting one another; the HttpOnly verifier cookie remains only as a
compatibility fallback.

The `card-assets` public Storage bucket accepts PNG, JPEG, WebP, and SVG files up to 5 MB. Owner uploads use an object path beginning with their Auth UUID. The dashboard supports profile-photo and company-logo uploads after the first profile is created.

### Local testing

Serve the repository through a local HTTP server (opening HTML from `file://` will not emulate routes):

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/card.html?token=sample-preview-2026&preview=1` for a local-only layout preview, or use a configured valid token without the preview parameter. Install the Vercel function dependencies and run the unit tests with:

```powershell
npm install
npm test
```

### Hosting and clean routes

The production site is hosted on Vercel. Configure a rewrite so `/card/{token}` serves `card.html` while preserving the public URL. The included `404.html` remains a fallback for static hosting.

### Security model

Anonymous roles cannot select the `profiles`, `physical_cards`, or `saved_profiles` tables. The `get_public_card_profile` security-definer RPC accepts one token and returns only approved public fields for an active card and active profile. Administrator reads, edits, uploads, and signed-file access pass through same-origin Vercel functions that validate an HttpOnly Supabase session, a linked Google identity, and the exact verified `ADMIN_EMAIL`. Migration 015 revokes direct authenticated administrator table and RPC access. There is no public admin link or browser service-role key.

## Live site

[Visit the Mucci Products website](https://mucciproducts.com/)

## Personalize

The Etsy destination is configured in `script.js`. Project copy and links live in `index.html`.

## Deployment

Vercel is the production host. The legacy GitHub Pages workflow remains in the repository but is not the production domain target.
