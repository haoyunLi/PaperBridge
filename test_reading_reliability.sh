#!/bin/zsh
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/paperbridge-reliability.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
SOURCES=("$PROJECT_DIR"/PaperBridge/Services/*.swift)
SOURCES=("${SOURCES[@]:#*/AppUpdateController.swift}")
xcrun swiftc -module-cache-path "${TMPDIR:-/tmp}/paperbridge_swift_module_cache" \
  "$PROJECT_DIR/Tests/ReadingReliabilityRegression.swift" \
  "$PROJECT_DIR/PaperBridge/Models.swift" \
  "$PROJECT_DIR"/PaperBridge/PaperReaderViewModel*.swift \
  "$PROJECT_DIR"/PaperBridge/Utilities/*.swift \
  "$PROJECT_DIR/PaperBridge/Views/PaperBridgeUI.swift" \
  "$PROJECT_DIR/PaperBridge/Views/SelectableAcademicText.swift" \
  "$PROJECT_DIR/PaperBridge/Views/PDFDocumentView.swift" \
  "${SOURCES[@]}" -o "$TEST_ROOT/reading-tests"
"$TEST_ROOT/reading-tests" "$@"
