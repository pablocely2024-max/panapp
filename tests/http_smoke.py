"""End-to-end HTTP smoke checks for deployed PANAPP portal/API route families."""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar


BASE_URL = os.environ.get("PANAPP_SMOKE_BASE_URL", "http://127.0.0.1:8765").rstrip("/")
TENANT_SLUG = os.environ.get("PANAPP_SMOKE_TENANT_SLUG", "panaderia-principal")
SUPERADMIN_EMAIL = os.environ.get("PANAPP_SUPERADMIN_EMAIL", "")
SUPERADMIN_PASSWORD = os.environ.get("PANAPP_SUPERADMIN_PASSWORD", "")
TENANT_EMAIL = os.environ.get("PANAPP_SMOKE_TENANT_EMAIL", "")
TENANT_PASSWORD = os.environ.get("PANAPP_SMOKE_TENANT_PASSWORD", "")

cookies = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
checked = []


def request(method, path, payload=None, expected=200):
    headers = {"Accept": "application/json, text/html"}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}{path}", data=body, headers=headers, method=method)
    try:
        with opener.open(req, timeout=10) as response:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            data = response.read()
    except urllib.error.HTTPError as error:
        data = error.read()
        raise AssertionError(f"{method} {path}: HTTP {error.code}, expected {expected}: {data[:300]!r}") from error
    if status != expected:
        raise AssertionError(f"{method} {path}: HTTP {status}, expected {expected}: {data[:300]!r}")
    checked.append(f"{method} {path} -> {status}")
    if "application/json" in content_type:
        return json.loads(data)
    return data.decode("utf-8", errors="replace")


def main():
    if not all((SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, TENANT_EMAIL, TENANT_PASSWORD)):
        raise SystemExit(
            "Set PANAPP_SUPERADMIN_EMAIL, PANAPP_SUPERADMIN_PASSWORD, "
            "PANAPP_SMOKE_TENANT_EMAIL and PANAPP_SMOKE_TENANT_PASSWORD."
        )

    request("GET", "/api/health")
    request("GET", "/api/security/provider")
    request("GET", "/superadmin")
    request("GET", "/superadmin.js")
    request("POST", "/api/superadmin/login", {
        "username": SUPERADMIN_EMAIL,
        "password": SUPERADMIN_PASSWORD,
    })
    request("GET", "/api/superadmin/status")
    request("GET", "/api/superadmin/overview")
    request("GET", "/api/superadmin/plans")
    request("GET", "/api/superadmin/tenants")
    request("GET", f"/api/superadmin/tenants/{TENANT_SLUG}/payments")

    request("GET", "/login")
    global_login = request("POST", "/api/security/login", {
        "username": TENANT_EMAIL,
        "password": TENANT_PASSWORD,
    })
    if global_login["tenant"] != TENANT_SLUG:
        raise AssertionError(f"Global login resolved to {global_login['tenant']!r}, expected {TENANT_SLUG!r}")
    request("GET", f"/t/{global_login['tenant']}/admin")

    tenant = f"/t/{TENANT_SLUG}"
    request("GET", f"{tenant}/login")
    request("GET", f"{tenant}/auth.js")
    request("GET", f"{tenant}/menu")
    request("GET", f"{tenant}/menu.js")
    request("GET", f"{tenant}/api/menu")
    request("GET", f"{tenant}/api/security/status")
    request("POST", f"{tenant}/api/security/login", {
        "username": TENANT_EMAIL,
        "password": TENANT_PASSWORD,
    })
    request("GET", f"{tenant}/admin")
    request("GET", f"{tenant}/admin.js")
    request("GET", f"{tenant}/api/state")
    request("POST", f"{tenant}/api/security/logout", {})

    if os.environ.get("PANAPP_SMOKE_MUTATIONS") == "1":
        smoke_slug = f"smoke-{time.time_ns()}"
        request("POST", "/api/superadmin/tenants", {
            "slug": smoke_slug,
            "name": "PANAPP HTTP smoke tenant",
            "owner_email": TENANT_EMAIL,
            "plan": "starter",
            "billing_period": "monthly",
        })
        smoke_tenant = f"/t/{smoke_slug}"
        request("PUT", f"/api/superadmin/tenants/{smoke_slug}/subscription", {
            "plan": "business",
            "billing_period": "annual",
        })
        request("POST", f"/api/superadmin/tenants/{smoke_slug}/payments", {
            "amount": 1000,
            "reference": "http-smoke",
            "status": "paid",
        })
        request("GET", f"/api/superadmin/tenants/{smoke_slug}/payments")
        request("GET", f"{smoke_tenant}/api/menu")
        request("PATCH", f"/api/superadmin/tenants/{smoke_slug}/status", {"status": "suspended"})
        request("GET", f"{smoke_tenant}/api/menu", expected=423)
        request("PATCH", f"/api/superadmin/tenants/{smoke_slug}/status", {"status": "active"})
        request("GET", f"{smoke_tenant}/api/menu")
        request("PATCH", f"/api/superadmin/tenants/{smoke_slug}/status", {"status": "canceled"})
        request("GET", f"{smoke_tenant}/api/menu", expected=423)

    request("POST", "/api/superadmin/logout", {})

    print(f"PASS: {len(checked)} PANAPP HTTP smoke checks returned HTTP 200.")
    for result in checked:
        print(result)


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
