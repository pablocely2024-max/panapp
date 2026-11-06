import socket
import unittest
from unittest.mock import patch

import psycopg

from saas_app import connect_to_neon, read_port_setting


NEON_HOST = "ep-example-pooler.c-14.us-east-1.aws.neon.tech"
CONNECTION_INFO = f"postgresql://neondb_owner:secret@{NEON_HOST}/neondb"


def resolved_address(address):
    return socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, 5432)


class NeonConnectionTests(unittest.TestCase):
    def test_reads_numeric_port_setting(self):
        with patch.dict("os.environ", {"PANAPP_DB_PORT": "5432"}):
            self.assertEqual(read_port_setting("PANAPP_DB_PORT", "5432"), 5432)

    def test_invalid_port_error_does_not_expose_configured_value(self):
        secret_like_value = "sensitive-config-value"
        with patch.dict("os.environ", {"PANAPP_DB_PORT": secret_like_value}):
            with self.assertRaisesRegex(RuntimeError, "PANAPP_DB_PORT debe ser un puerto numérico") as error:
                read_port_setting("PANAPP_DB_PORT", "5432")

        self.assertNotIn(secret_like_value, str(error.exception))

    def test_rejects_port_outside_valid_range(self):
        with patch.dict("os.environ", {"PANAPP_DB_PORT": "65536"}):
            with self.assertRaisesRegex(RuntimeError, "PANAPP_DB_PORT debe ser un puerto numérico"):
                read_port_setting("PANAPP_DB_PORT", "5432")

    @patch("saas_app.psycopg.connect")
    @patch("saas_app.socket.getaddrinfo")
    def test_pins_resolved_ip_while_preserving_neon_hostname(self, getaddrinfo, connect):
        expected = object()
        connect.return_value = expected
        getaddrinfo.return_value = [
            resolved_address("192.0.2.10"),
            resolved_address("192.0.2.11"),
        ]

        connection = connect_to_neon(
            NEON_HOST,
            {"connect_timeout": 5, "sslmode": "require"},
            conninfo=CONNECTION_INFO,
        )

        self.assertIs(connection, expected)
        getaddrinfo.assert_called_once_with(NEON_HOST, 5432, type=socket.SOCK_STREAM)
        connect.assert_called_once_with(
            CONNECTION_INFO,
            connect_timeout=5,
            sslmode="require",
            host=NEON_HOST,
            hostaddr="192.0.2.10",
        )

    @patch("saas_app.time.sleep")
    @patch("saas_app.psycopg.connect")
    @patch("saas_app.socket.getaddrinfo")
    def test_retries_transient_dns_failure(self, getaddrinfo, connect, sleep):
        getaddrinfo.side_effect = [
            socket.gaierror("temporary DNS failure"),
            socket.gaierror("temporary DNS failure"),
            socket.gaierror("temporary DNS failure"),
            [resolved_address("192.0.2.10")],
        ]
        connect.return_value = object()

        connect_to_neon(NEON_HOST, {"port": 5432, "sslmode": "require"})

        self.assertEqual(getaddrinfo.call_count, 4)
        self.assertEqual(
            [call.args[0] for call in sleep.call_args_list],
            [0.25, 0.5, 1.0],
        )
        self.assertEqual(connect.call_args.kwargs["hostaddr"], "192.0.2.10")

    @patch("saas_app.time.sleep")
    @patch("saas_app.psycopg.connect")
    @patch("saas_app.socket.getaddrinfo")
    def test_reports_persistent_dns_failure_after_all_retries(self, getaddrinfo, connect, sleep):
        getaddrinfo.side_effect = socket.gaierror("DNS unavailable")

        with self.assertRaisesRegex(
            psycopg.OperationalError,
            "after 5 attempts.*DNS/network",
        ):
            connect_to_neon(NEON_HOST, {"port": 5432, "sslmode": "require"})

        self.assertEqual(getaddrinfo.call_count, 5)
        self.assertEqual(
            [call.args[0] for call in sleep.call_args_list],
            [0.25, 0.5, 1.0, 2.0],
        )
        connect.assert_not_called()

    @patch("saas_app.psycopg.connect")
    @patch("saas_app.socket.getaddrinfo")
    def test_tries_next_neon_ip_after_network_failure(self, getaddrinfo, connect):
        getaddrinfo.return_value = [
            resolved_address("192.0.2.10"),
            resolved_address("192.0.2.11"),
        ]
        expected = object()
        connect.side_effect = [psycopg.OperationalError("network unavailable"), expected]

        connection = connect_to_neon(NEON_HOST, {"port": 5432, "sslmode": "require"})

        self.assertIs(connection, expected)
        self.assertEqual(connect.call_count, 2)
        self.assertEqual(connect.call_args_list[0].kwargs["hostaddr"], "192.0.2.10")
        self.assertEqual(connect.call_args_list[1].kwargs["hostaddr"], "192.0.2.11")


if __name__ == "__main__":
    unittest.main()
