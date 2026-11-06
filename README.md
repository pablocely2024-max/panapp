# PANAPP SaaS

PANAPP is a FastAPI application backed by PostgreSQL/Neon. The owner portal, each bakery tenant, and each public menu have separate routes, authorization checks, and tenant-scoped data.

## Application layers

| Layer | Route | Access |
|---|---|---|
| PANAPP owners | `/superadmin` | `SUPERADMIN` account provisioned from server secrets |
| Bakery administration | `/t/{slug}/login` and `/t/{slug}/admin` | Administrator session belonging to that bakery |
| Public bakery menu | `/t/{slug}/menu` | Public catalog for that bakery only |

The shared `/login` page accepts an administrator email and password, identifies the matching bakery account, and redirects to that bakery's admin panel. Tenant-specific login routes remain available when the bakery is already known.

With `PANAPP_BASE_DOMAIN=panapp.com`, the same tenant routes work on `https://{slug}.panapp.com/...`; `superadmin.panapp.com/superadmin` remains the global portal. A trusted reverse proxy must preserve the bakery subdomain in `Host`. Localhost and path-based `/t/{slug}` routing are supported for development.

## Server and database

- Python 3.11+
- FastAPI and Uvicorn
- PostgreSQL 14+; Neon is supported

Set either `DATABASE_URL` (recommended for Neon) or all of these variables. When all `PANAPP_DB_*` variables are set, they take precedence over `DATABASE_URL`; Neon hosts automatically use TLS (`sslmode=require`) with either configuration.

```text
PANAPP_DB_HOST
PANAPP_DB_PORT
PANAPP_DB_NAME
PANAPP_DB_USER
PANAPP_DB_PASSWORD
```

You can optionally override Neon TLS behavior with `PANAPP_DB_SSLMODE`. Never put placeholder values or real passwords in source control.

To start the app directly with Uvicorn from PowerShell:

```powershell
.\start-panapp.ps1
```

Store the PostgreSQL connection string as `DATABASE_URL` in the ignored `.env.local` file. The project Python environment must be installed and usable before running this command. FastAPI initializes/migrates the database schema on application startup.

### HTTPS on this computer (local development)

To open the same local PANAPP pages using a browser-trusted `https://localhost` certificate, install `mkcert` and its local development CA:

```powershell
winget install --id FiloSottile.mkcert -e
# Close and reopen PowerShell after installation.
mkcert -install
Set-Location 'C:\Users\varga\Downloads\Proyecto panaderia\Proyecto panaderia'
New-Item -ItemType Directory -Force .devcert | Out-Null
mkcert -cert-file .devcert\localhost.pem -key-file .devcert\localhost-key.pem localhost 127.0.0.1 ::1
.\start-panapp.ps1
```

If PowerShell blocks scripts, start it with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-panapp.ps1`. Once the server starts, open `https://localhost:8765`. PANAPP's launcher enables TLS automatically when both local certificate files exist. The `.devcert` directory is ignored by Git because the private key must stay local. This setup is only for this computer; public HTTPS requires a real domain and an HTTPS reverse proxy with a publicly trusted certificate. It does not expose PANAPP to the internet.

### Repairing Python on Windows

If `.venv\Scripts\python.exe` reports that it cannot find its base interpreter, the virtual environment is stale. Install Python 3.11 for your Windows user, then open a new PowerShell window and run the project launcher; it will ignore Windows Store execution aliases and create a fresh ignored virtual environment without deleting the old one:

```powershell
winget install --id Python.Python.3.11 -e --scope user
# Close and reopen PowerShell after installation.
.\start-panapp.ps1
```

The launcher installs the packages from `requirements.txt` into the new environment if needed. If `winget` is unavailable, install Python 3.11 or newer from python.org with the Python launcher enabled, then reopen PowerShell and run `.\start-panapp.ps1`.

The database user needs permission to create and migrate tables. PANAPP creates the SaaS schema at startup. Tenant-owned state, users, sessions, subscriptions, payments, and orders are associated with `panaderia_id`; state reads and writes always filter by the authenticated tenant ID. Platform plans and super-admin identities are global platform data, not tenant operations.

The migration preserves the existing `panapp_state` and the existing administrator credentials by assigning them to `PANAPP_LEGACY_TENANT_SLUG` (default `panaderia-principal`). It does not erase the old security table. Back up Neon before deploying schema changes.

### Neon Auth and the app database

The PostgreSQL connection string and the Neon Auth HTTPS endpoint are different services. Keep the PostgreSQL connection string in the ignored `.env.local` file as `DATABASE_URL`; do not use a `neonauth` URL as `DATABASE_URL`. Configure the public Neon Auth URL separately:

```text
PANAPP_NEON_AUTH_URL=https://ep-lucky-lake-b8de2v7l.neonauth.c-14.us-east-1.aws.neon.tech/neondb/auth
PANAPP_NEON_AUTH_ISSUER=https://ep-lucky-lake-b8de2v7l.neonauth.c-14.us-east-1.aws.neon.tech/neondb/auth
PANAPP_NEON_AUTH_AUDIENCE=authenticated
```

The app validates Neon Auth's EdDSA-signed JWT with the endpoint's JWKS at `/.well-known/jwks.json`, and verifies its issuer, audience, and expiration. Override the issuer or audience only with the exact values configured by Neon Auth. Add the app's local and deployed HTTPS origins to the allowed origins in Neon Auth, and require email verification. For the Render service, the exact production origin is `https://panapp-92vz.onrender.com` (no trailing slash or path). An `Invalid origin` response is returned by Neon Auth before PANAPP can create an account, send a code, or validate a password; add the origin in Neon Auth's allowed-origin settings and retry.

For email verification codes and password-reset links, open Neon Console → **Settings → Better Auth** and enable email/password sign-up, **Verify at Sign-up**, and the verification-code method. Configure a dedicated SMTP provider for production email delivery. Enable **Revoke sessions on password reset**. After Super Admin authorizes the address, the administrator opens the invitation, chooses **Crear cuenta y recibir código**, and enters the code delivered to that authorized email. A verified but unprovisioned address cannot enter a tenant. Password recovery uses a one-time email link (15-minute expiry), not security questions or passwords sent by email.

Super Admin continues to use its existing separate PANAPP session. For bakery administrators, Super Admin provisions an allowed email in `panapp_users`; the user creates their Neon Auth account from that bakery's login page. PANAPP only links an email-verified Neon identity to an already-authorized bakery account, and the database stores the identity's Neon `sub` for subsequent logins. Unprovisioned email addresses cannot access a bakery. Existing local password hashes are retained for migration history, but bakery login and password changes use Neon Auth. A Neon Auth account must be created/verified before an existing bakery administrator can log in.

The browser auth page uses the official `@neondatabase/auth` client via a version-pinned ESM CDN import. FastAPI exchanges the verified Neon token for the existing PANAPP `HttpOnly` session cookie, so the tenant API and PostgreSQL access rules stay server-side. This project intentionally does **not** configure the Neon Data API or its `VITE_NEON_DATA_API_URL`: it has no Vite/React frontend and continues to query PostgreSQL through FastAPI. The Data API example requires a separate migration of queries and Row Level Security policies; its URL alone would not integrate it.

The public key endpoint used to verify a Neon Auth JWT is:
```text
https://ep-lucky-lake-b8de2v7l.neonauth.c-14.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json
```

Never accept a decoded JWT without verifying its signature against the JWKS and validating its issuer and audience. Do not put database credentials or private keys in browser configuration; the Neon Auth URL, issuer, and audience are public identifiers.

## Owner provisioning and access

Provision the first PANAPP owner through deployment secrets:

```text
PANAPP_SUPERADMIN_EMAIL
PANAPP_SUPERADMIN_PASSWORD
```

Use an email and a password of at least 12 characters. On first startup, PANAPP hashes the password and creates the owner if no matching owner exists. There is no public owner registration. Do not expose `.env.local` or commit secrets.

Sign in at `/superadmin` to create a bakery tenant, provision its administrator, choose a monthly or annual plan, suspend/reactivate/cancel service, and record or review payments. Tenant accounts are scoped to their bakery. The global owner session and bakery session use separate `HttpOnly` cookies.

For each bakery account, Super Admin authorizes the administrator's email. When SMTP is configured, PANAPP sends a single-use invitation link; the administrator creates a Neon Auth account with the authorized email and verifies it before signing in. Without SMTP, Super Admin receives the invitation link to share securely. The invitation expires after seven days and is required to link a new Neon identity. Legacy PANAPP password hashes are checked only to begin migration; a verified Neon Auth account is still required to create a session.

Configure these server-side environment variables to send invitation emails:

```text
PANAPP_SMTP_HOST
PANAPP_SMTP_PORT=587
PANAPP_SMTP_USER
PANAPP_SMTP_PASSWORD
PANAPP_SMTP_FROM
PANAPP_SMTP_USE_SSL=false
```

Port 587 uses STARTTLS by default. Set `PANAPP_SMTP_USE_SSL=true` for an SMTP-over-SSL provider such as port 465. If delivery fails, the administrator remains authorized and Super Admin can copy the single-use invitation link from the displayed result.

PANAPP records subscription plans and manually registered payment references; it does not connect to a payment processor or issue electronic tax invoices. MRR is an estimate based on active subscriptions, with annual plans prorated over 12 months. A tenant whose subscription period expires is suspended on its next tenant request.
Recording a payment with status `paid` reactivates a non-canceled tenant and extends its current subscription by one billing period. Canceled tenants cannot be reactivated by payment entry.
Super Admin can review the latest 100 payment records per bakery and download a monthly CSV of paid subscription revenue. The report filters by `paid_at` in the `America/Bogota` time zone.

Super-admin passwords are hashed with PBKDF2-HMAC-SHA256; tenant passwords are managed by Neon Auth. PANAPP sessions are stored in PostgreSQL, expire after eight hours, and are revoked when a tenant is suspended or canceled.
The [cookie policy](./cookie-policy.html) describes the essential HttpOnly session cookies; PANAPP does not use advertising or analytics cookies.

## Tenant operations and public orders

The bakery dashboard remains at `/t/{slug}/admin` and reads/writes that tenant's JSONB state row. The menu endpoint `/t/{slug}/api/menu` is an allow-listed public projection: it never returns provider records, recipes/costs, inventory costs, sales, shrinkage, or special orders.

Each tenant receives a random, unique public menu URL at `/m/{menu_token}`. Its QR endpoint is `/m/{menu_token}/qr.svg`; the legacy `/t/{slug}/menu` route redirects to that URL. The public menu submits validated orders to `/m/{menu_token}/api/menu/orders`. The API resolves product prices from that tenant's catalog, records the order under `panaderia_id`, and returns a WhatsApp deep link when the bakery has configured a valid international number. The order is initially recorded as `received`; staff must confirm availability and fulfillment.

Each tenant has a distinct public menu URL at `/t/{slug}/menu`. Super Admin generates the slug from the bakery name and shows the full public URL and a downloadable SVG QR code. The URL uses the active public host (Render's `onrender.com` hostname or a configured custom domain).

## Sprint 4 implementation checklist

- **Backend:** PostgreSQL configuration supports `DATABASE_URL` and individual `PANAPP_DB_*` settings. FastAPI exposes health, authentication, tenant administration, catalog, and order APIs. Session tokens are random, stored as hashes, and delivered in `HttpOnly` cookies.
- **Logic and validation:** API request models enforce required fields, lengths, numeric bounds, and enumerated values. Tenant slugs are normalized and checked against invalid and reserved names. `tests/test_business_logic.py` covers these rules and verifies that the public catalog only exposes its allow-listed product fields.
- **Data:** The dashboard starts with local demonstration data and synchronizes tenant state with PostgreSQL; the public menu reads the current tenant catalog from the API.
- **Views and visual system:** `admin.html`, `menu.html`, `auth.html`, and `superadmin.html` separate the application views. Shared colors and the DM Sans/Fraunces typography are defined in `styles.css`. `.media-frame--16-9` and `.media-frame--9-16` provide responsive landscape and portrait image frames; images fill their frame with `object-fit: cover`. No fixed pixel resolution is assumed.

## Deployment

Run locally on `127.0.0.1:8765`:

```powershell
.\start-panapp.ps1
```

### Render

Create a Render **Web Service** from the project repository and use:

```text
Build command: pip install -r requirements.txt
Start command: python saas_app.py
```

Render supplies `PORT`, `RENDER_EXTERNAL_HOSTNAME`, and `RENDER_EXTERNAL_URL`; PANAPP uses them to bind to the public interface, listen on Render's assigned port, and allow the service hostname. If those Render hostname variables are unavailable in a deployment, set `PANAPP_BASE_DOMAIN` to the exact service hostname (for example, `panapp.onrender.com`, without `https://`). Add `DATABASE_URL` in the Render environment using the Neon PostgreSQL connection string. When using `DATABASE_URL`, remove any `PANAPP_DB_HOST`, `PANAPP_DB_PORT`, `PANAPP_DB_NAME`, `PANAPP_DB_USER`, and `PANAPP_DB_PASSWORD` variables from Render; a complete set of those variables takes precedence over `DATABASE_URL`. If using separate database variables instead, `PANAPP_DB_PORT` must be a number such as `5432`. Do not set `PANAPP_PORT` on Render; the app must use Render's assigned `PORT`. For custom domains, add them to `PANAPP_ALLOWED_HOSTS` and set `PANAPP_BASE_DOMAIN` to the bakery subdomain base only when using tenant subdomains.

For a self-managed deployment behind a public HTTPS reverse proxy (not Render), configure:

```text
PANAPP_HOST=0.0.0.0
PANAPP_PORT=8765
PANAPP_BASE_DOMAIN=panapp.panaderiass.com
PANAPP_ALLOWED_HOSTS=panapp.com,superadmin.panapp.com
PANAPP_TRUSTED_PROXIES=127.0.0.1
```

Add the wildcard tenant DNS record (`*.panapp.com`) and route it and `superadmin.panapp.com` to the HTTPS reverse proxy. Restrict backend access to that proxy and set `PANAPP_TRUSTED_PROXIES` to its actual trusted IPs. The proxy must overwrite forwarded headers; never expose the app or PostgreSQL port directly to the public internet.

### Keeping Neon compute active

The app's startup initializes the schema; it does not control Neon compute auto-suspend. Neon Free suspends idle compute after five minutes and cannot disable that behavior. To keep Neon active, use a paid plan that supports it and disable **Scale to zero** for the database compute in Neon Console → select the branch → **Computes → Edit**. This can increase database compute charges. Otherwise, Neon wakes automatically on the next query; no artificial keep-alive loop is recommended.

## HTTP smoke checks

Run the local logic and database-connection tests with:

```powershell
.\.venv-neon\Scripts\python.exe -m unittest discover -s tests
```

Start PANAPP and configure credentials for an existing active tenant in the same PowerShell session, then run:

```powershell
$env:PANAPP_SMOKE_TENANT_SLUG = 'panaderia-principal'
$env:PANAPP_SMOKE_TENANT_EMAIL = 'admin@example.com'
$env:PANAPP_SMOKE_TENANT_PASSWORD = '<tenant password>'
$env:PANAPP_NEON_AUTH_URL = 'https://ep-lucky-lake-b8de2v7l.neonauth.c-14.us-east-1.aws.neon.tech/neondb/auth'
$env:PANAPP_SUPERADMIN_EMAIL = 'owner@example.com'
$env:PANAPP_SUPERADMIN_PASSWORD = '<owner password>'
.\.venv-neon\Scripts\python.exe .\tests\http_smoke.py
```

The script sends real HTTP requests and checks HTTP 200 on health, portal pages, authentication, plans, metrics, tenant catalog, and the authenticated tenant dashboard/state endpoints. By default it does not change subscription or bakery records. Configure `PANAPP_SMOKE_BASE_URL` when the service is not on localhost.

The tenant smoke account must already exist in Neon Auth, have a verified email, and be authorized in that tenant by Super Admin. Mutation smoke tests create and later suspend/cancel a temporary tenant; they additionally require a separately verified Neon Auth identity that is not already linked to another PANAPP user:

```powershell
$env:PANAPP_SMOKE_MUTATIONS = '1'
$env:PANAPP_SMOKE_MUTATION_EMAIL = 'smoke-admin@example.com'
$env:PANAPP_SMOKE_MUTATION_PASSWORD = '<verified Neon Auth password>'
```
