import unittest
from datetime import datetime, timedelta, timezone
import os
import smtplib
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
import jwt
from pydantic import ValidationError
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from starlette.requests import Request
from starlette.responses import Response

from saas_app import (
    NEON_AUTH_AUDIENCE,
    NEON_AUTH_ISSUER,
    EmailCodeRequestBody,
    EmailCodeVerifyBody,
    PaymentBody,
    PublicOrderBody,
    TenantAdminBody,
    TenantCreateBody,
    provision_tenant_admin,
    public_catalog,
    resolve_public_hostname,
    send_smtp_email,
    send_tenant_admin_recovery_code,
    superadmin_tenants,
    subscription_revenue_report,
    subscription_revenue_summary,
    request_global_tenant_email_code,
    tenant_menu_qr,
    tenant_menu_url,
    validate_slug,
    verify_global_tenant_email_code,
    hash_token,
    verify_legacy_tenant_credentials,
    neon_tenant_login,
    verify_neon_access_token,
    current_session,
    SESSION_IDLE_TIMEOUT_MINUTES,
    TENANT_SESSION_COOKIE,
)


class SlugValidationTests(unittest.TestCase):
    def test_normalizes_valid_slug(self):
        self.assertEqual(validate_slug("  Mi-Panaderia  "), "mi-panaderia")

    def test_rejects_reserved_slug(self):
        with self.assertRaises(HTTPException) as error:
            validate_slug("admin")

        self.assertEqual(error.exception.status_code, 422)

    def test_rejects_invalid_slug(self):
        for slug in ("", "-panaderia", "mi_panaderia", "panaderia-"):
            with self.subTest(slug=slug), self.assertRaises(HTTPException):
                validate_slug(slug)


class PublicMenuUrlTests(unittest.TestCase):
    def test_uses_render_external_url_when_hostname_is_not_set(self):
        self.assertEqual(
            resolve_public_hostname("", "", "https://panapp.onrender.com"),
            "panapp.onrender.com",
        )
        self.assertEqual(
            resolve_public_hostname("  ", "panapp.onrender.com", ""),
            "panapp.onrender.com",
        )

    def test_configured_domain_takes_precedence(self):
        self.assertEqual(
            resolve_public_hostname("menus.example.com", "panapp.onrender.com", ""),
            "menus.example.com",
        )

    def test_menu_url_contains_the_random_token_and_public_origin(self):
        request = Request({
            "type": "http",
            "method": "GET",
            "path": "/t/panaderia-central/menu",
            "headers": [(b"host", b"panapp.onrender.com")],
            "scheme": "https",
            "server": ("panapp.onrender.com", 443),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

        self.assertEqual(
            tenant_menu_url(request, "a-random-menu-token-123"),
            "https://panapp.onrender.com/m/a-random-menu-token-123",
        )

    @patch("saas_app.tenant_by_slug", return_value={"slug": "panaderia-central", "menu_token": "a-random-menu-token-123"})
    def test_menu_qr_route_returns_an_svg_download(self, tenant_by_slug):
        request = Request({
            "type": "http",
            "method": "GET",
            "path": "/t/panaderia-central/menu/qr.svg",
            "headers": [(b"host", b"panapp.onrender.com")],
            "scheme": "https",
            "server": ("panapp.onrender.com", 443),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

        response = tenant_menu_qr("panaderia-central", request)

        self.assertEqual(response.media_type, "image/svg+xml")
        self.assertIn("panaderia-central-menu-qr.svg", response.headers["content-disposition"])
        self.assertIn(b"<svg", response.body)
        tenant_by_slug.assert_called_once_with("panaderia-central")


class RequestValidationTests(unittest.TestCase):
    def test_accepts_valid_tenant_configuration(self):
        tenant = TenantCreateBody(
            slug="panaderia-central",
            name="Panadería Central",
            owner_email="owner@example.test",
            plan="starter",
            billing_period="monthly",
        )

        self.assertEqual(tenant.plan, "starter")
        self.assertEqual(tenant.billing_period, "monthly")
        self.assertIsNone(tenant.owner_password)

    def test_rejects_short_tenant_password_and_unknown_plan(self):
        valid_tenant = {
            "slug": "panaderia-central",
            "name": "Panadería Central",
            "owner_email": "owner@example.test",
            "owner_password": "short",
            "plan": "starter",
            "billing_period": "monthly",
        }
        with self.assertRaises(ValidationError):
            TenantCreateBody(**valid_tenant)

        valid_tenant["owner_password"] = "a-strong-password"
        valid_tenant["plan"] = "enterprise"
        with self.assertRaises(ValidationError):
            TenantCreateBody(**valid_tenant)

    def test_order_requires_valid_quantity_and_at_least_one_item(self):
        order = PublicOrderBody(
            customer_name="Cliente de prueba",
            order_type="pickup",
            items=[{"product_id": 12, "quantity": 2}],
        )
        self.assertEqual(order.items[0].quantity, 2)

        with self.assertRaises(ValidationError):
            PublicOrderBody(
                customer_name="Cliente de prueba",
                order_type="pickup",
                items=[{"product_id": 12, "quantity": 0}],
            )
        with self.assertRaises(ValidationError):
            PublicOrderBody(
                customer_name="Cliente de prueba",
                order_type="pickup",
                items=[],
            )

    def test_rejects_negative_payment_amount(self):
        with self.assertRaises(ValidationError):
            PaymentBody(amount=-1, reference="test", status="paid")


class PublicCatalogTests(unittest.TestCase):
    @patch("saas_app.read_tenant_state")
    def test_returns_dynamic_public_fields_without_internal_product_data(self, read_state):
        read_state.return_value = {
            "revision": 4,
            "data": {
                "perfilEmpresa": {"nombre": "Panadería Central", "moneda": "COP"},
                "productos": [
                    {
                        "id": 12,
                        "nombre": "Pan campesino",
                        "precio": 4500,
                        "categoria": "Panes",
                        "stock": 3,
                        "costoProd": 1800,
                        "receta": "Harina y levadura",
                    },
                    "invalid product entry",
                ],
                "proveedores": [{"empresa": "Private supplier"}],
            },
        }

        catalog = public_catalog("tenant-id")

        self.assertEqual(catalog["revision"], 4)
        self.assertEqual(catalog["business"]["nombre"], "Panadería Central")
        self.assertEqual(
            catalog["products"],
            [{
                "id": 12,
                "nombre": "Pan campesino",
                "precio": 4500,
                "categoria": "Panes",
                "disponible": True,
            }],
        )
        self.assertNotIn("proveedores", catalog)

    @patch("saas_app.read_tenant_state", return_value={"revision": 0, "data": None})
    def test_uses_tenant_name_when_business_profile_is_not_configured(self, read_state):
        catalog = public_catalog("tenant-id", "Panadería La Central")

        self.assertEqual(catalog["business"]["nombre"], "Panadería La Central")
        self.assertEqual(catalog["products"], [])

    @patch("saas_app.read_tenant_state")
    def test_replaces_default_panapp_brand_with_tenant_name(self, read_state):
        read_state.return_value = {
            "revision": 1,
            "data": {"perfilEmpresa": {"nombre": "Panadería PANAPP"}},
        }

        catalog = public_catalog("tenant-id", "Panadería La Central")

        self.assertEqual(catalog["business"]["nombre"], "Panadería La Central")


class SmtpEmailTests(unittest.TestCase):
    @patch.dict(os.environ, {"PANAPP_SMTP_PASSWORD": "test-app-password"}, clear=True)
    @patch("saas_app.smtplib.SMTP")
    def test_uses_company_gmail_defaults_and_confirms_smtp_acceptance(self, smtp):
        server = smtp.return_value.__enter__.return_value
        server.send_message.return_value = {}

        self.assertTrue(send_smtp_email("admin@example.test", "Código", "Contenido"))

        smtp.assert_called_once_with("smtp.gmail.com", 587, timeout=8)
        server.login.assert_called_once_with("panappanaderias@gmail.com", "test-app-password")
        message = server.send_message.call_args.args[0]
        self.assertEqual(message["From"], "panappanaderias@gmail.com")
        self.assertEqual(message["To"], "admin@example.test")

    @patch.dict(os.environ, {"PANAPP_SMTP_PASSWORD": "test-app-password"}, clear=True)
    @patch("saas_app.smtplib.SMTP")
    def test_rejects_message_when_smtp_refuses_recipient(self, smtp):
        server = smtp.return_value.__enter__.return_value
        server.send_message.return_value = {"admin@example.test": (550, b"mailbox unavailable")}

        with self.assertRaises(smtplib.SMTPRecipientsRefused):
            send_smtp_email("admin@example.test", "Código", "Contenido")


class IdleSessionTests(unittest.TestCase):
    def request(self, method="GET", path="/t/panaderia-central/api/state"):
        return Request({
            "type": "http",
            "method": method,
            "path": path,
            "headers": [
                (b"host", b"testserver"),
                (b"cookie", f"{TENANT_SESSION_COOKIE}=session-token".encode()),
            ],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

    @patch("saas_app.connect_db")
    def test_background_state_poll_does_not_extend_idle_timeout(self, connect_db):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.side_effect = [
            MagicMock(fetchone=MagicMock(return_value=("tenant", uuid4(), uuid4(), "ADMIN_PANADERIA"))),
            MagicMock(fetchone=MagicMock(return_value=("admin@example.test",))),
        ]
        connect_db.return_value = connection

        identity = current_session(self.request())

        self.assertEqual(identity["username"], "admin@example.test")
        query, parameters = connection.execute.call_args_list[0].args
        self.assertIn("last_activity_at > NOW()", query)
        self.assertEqual(parameters[0], False)
        self.assertEqual(parameters[2], SESSION_IDLE_TIMEOUT_MINUTES)

    @patch("saas_app.connect_db")
    def test_authenticated_user_action_refreshes_idle_timeout(self, connect_db):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.side_effect = [
            MagicMock(fetchone=MagicMock(return_value=("tenant", uuid4(), uuid4(), "ADMIN_PANADERIA"))),
            MagicMock(fetchone=MagicMock(return_value=("admin@example.test",))),
        ]
        connect_db.return_value = connection

        self.assertIsNotNone(current_session(self.request("POST", "/t/panaderia-central/api/security/activity")))

        self.assertTrue(connection.execute.call_args_list[0].args[1][0])


class AdminRecoveryCodeTests(unittest.TestCase):
    @patch("saas_app.request_tenant_email_code", return_value={"ok": True, "message": "accepted"})
    @patch("saas_app.tenant_by_slug", return_value={"id": str(uuid4()), "slug": "panaderia-central"})
    @patch("saas_app.connect_db")
    def test_superadmin_can_send_code_only_to_authorized_tenant_email(
        self,
        connect_db,
        tenant_by_slug,
        request_code,
    ):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchone.return_value = (1,)
        connect_db.return_value = connection
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/superadmin/tenants/panaderia-central/admin/recovery-code",
            "headers": [(b"host", b"testserver"), (b"origin", b"http://testserver")],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

        result = send_tenant_admin_recovery_code(
            "panaderia-central",
            EmailCodeRequestBody(username="Admin@example.test"),
            request,
            {},
        )

        self.assertEqual(result["message"], "accepted")
        request_code.assert_called_once_with(
            EmailCodeRequestBody(username="admin@example.test"),
            request,
            "panaderia-central",
        )
        self.assertEqual(connection.execute.call_args.args[1][1], "admin@example.test")

    @patch("saas_app.connect_db")
    def test_superadmin_cannot_send_recovery_code_to_unapproved_email(self, connect_db):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchone.return_value = None
        connect_db.return_value = connection
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/superadmin/tenants/panaderia-central/admin/recovery-code",
            "headers": [(b"host", b"testserver"), (b"origin", b"http://testserver")],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

        with (
            patch("saas_app.tenant_by_slug", return_value={"id": str(uuid4()), "slug": "panaderia-central"}),
            patch("saas_app.request_tenant_email_code") as request_code,
        ):
            with self.assertRaises(HTTPException) as error:
                send_tenant_admin_recovery_code(
                    "panaderia-central",
                    EmailCodeRequestBody(username="unknown@example.test"),
                    request,
                    {},
                )

        self.assertEqual(error.exception.status_code, 404)
        request_code.assert_not_called()


class SuperAdminTenantListTests(unittest.TestCase):
    @patch("saas_app.connect_db")
    def test_includes_authorized_admin_email_for_recovery(self, connect_db):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = [
            (
                uuid4(),
                "panaderia-central",
                "Panadería Central",
                "active",
                datetime(2026, 1, 1, tzinfo=timezone.utc),
                "random-menu-token",
                "monthly",
                "active",
                "starter",
                "Inicial",
                10000,
                100000,
                "admin@example.test",
            )
        ]
        connect_db.return_value = connection

        tenants = superadmin_tenants({})

        self.assertEqual(tenants[0]["admin_email"], "admin@example.test")
        self.assertEqual(connection.execute.call_args.args[1], ("ADMIN_PANADERIA",))


class AdminProvisioningTests(unittest.TestCase):
    def request(self):
        return Request({
            "type": "http",
            "method": "POST",
            "path": "/api/superadmin/tenants/panaderia-central/admin",
            "headers": [(b"host", b"testserver")],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

    @patch("saas_app.tenant_by_slug")
    @patch("saas_app.connect_db")
    def test_provisioning_returns_temporary_password_and_menu_links(self, connect_db, tenant_by_slug):
        from saas_app import password_hash

        tenant_id = uuid4()
        user_id = uuid4()
        tenant_by_slug.return_value = {
            "id": str(tenant_id),
            "slug": "panaderia-central",
            "name": "Panadería Central",
            "menu_token": "abcdefghijklmnopqrstuvwx",
        }
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchone.return_value = (user_id,)
        connect_db.return_value = connection

        result = provision_tenant_admin(
            "panaderia-central",
            TenantAdminBody(username=" Admin@example.test "),
            self.request(),
            {},
        )

        self.assertGreaterEqual(len(result["temporary_password"]), 24)
        self.assertEqual(result["username"], "admin@example.test")
        self.assertEqual(result["menu_url"], "http://testserver/m/abcdefghijklmnopqrstuvwx")
        self.assertEqual(result["menu_qr_url"], f"{result['menu_url']}/qr.svg")
        self.assertEqual(result["admin_login_url"], "http://testserver/t/panaderia-central/login")
        insert_sql, parameters = connection.execute.call_args_list[0].args
        self.assertIn("must_change_password", insert_sql)
        self.assertTrue(parameters[-1] == "ADMIN_PANADERIA")
        self.assertEqual(password_hash(result["temporary_password"], bytes.fromhex(parameters[3])), parameters[4])


class NeonTokenVerificationTests(unittest.TestCase):
    def create_token(self, private_key):
        now = datetime.now(timezone.utc)
        return jwt.encode(
            {
                "sub": "neon-user-id",
                "email": "admin@example.test",
                "email_verified": True,
                "iss": NEON_AUTH_ISSUER,
                "aud": NEON_AUTH_AUDIENCE,
                "iat": now,
                "exp": now + timedelta(minutes=5),
            },
            private_key,
            algorithm="EdDSA",
        )

    @patch("saas_app.neon_jwks_client.get_signing_key_from_jwt")
    def test_accepts_signed_neon_identity(self, get_signing_key):
        private_key = Ed25519PrivateKey.generate()
        get_signing_key.return_value = SimpleNamespace(key=private_key.public_key())

        claims = verify_neon_access_token(self.create_token(private_key))

        self.assertEqual(claims["sub"], "neon-user-id")
        self.assertTrue(claims["email_verified"])

    @patch("saas_app.neon_jwks_client.get_signing_key_from_jwt")
    def test_rejects_token_signed_by_an_untrusted_key(self, get_signing_key):
        trusted_key = Ed25519PrivateKey.generate()
        attacker_key = Ed25519PrivateKey.generate()
        get_signing_key.return_value = SimpleNamespace(key=trusted_key.public_key())

        with self.assertRaises(HTTPException) as error:
            verify_neon_access_token(self.create_token(attacker_key))

        self.assertEqual(error.exception.status_code, 401)

    @patch("saas_app.neon_jwks_client.get_signing_key_from_jwt")
    def test_rejects_wrong_audience(self, get_signing_key):
        private_key = Ed25519PrivateKey.generate()
        get_signing_key.return_value = SimpleNamespace(key=private_key.public_key())
        now = datetime.now(timezone.utc)
        token = jwt.encode(
            {
                "sub": "neon-user-id",
                "email": "admin@example.test",
                "email_verified": True,
                "iss": NEON_AUTH_ISSUER,
                "aud": "wrong-audience",
                "iat": now,
                "exp": now + timedelta(minutes=5),
            },
            private_key,
            algorithm="EdDSA",
        )

        with self.assertRaises(HTTPException) as error:
            verify_neon_access_token(token)

        self.assertEqual(error.exception.status_code, 401)


class NeonTenantLoginTests(unittest.TestCase):
    def request(self):
        return Request({
            "type": "http",
            "method": "POST",
            "path": "/api/security/neon/session",
            "headers": [
                (b"host", b"testserver"),
                (b"origin", b"http://testserver"),
                (b"authorization", b"Bearer test-token"),
            ],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

    def test_requires_verified_email_before_linking_user(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = []
        with (
            patch(
                "saas_app.verify_neon_access_token",
                return_value={"sub": "neon-user-id", "email": "admin@example.test"},
            ),
            patch("saas_app.connect_db") as connect_db,
        ):
            connect_db.return_value = connection
            with self.assertRaises(HTTPException) as error:
                neon_tenant_login(self.request(), Response())

        self.assertEqual(error.exception.status_code, 403)
        connection.execute.assert_called_once()

    def test_links_verified_email_to_provisioned_tenant_user(self):
        user_id, tenant_id = uuid4(), uuid4()
        user = (user_id, tenant_id, "admin@example.test", "ADMIN_PANADERIA", "panaderia-central")
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.side_effect = [
            MagicMock(fetchall=MagicMock(return_value=[])),
            MagicMock(fetchall=MagicMock(return_value=[(*user, None)])),
            MagicMock(fetchone=MagicMock(return_value=None)),
            MagicMock(),
            MagicMock(fetchone=MagicMock(return_value=user)),
        ]
        with (
            patch("saas_app.connect_db") as connect_db,
            patch("saas_app.verify_neon_access_token") as verify,
            patch("saas_app.tenant_by_slug") as tenant_by_slug,
            patch("saas_app.issue_session") as issue_session,
        ):
            connect_db.return_value = connection
            verify.return_value = {
                "sub": "neon-user-id",
                "email": "admin@example.test",
                "email_verified": True,
            }
            tenant_by_slug.return_value = {"id": str(tenant_id), "slug": "panaderia-central"}

            result = neon_tenant_login(self.request(), Response(), slug="panaderia-central")

        self.assertEqual(result["tenant"], "panaderia-central")
        self.assertEqual(result["username"], "admin@example.test")
        self.assertEqual(connection.execute.call_args_list[3].args[1], ("neon-user-id", user_id))
        issue_session.assert_called_once()

    def test_requires_and_consumes_pending_invitation(self):
        user_id, tenant_id, invitation_id = uuid4(), uuid4(), uuid4()
        user = (user_id, tenant_id, "admin@example.test", "ADMIN_PANADERIA", "panaderia-central")
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.side_effect = [
            MagicMock(fetchall=MagicMock(return_value=[])),
            MagicMock(fetchall=MagicMock(return_value=[(*user, None)])),
            MagicMock(fetchone=MagicMock(return_value=(invitation_id, hash_token("invite-token")))),
            MagicMock(),
            MagicMock(),
            MagicMock(fetchone=MagicMock(return_value=user)),
        ]
        request = self.request()
        request.scope["headers"].append((b"x-panapp-invitation", b"invite-token"))
        with (
            patch("saas_app.connect_db", return_value=connection),
            patch(
                "saas_app.verify_neon_access_token",
                return_value={
                    "sub": "neon-user-id",
                    "email": "admin@example.test",
                    "email_verified": True,
                },
            ),
            patch("saas_app.tenant_by_slug", return_value={"id": str(tenant_id), "slug": "panaderia-central"}),
            patch("saas_app.issue_session") as issue_session,
        ):
            result = neon_tenant_login(request, Response(), slug="panaderia-central")

        self.assertEqual(result["tenant"], "panaderia-central")
        self.assertEqual(connection.execute.call_args_list[3].args[1], (invitation_id,))
        issue_session.assert_called_once()

    def test_rejects_missing_invitation_token(self):
        user_id, tenant_id, invitation_id = uuid4(), uuid4(), uuid4()
        user = (user_id, tenant_id, "admin@example.test", "ADMIN_PANADERIA", "panaderia-central")
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.side_effect = [
            MagicMock(fetchall=MagicMock(return_value=[])),
            MagicMock(fetchall=MagicMock(return_value=[(*user, None)])),
            MagicMock(fetchone=MagicMock(return_value=(invitation_id, hash_token("invite-token")))),
        ]
        with (
            patch("saas_app.connect_db", return_value=connection),
            patch(
                "saas_app.verify_neon_access_token",
                return_value={
                    "sub": "neon-user-id",
                    "email": "admin@example.test",
                    "email_verified": True,
                },
            ),
        ):
            with self.assertRaises(HTTPException) as error:
                neon_tenant_login(self.request(), Response(), slug="panaderia-central")

        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(connection.execute.call_count, 3)


class EmailCodeAuthenticationTests(unittest.TestCase):
    def request(self):
        return Request({
            "type": "http",
            "method": "POST",
            "path": "/t/panaderia-central/api/security/email-code",
            "headers": [
                (b"host", b"testserver"),
                (b"origin", b"http://testserver"),
            ],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "query_string": b"",
        })

    @patch("saas_app.send_tenant_email_code", return_value=True)
    @patch("saas_app.tenant_by_slug", return_value={"id": str(uuid4()), "slug": "panaderia-central"})
    @patch("saas_app.allow_login_attempt", return_value=True)
    @patch("saas_app.connect_db")
    def test_sends_code_only_for_provisioned_email(
        self,
        connect_db,
        allow_login_attempt,
        tenant_by_slug,
        send_code,
    ):
        user_id, tenant_id = uuid4(), uuid4()
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.side_effect = [
            MagicMock(fetchall=MagicMock(return_value=[(user_id, tenant_id, "Panadería Central")])),
            MagicMock(fetchone=MagicMock(return_value=(0, 0, 0))),
            MagicMock(),
            MagicMock(),
        ]
        connect_db.return_value = connection

        result = request_global_tenant_email_code(
            EmailCodeRequestBody(username="Admin@example.test"),
            self.request(),
            slug="panaderia-central",
        )

        self.assertTrue(result["ok"])
        self.assertRegex(send_code.call_args.args[2], r"^\d{6}$")
        insert_parameters = connection.execute.call_args_list[3].args[1]
        self.assertEqual(insert_parameters[2:6], (user_id, tenant_id, "admin@example.test", "127.0.0.1"))
        self.assertEqual(len(insert_parameters[1]), 64)
        tenant_by_slug.assert_called_once_with("panaderia-central")

    @patch("saas_app.tenant_by_slug", return_value={"slug": "panaderia-central"})
    @patch("saas_app.connect_db")
    def test_does_not_send_codes_to_unprovisioned_email(self, connect_db, tenant_by_slug):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = []
        connect_db.return_value = connection

        with patch("saas_app.send_tenant_email_code") as send_code:
            result = request_global_tenant_email_code(
                EmailCodeRequestBody(username="nobody@example.test"),
                self.request(),
                slug="panaderia-central",
            )

        self.assertTrue(result["ok"])
        send_code.assert_not_called()
        connection.execute.assert_called_once()

    @patch("saas_app.issue_session")
    @patch("saas_app.tenant_by_slug", return_value={"id": str(uuid4()), "slug": "panaderia-central"})
    @patch("saas_app.connect_db")
    def test_verifies_code_sets_password_and_issues_session(
        self,
        connect_db,
        tenant_by_slug,
        issue_session,
    ):
        from saas_app import password_hash

        challenge_id, user_id, tenant_id = uuid4(), uuid4(), uuid4()
        email = "admin@example.test"
        code = "012345"
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.side_effect = [
            MagicMock(fetchone=MagicMock(return_value=(
                challenge_id,
                password_hash(code, challenge_id.bytes),
                0,
                user_id,
                tenant_id,
                email,
                "ADMIN_PANADERIA",
                "panaderia-central",
            ))),
            MagicMock(),
            MagicMock(),
        ]
        connect_db.return_value = connection
        body = EmailCodeVerifyBody(
            username=email,
            code=code,
            password="a-strong-password",
        )
        response = Response()

        result = verify_global_tenant_email_code(
            body,
            self.request(),
            response,
            slug="panaderia-central",
        )

        self.assertEqual(result["tenant"], "panaderia-central")
        self.assertEqual(result["username"], email)
        self.assertEqual(connection.execute.call_args_list[1].args[1][2:4], (user_id, tenant_id))
        issue_session.assert_called_once()
        self.assertIs(issue_session.call_args.args[0], response)
        self.assertEqual(issue_session.call_args.args[2:], (
            "tenant",
            str(user_id),
            "ADMIN_PANADERIA",
            str(tenant_by_slug.return_value["id"]),
        ))

    @patch("saas_app.connect_db")
    def test_rejects_a_wrong_code_and_persists_attempt(self, connect_db):
        challenge_id = uuid4()
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchone.return_value = (
            challenge_id,
            "not-the-code",
            0,
            uuid4(),
            uuid4(),
            "admin@example.test",
            "ADMIN_PANADERIA",
            "panaderia-central",
        )
        connect_db.return_value = connection

        with (
            patch("saas_app.allow_login_attempt", return_value=True),
            patch("saas_app.tenant_by_slug", return_value={"slug": "panaderia-central"}),
        ):
            with self.assertRaises(HTTPException) as error:
                verify_global_tenant_email_code(
                    EmailCodeVerifyBody(
                        username="admin@example.test",
                        code="000000",
                        password="a-strong-password",
                    ),
                    self.request(),
                    Response(),
                    slug="panaderia-central",
                )

        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(connection.execute.call_count, 2)
        self.assertEqual(connection.execute.call_args_list[1].args[1], (challenge_id,))


class LegacyPasswordMigrationTests(unittest.TestCase):
    @patch("saas_app.connect_db")
    def test_accepts_a_matching_legacy_password(self, connect_db):
        import secrets
        from saas_app import password_hash

        salt = secrets.token_bytes(32)
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = [
            (salt.hex(), password_hash("previous-password", salt))
        ]
        connect_db.return_value = connection

        self.assertTrue(verify_legacy_tenant_credentials("Admin@example.test", "previous-password"))

    @patch("saas_app.connect_db")
    def test_rejects_ambiguous_or_mismatched_legacy_credentials(self, connect_db):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = [
            ("00" * 32, "not-the-password"),
            ("11" * 32, "not-the-password"),
        ]
        connect_db.return_value = connection

        self.assertFalse(verify_legacy_tenant_credentials("admin@example.test", "previous-password"))


class SubscriptionReportTests(unittest.TestCase):
    @patch("saas_app.connect_db")
    def test_exports_paid_revenue_for_the_selected_month(self, connect_db):
        from datetime import datetime
        from decimal import Decimal

        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = [
            ("Panadería Central", "central", Decimal("45000.00"), "TX-123", datetime(2025, 2, 4, 10, 30))
        ]
        connect_db.return_value = connection

        response = subscription_revenue_report("2025-02", {})

        self.assertEqual(response.status_code, 200)
        self.assertIn('filename="panapp-ingresos-2025-02.csv"', response.headers["content-disposition"])
        self.assertIn("Panadería Central", response.body.decode("utf-8-sig"))
        self.assertIn("TX-123", response.body.decode("utf-8-sig"))
        self.assertEqual(connection.execute.call_args.args[1], ("2025-02",))

    @patch("saas_app.connect_db")
    def test_summarizes_paid_revenue_for_dashboard_preview(self, connect_db):
        from datetime import datetime
        from decimal import Decimal

        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = [
            ("Panadería Central", "central", Decimal("45000.00"), "TX-123", datetime(2025, 2, 4, 10, 30))
        ]
        connect_db.return_value = connection

        report = subscription_revenue_summary("2025-02", {})

        self.assertEqual(report["month"], "2025-02")
        self.assertEqual(report["payment_count"], 1)
        self.assertEqual(report["total"], 45000.0)
        self.assertEqual(report["payments"][0]["tenant_name"], "Panadería Central")
        self.assertEqual(report["payments"][0]["paid_at"], "2025-02-04T10:30:00")
        self.assertEqual(connection.execute.call_args.args[1], ("2025-02",))

    def test_rejects_invalid_report_month(self):
        with self.assertRaises(HTTPException) as error:
            subscription_revenue_report("2025-13", {})

        self.assertEqual(error.exception.status_code, 422)

    def test_dashboard_preview_rejects_invalid_month(self):
        with self.assertRaises(HTTPException) as error:
            subscription_revenue_summary("2025-13", {})

        self.assertEqual(error.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
