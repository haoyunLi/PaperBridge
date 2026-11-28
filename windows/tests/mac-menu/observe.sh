#!/bin/bash
set -euo pipefail

work=$(mktemp -d "${RUNNER_TEMP:?}/paperbridge-menu.XXXXXX")
image="$work/PaperBridge-1.10.0.dmg"
mount="$work/volume"
mkdir "$mount"
curl --fail --location --silent --show-error --retry 3   'https://github.com/haoyunLi/PaperBridge/releases/download/v1.10.0/PaperBridge-1.10.0.dmg' -o "$image"
echo "c6ea846e7aeb76151e327756ef55d65278feff00112d42dd1c280879964e1cb5  $image" | shasum -a 256 -c -
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$image"
trap 'hdiutil detach "$mount" || true' EXIT
xcrun swiftc -parse-as-library "$(dirname "$0")/Observe.swift" -o "$work/observe"
"$work/observe" "$mount/PaperBridge.app" "$work/menu.json"
python3 - "$work/menu.json" "$1" <<'PY'
import json
import sys
from pathlib import Path

menu, output = map(Path, sys.argv[1:])
reference = json.loads(output.read_text())
reference["applicationMenu"] = json.loads(menu.read_text())
output.write_text(json.dumps(reference, ensure_ascii=False))
PY
