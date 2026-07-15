import os
import unittest
from unittest.mock import patch

from scrape_monitoring import kehua_password_cipher, kehua_request_sign, prepare_session


class FakeResponse:
    def __init__(self, body, status_code=200, headers=None):
        self._body = body
        self.status_code = status_code
        self.headers = headers or {}
        self.ok = 200 <= status_code < 400
        self.text = __import__("json").dumps(body)

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.headers = {}
        self.cookies = FakeCookies()
        self.requests = []

    def post(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return next(self.responses)


class FakeCookies(dict):
    def set(self, name, value, **kwargs):
        self[name] = value


KEHUA_SITE = {
    "base_url": "https://energy.kehua.com",
    "base_domain": "energy.kehua.com",
    "dashboard_url": "https://energy.kehua.com/monitorOw",
    "cookie_domains": ["energy.kehua.com", ".kehua.com"],
    "auth_type": "kehua_energy",
    "auth_check": "https://energy.kehua.com/necp/server-user/auth/web/getUserInfo",
    "password_login": "https://energy.kehua.com/necp/server-user/auth/web/login",
    "web_version": "3.0.4",
}


class KehuaAuthenticationTests(unittest.TestCase):
    def test_matches_the_official_client_password_encryption(self):
        self.assertEqual(kehua_password_cipher("test-password"), "03juRHcDYNGtKIYNhw413w==")

    def test_matches_the_official_client_request_signature(self):
        self.assertEqual(
            kehua_request_sign({"username": "user", "password": "encrypted"}, 1700000000000),
            "FYlyX0hzjcQRYKnSYhfkj7hVBAcSuoLjmceeXCHl7efsBIfZw9SW4KiehuKWj81o",
        )

    @patch("scrape_monitoring.requests.Session")
    def test_reuses_a_valid_existing_authorization(self, session_class):
        session = FakeSession([FakeResponse({"code": "0", "data": {"userName": "safe"}})])
        session.headers["Authorization"] = "existing-secret-token"
        session_class.return_value = session

        with patch.dict(os.environ, {"KEHUA_USERNAME": "user", "KEHUA_PASSWORD": "password"}, clear=False):
            prepared, meta = prepare_session("kehua", KEHUA_SITE, None, 10)

        self.assertIs(prepared, session)
        self.assertTrue(meta["auth_check_before_login"]["success"])
        self.assertNotIn("password_login", meta)
        self.assertEqual(len(session.requests), 1)
        self.assertNotIn("existing-secret-token", str(meta))

    @patch("scrape_monitoring.requests.Session")
    def test_logs_in_again_when_the_existing_authorization_expired(self, session_class):
        session = FakeSession(
            [
                FakeResponse({"code": "900", "message": "expired"}),
                FakeResponse({"code": "0", "data": {"authorization": "new-secret-token"}}),
                FakeResponse({"code": "0", "data": {"userName": "safe"}}),
            ]
        )
        session_class.return_value = session

        with patch.dict(os.environ, {"KEHUA_USERNAME": "user", "KEHUA_PASSWORD": "password"}, clear=False):
            prepared, meta = prepare_session("kehua", KEHUA_SITE, None, 10)

        self.assertEqual(prepared.headers["Authorization"], "new-secret-token")
        self.assertTrue(meta["password_login"]["success"])
        self.assertTrue(meta["auth_check_after_login"]["success"])
        self.assertNotIn("new-secret-token", str(meta))
        login_url, login_request = session.requests[1]
        self.assertEqual(login_url, KEHUA_SITE["password_login"])
        self.assertIn("username=user", login_request["data"])
        self.assertNotIn("password=password", login_request["data"])
        self.assertIn("sign", login_request["headers"])

    @patch("scrape_monitoring.requests.Session")
    def test_reports_missing_credentials_without_exposing_authentication_data(self, session_class):
        session = FakeSession([FakeResponse({"code": "900", "message": "expired"})])
        session_class.return_value = session

        with patch.dict(os.environ, {}, clear=True):
            _, meta = prepare_session("kehua", KEHUA_SITE, None, 10)

        self.assertEqual(meta["password_login"], {"success": False, "reason": "credentials_not_configured"})
        self.assertEqual(len(session.requests), 1)


if __name__ == "__main__":
    unittest.main()
