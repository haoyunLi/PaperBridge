#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_BINARY="${TMPDIR:-/tmp}/paperbridge_text_processing_tests"
MARKDOWN_TEST_BINARY="${TMPDIR:-/tmp}/paperbridge_markdown_processing_tests"
MINERU_TEST_BINARY="${TMPDIR:-/tmp}/paperbridge_mineru_service_tests"
FACSIMILE_TEST_BINARY="${TMPDIR:-/tmp}/paperbridge_pdf_facsimile_tests"
MODULE_CACHE="${TMPDIR:-/tmp}/paperbridge_swift_module_cache"

mkdir -p "$MODULE_CACHE"

xcrun swiftc \
  -module-cache-path "$MODULE_CACHE" \
  "$PROJECT_DIR/Tests/TextProcessingRegression.swift" \
  "$PROJECT_DIR/PaperBridge/Services/TextProcessing.swift" \
  -o "$TEST_BINARY"

"$TEST_BINARY"

xcrun swiftc \
  -module-cache-path "$MODULE_CACHE" \
  "$PROJECT_DIR/Tests/AcademicMarkdownRegression.swift" \
  "$PROJECT_DIR/PaperBridge/Models.swift" \
  "$PROJECT_DIR/PaperBridge/Services/TextProcessing.swift" \
  "$PROJECT_DIR/PaperBridge/Services/AcademicMarkdownProcessor.swift" \
  "$PROJECT_DIR/PaperBridge/Services/MarkdownBundleExporter.swift" \
  "$PROJECT_DIR/PaperBridge/Utilities/MarkdownPreviewHTMLRenderer.swift" \
  -o "$MARKDOWN_TEST_BINARY"

"$MARKDOWN_TEST_BINARY"

xcrun swiftc \
  -module-cache-path "$MODULE_CACHE" \
  "$PROJECT_DIR/Tests/MinerUServiceRegression.swift" \
  "$PROJECT_DIR/PaperBridge/Models.swift" \
  "$PROJECT_DIR/PaperBridge/Services/MinerUService.swift" \
  -o "$MINERU_TEST_BINARY"

"$MINERU_TEST_BINARY"

xcrun swiftc \
  -module-cache-path "$MODULE_CACHE" \
  "$PROJECT_DIR/Tests/PDFVisualArchiveRegression.swift" \
  "$PROJECT_DIR/PaperBridge/Services/PDFVisualArchiveService.swift" \
  -o "$FACSIMILE_TEST_BINARY"

"$FACSIMILE_TEST_BINARY"
