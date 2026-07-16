#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_BINARY="${TMPDIR:-/tmp}/paperbridge_text_processing_tests"
MODULE_CACHE="${TMPDIR:-/tmp}/paperbridge_swift_module_cache"

mkdir -p "$MODULE_CACHE"

xcrun swiftc \
  -module-cache-path "$MODULE_CACHE" \
  "$PROJECT_DIR/Tests/TextProcessingRegression.swift" \
  "$PROJECT_DIR/PaperBridge/Services/TextProcessing.swift" \
  -o "$TEST_BINARY"

"$TEST_BINARY"
