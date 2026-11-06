import unittest
from datetime import datetime, timedelta, timezone
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
    PaymentBody,
    PublicOrderBody,
    TenantCreateBody,
    public_catalog,
    validate_slug,
    neon_tenant_login,
    verify_neon_access_token,
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
        self.assertEqual(connection.execute.call_args_list[2].args[1], ("neon-user-id", user_id))
        issue_session.assert_called_once()


if __name__ == "__main__":
    unittest.main()
