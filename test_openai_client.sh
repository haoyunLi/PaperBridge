#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/paperbridge-openai-tests.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

xcrun swiftc \
  -swift-version 6 \
  -warnings-as-errors \
  -module-cache-path "$TEST_DIR/module-cache" \
  "$PROJECT_DIR/PaperBridge/Services/OpenAIClient.swift" \
  "$PROJECT_DIR/PaperBridge/Services/OpenAIKeychainStore.swift" \
  "$PROJECT_DIR/Tests/OpenAIClientRegression.swift" \
  -framework Security \
  -o "$TEST_DIR/openai-client-tests"

"$TEST_DIR/openai-client-tests"
