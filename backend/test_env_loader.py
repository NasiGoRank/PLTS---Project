import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from env_loader import load_env_file


class LoadEnvFileTests(unittest.TestCase):
    def test_loads_simple_and_multiline_json_values(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "SIMPLE=value\n"
                "QUOTED=\"hello world\"\n"
                "COOKIES=[\n"
                "  {\"name\": \"session\", \"value\": \"abc\"}\n"
                "]\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {}, clear=True):
                load_env_file(env_file)
                self.assertEqual(os.environ["SIMPLE"], "value")
                self.assertEqual(os.environ["QUOTED"], "hello world")
                self.assertEqual(
                    os.environ["COOKIES"],
                    '[\n  {"name": "session", "value": "abc"}\n]',
                )

    def test_existing_environment_takes_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("SETTING=from-file\n", encoding="utf-8")

            with patch.dict(os.environ, {"SETTING": "from-runtime"}, clear=True):
                load_env_file(env_file)
                self.assertEqual(os.environ["SETTING"], "from-runtime")

    def test_rejects_unterminated_json_without_partial_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text('COOKIES=[\n  {"name": "session"}\n', encoding="utf-8")

            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(ValueError, "COOKIES"):
                    load_env_file(env_file)
                self.assertNotIn("COOKIES", os.environ)


if __name__ == "__main__":
    unittest.main()
