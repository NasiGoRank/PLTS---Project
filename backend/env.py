import json
import re
import sys
from pathlib import Path

env_path = Path(".env")

cookie_files = {
    "HUAWEI_COOKIES_JSON": Path(sys.argv[1]),
    "KEHUA_COOKIES_JSON": Path(sys.argv[2]),
}

replacements = {}

for variable, path in cookie_files.items():
    if not path.exists():
        raise SystemExit(f"Cookie file not found: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))

    if not isinstance(data, (list, dict)):
        raise SystemExit(f"{path} must contain a JSON list or object")

    replacements[variable] = json.dumps(
        data,
        ensure_ascii=False,
        separators=(",", ":"),
    )

lines = env_path.read_text(encoding="utf-8").splitlines()
cleaned = []
written = set()

for line in lines:
    stripped = line.strip()

    if not stripped or stripped.startswith("#"):
        cleaned.append(line)
        continue

    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)

    # Discard debris from the old multiline JSON.
    if not match:
        continue

    key = match.group(1)

    if key in replacements:
        if key not in written:
            cleaned.append(f"{key}={replacements[key]}")
            written.add(key)
    else:
        cleaned.append(line)

for key, value in replacements.items():
    if key not in written:
        cleaned.append(f"{key}={value}")

env_path.write_text("\n".join(cleaned) + "\n", encoding="utf-8")

print("Updated .env successfully.")
for key, value in replacements.items():
    parsed = json.loads(value)
    count = len(parsed) if hasattr(parsed, "__len__") else "unknown"
    print(f"{key}: valid JSON, items={count}")