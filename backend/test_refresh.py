import unittest

from api import refresh_authorized, refresh_payload, safe_auth_detail, site_auth_details


class RefreshAuthorizationTests(unittest.TestCase):
    def test_accepts_matching_bearer_token(self):
        self.assertTrue(refresh_authorized("Bearer scheduler-secret", "scheduler-secret"))

    def test_rejects_missing_malformed_and_incorrect_tokens(self):
        self.assertFalse(refresh_authorized(None, "scheduler-secret"))
        self.assertFalse(refresh_authorized("scheduler-secret", "scheduler-secret"))
        self.assertFalse(refresh_authorized("Bearer wrong-secret", "scheduler-secret"))


class RefreshPayloadTests(unittest.TestCase):
    def test_returns_safe_site_authentication_summary(self):
        state = {
            "last_success": True,
            "last_run_id": "run-123",
            "last_finished_at": "2026-07-11T12:00:00+00:00",
            "last_history_saved": False,
            "last_site_summary": {
                "huawei": {
                    "total": 19,
                    "success_count": 19,
                    "failed_count": 0,
                    "auth_error_count": 0,
                },
                "kehua": {
                    "total": 42,
                    "success_count": 40,
                    "failed_count": 2,
                    "auth_error_count": 1,
                },
            },
            "last_site_auth": {
                "kehua": {
                    "auth_check_before_login": {"checked": True, "success": False, "status_code": 200, "app_code": "111005"},
                    "password_login": {"success": True, "status_code": 200, "app_code": "0", "authorization_found": True},
                    "auth_check_after_login": {"checked": True, "success": True, "status_code": 200, "app_code": "0"},
                }
            },
            "last_error": "sensitive upstream detail",
        }

        payload = refresh_payload(state)

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["run_id"], "run-123")
        self.assertFalse(payload["sites"]["huawei"]["authentication_error"])
        self.assertTrue(payload["sites"]["kehua"]["authentication_error"])
        self.assertTrue(payload["sites"]["kehua"]["authentication"]["password_login"]["authorization_found"])
        self.assertNotIn("last_error", payload)
        self.assertNotIn("sensitive upstream detail", str(payload))


class SafeAuthenticationDetailTests(unittest.TestCase):
    def test_keeps_diagnostic_flags_without_leaking_values(self):
        raw = {
            "cookies": {"loaded": 1, "token_found": True, "token_cookie_name": "token", "reason": "ok"},
            "password_login": {
                "success": True,
                "status_code": 200,
                "app_code": "0",
                "authorization_found": True,
                "authorization": "secret-token-value",
                "password": "secret-password",
            },
            "auth_check_after_login": {
                "checked": True,
                "success": True,
                "status_code": 200,
                "body": {"data": {"authorization": "secret-token-value"}},
            },
        }

        detail = safe_auth_detail(raw)

        self.assertTrue(detail["password_login"]["success"])
        self.assertEqual(detail["password_login"]["app_code"], "0")
        self.assertTrue(detail["password_login"]["authorization_found"])
        self.assertNotIn("secret-token-value", str(detail))
        self.assertNotIn("secret-password", str(detail))
        self.assertNotIn("body", str(detail))

    def test_extracts_safe_auth_details_by_site(self):
        result = {
            "sites": [
                {
                    "site": "kehua",
                    "session": {
                        "password_login": {
                            "success": False,
                            "reason": "credentials_not_configured",
                        }
                    },
                }
            ]
        }

        self.assertEqual(
            site_auth_details(result),
            {"kehua": {"password_login": {"success": False, "reason": "credentials_not_configured"}}},
        )


if __name__ == "__main__":
    unittest.main()
