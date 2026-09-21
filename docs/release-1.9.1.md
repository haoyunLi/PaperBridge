# PaperBridge 1.9.1

## Keep your thoughts and your place

- Notes save automatically after a short typing pause. Changing selection, closing the inspector, switching papers, or quitting normally flushes pending edits. Save Now and session undo remain available.
- Use Back / Forward in the reading header, or Command-[ / Command-], after a section, source, or annotation jump. Return to the previous reading view instead of finding the passage again.
- Standalone section headings appear as compact bilingual rows without duplicate title cards. Headings with body text remain intact.
- Translation progress and local-save status stay above the scrolling document. A failed save keeps the note in memory and offers Retry Save.

## Install or update

Download PaperBridge.dmg and drag PaperBridge into Applications. Existing users can choose PaperBridge > Check for Updates. This release is signed and Apple-notarized, with the existing signed Sparkle update feed.

macOS 14 or later; Universal Apple Silicon and Intel. Installing the app does not require Xcode, Homebrew, or Python. Ollama and a local model are required for AI features; MinerU remains optional and recommended for structured extraction.

## Practical limits

Reading history is session-only, keeps up to 50 locations, and resets when switching papers or repairing paragraph structure. Reader restoration is block-level and PDF restoration is page-level. Force quit or power loss during the brief typing delay can lose the latest keystrokes. If saving fails, keep the app open or export important work until saving succeeds. Local recovery is not an independent backup.

Validated with reading reliability, text/Markdown/MinerU/PDF regression suites, the WKWebView interaction test, and isolated native note-editing, normal-quit, restart, and Back / Forward checks. No physical Intel Mac or clean second-Mac runtime test was performed.
