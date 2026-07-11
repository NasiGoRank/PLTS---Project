from __future__ import annotations

import json
import os
import re
from pathlib import Path

ASSIGNMENT = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def _decode_value(name: str, value: str) -> str:
    stripped = value.strip()
    if len(stripped) >= 2 and stripped[0] == stripped[-1] and stripped[0] in {"'", '"'}:
        return stripped[1:-1]
    if stripped.startswith(("[", "{")):
        try:
            json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON value for {name}: {exc.msg}") from exc
    return stripped


def load_env_file(path: Path) -> None:
    """Load a local .env file without overriding deployment environment variables.

    JSON arrays and objects may span multiple lines, which is useful for browser
    cookie exports. The complete JSON value is validated before it is installed.
    """
    if not path.is_file():
        return

    lines = path.read_text(encoding="utf-8").splitlines()
    pending_name: str | None = None
    pending_lines: list[str] = []

    for line_number, line in enumerate(lines, start=1):
        if pending_name is not None:
            pending_lines.append(line)
            candidate = "\n".join(pending_lines).strip()
            try:
                json.loads(candidate)
            except json.JSONDecodeError:
                continue
            os.environ.setdefault(pending_name, candidate)
            pending_name = None
            pending_lines = []
            continue

        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        match = ASSIGNMENT.match(line)
        if not match:
            raise ValueError(f"Invalid .env entry on line {line_number}")

        name, raw_value = match.groups()
        candidate = raw_value.strip()
        if candidate.startswith(("[", "{")):
            try:
                json.loads(candidate)
            except json.JSONDecodeError:
                pending_name = name
                pending_lines = [raw_value]
                continue
        os.environ.setdefault(name, _decode_value(name, raw_value))

    if pending_name is not None:
        raise ValueError(f"Invalid JSON value for {pending_name}: unterminated value")
