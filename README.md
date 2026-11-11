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

### Bakery administrator passwords and the app database

PANAPP bakery-admin access uses its own backend password authentication and does not call Neon Auth from the browser. Neon PostgreSQL remains the app database; keep its connection string in the ignored `.env.local` file as `DATABASE_URL`.

When Super Admin creates a bakery or configures its administrator, PANAPP generates a random temporary password and displays it with the administrator login link and the bakery's menu/QR links. Share the password securely; the administrator can log in immediately and change it later in **Seguridad**. PANAPP stores only its PBKDF2-HMAC-SHA256 hash and does not send passwords by email.

## Owner provisioning and access

Provision the first PANAPP owner through deployment secrets:

```text
PANAPP_SUPERADMIN_EMAIL
PANAPP_SUPERADMIN_PASSWORD
```

Use an email and a password of at least 12 characters. On first startup, PANAPP hashes the password and creates the owner if no matching owner exists. There is no public owner registration. Do not expose `.env.local` or commit secrets.

Sign in at `/superadmin` to create a bakery tenant, provision its administrator, choose a monthly or annual plan, suspend/reactivate/cancel service, and record or review payments. Creating or reconfiguring an administrator generates a new temporary password and revokes existing sessions; deliver the password securely because it is shown only in the Super Admin result. The result also includes the admin login link, public menu link, and existing QR download link. Tenant accounts are scoped to their bakery. The global owner session and bakery session use separate `HttpOnly` cookies.

PANAPP records subscription plans and manually registered payment references; it does not connect to a payment processor or issue electronic tax invoices. MRR is an estimate based on active subscriptions, with annual plans prorated over 12 months. A tenant whose subscription period expires is suspended on its next tenant request.
Recording a payment with status `paid` reactivates a non-canceled tenant and extends its current subscription by one billing period. Canceled tenants cannot be reactivated by payment entry.
Super Admin can review the latest 100 payment records per bakery, preview paid subscription revenue by month, and download a CSV. The report filters by `paid_at` in the `America/Bogota` time zone.

Super-admin and tenant passwords are hashed with PBKDF2-HMAC-SHA256. PANAPP sessions are stored in PostgreSQL, expire after five minutes of inactivity or eight hours total, and are revoked when a tenant is suspended or canceled.
The [cookie policy](./cookie-policy.html) describes the essential HttpOnly session cookies; PANAPP does not use advertising or analytics cookies.

## Automatic GitHub sync

When this project is opened as a VS Code folder, the `PANAPP: sincronizar cambios con GitHub` background task watches for edits. After five seconds without saves, it creates a commit and pushes it to `origin/main`. The watcher only stages selected source, test, documentation, and configuration extensions; it excludes `.env*`, local virtual environments, private-key/credential-named files, and `.vscode/settings.json`. Manually staged changes pause the automatic commit so they are not mixed in. If the task does not start, use **Terminal → Run Task → PANAPP: sincronizar cambios con GitHub** and allow automatic tasks for this trusted workspace.

GitHub still receives every committed change, so do not place secrets in source files. Keep credentials in Render/Neon environment settings or ignored local environment files. The watcher uses the existing Git credentials and retries failed pushes every 30 seconds; errors appear in the task terminal.

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
$env:PANAPP_SUPERADMIN_EMAIL = 'owner@example.com'
$env:PANAPP_SUPERADMIN_PASSWORD = '<owner password>'
.\.venv-neon\Scripts\python.exe .\tests\http_smoke.py
```

The script sends real HTTP requests and checks HTTP 200 on health, portal pages, authentication, plans, metrics, tenant catalog, and the authenticated tenant dashboard/state endpoints. By default it does not change subscription or bakery records. Configure `PANAPP_SMOKE_BASE_URL` when the service is not on localhost.

The tenant smoke account must have an existing PANAPP password and be authorized in that tenant by Super Admin. Mutation smoke tests create and later suspend/cancel a temporary tenant and register a test payment. They require a Super Admin login, but do not require a separate Neon Auth identity:

```powershell
$env:PANAPP_SMOKE_MUTATIONS = '1'
```
