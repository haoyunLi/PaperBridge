#!/bin/zsh
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/paperbridge-web-tests.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
xcrun swiftc -module-cache-path "${TMPDIR:-/tmp}/paperbridge_swift_module_cache" \
  "$PROJECT_DIR/Tests/MarkdownInteractionRegression.swift" \
  "$PROJECT_DIR/PaperBridge/Models.swift" \
  "$PROJECT_DIR/PaperBridge/Views/PaperBridgeUI.swift" \
  "$PROJECT_DIR/PaperBridge/Utilities/Hashing.swift" \
  "$PROJECT_DIR/PaperBridge/Utilities/MarkdownPreviewHTMLRenderer.swift" \
  "$PROJECT_DIR/PaperBridge/Services/AcademicMarkdownProcessor.swift" \
  "$PROJECT_DIR/PaperBridge/Services/TextProcessing.swift" \
  "$PROJECT_DIR/PaperBridge/Views/MarkdownPreviewView.swift" \
  -o "$TEST_ROOT/markdown-tests"
"$TEST_ROOT/markdown-tests"
