# Reading Reliability Update

Release scope: PaperBridge 1.9 (build 10). Isolated development tests do not replace the installed app or personal workspaces. See [release notes](release-1.9.md) for user-facing changes.

## Completed Scope

- Open newly imported text-bearing papers in Overview, combining a deterministic source reading map with a separate optional AI summary. The map quotes original text and navigates to its exact Reader paragraph; missing sections are not invented. Existing saved workspaces retain their chosen view.
- Offer a fictional practice paper on the welcome screen without model calls or replacing an open document. Route missing translation/summary dependencies to setup, and allow the document sidebar to be hidden for reading space.
- Resume pending and failed paragraphs without translating saved successful paragraphs again. Checkpoint progress locally and reject model responses explicitly marked as truncated.
- Restore translations, summaries, and explanations under their own model/language settings. Unrelated parser or lookup preferences no longer erase restored outputs.
- Prevent cancelled work from overwriting the status or result of a replacement translation task.
- Remove highlight color without deleting a note. Undo up to 20 highlight/note changes in the current document session; this undo history is not persisted and resets after structural paragraph edits.
- Record exact PDF text ranges across pages, rather than highlighting the first occurrence of a repeated quote. Keep legacy annotation recovery conservative when a quote is ambiguous.
- Navigate to annotations in the corresponding reader, PDF, summary, or translated document. Report anchors that can no longer be resolved without deleting the annotation.
- Update Markdown highlights in place, preserve block-relative scroll position during content updates, and add unique heading anchors for local links.
- Save Reader block positions, PDF pages, and Markdown viewport positions. Keep search above the scrolling Reader, prioritize outline/bookmarks, and use a bottom inspector in narrower windows.
- Show local save failures and allow setup downloads to continue after leaving the getting-started guide.

## Verification

The reading-efficiency follow-up adds advisory extraction checks; section-scoped and reprioritized paragraph queues; a title/tag-searchable local paper library; non-resizing selected-text help and a language-aware saved glossary; exact-quotation links for new AI summary claims; and saved typography/focus controls. The website includes matching, explicitly fictional interactive examples for all six features.

The library index discovers preexisting workspace files, keeps user labels/tags separate from document content, and retains a stable library identity through manual paragraph edits. Original PDF resources remain associated with an edited document. Readable previous saves are retained locally; this is not independent backup, cloud storage, or persistent multi-model history.

Summary provenance validation checks paragraph bounds, exact source quotations, and quotes carried through partial-summary consolidation. This proves location only, not entailment or scientific correctness. Non-JSON responses are retained without validated links. Source and target summaries share numbered claims; original quotations are included in analysis Markdown exports.

- `test_text_processing.sh`: existing extraction, paragraph, academic Markdown, MinerU, and PDF facsimile regressions, plus heading-anchor collisions.
- `test_reading_reliability.sh`: source-map excerpts and navigation, section boundaries/ranges/prioritization, advisory broken-word/number checks, fabricated citation rejection, glossary language direction/persistence, multi-paper restoration and labels/tags, appearance clamping without cache loss, no-model practice loading, partial resume, cancellation/retry, note preservation/undo, exact repeated-word and multi-page PDF selection, old workspace compatibility, and save failures.
- `test_markdown_interaction.sh`: real local WebKit execution of the app's selection bridge, including repeated words, inserted content, incremental highlights, scroll restoration, translated-only anchors, and Unicode offsets.
- `script/build_and_run.sh --isolated --verify`: Debug build and launch without replacing the installed app. No signing or release is performed.
- Live accessibility checks on the isolated demo: cross-tab `Command-F` focus, bookmark navigation, manual-scroll position persistence, and returning from Summary to the saved Reader block passed. The window used the compact bottom inspector with the document sidebar open.
- New source-map checks: Overview renders the exact practice excerpts, its method link opens paragraph 6, repeated navigation returns to that paragraph, and collapsing the document sidebar keeps it visible with the bottom inspector open. This exposed and fixed a remounted-ScrollView timing issue that model-only tests did not cover.

Automated tests do not validate translation quality, every PDF/OCR layout, or all possible MathJax/image loading delays. Reader restoration is block-level and PDF restoration is page-level, not exact glyph-level restoration. The release increments the app version to 1.9/build 10 and retains the existing signed Sparkle feed URL.

The new Overview and Reader/sidebar layouts were visually inspected in the isolated development app. macOS ScreenCaptureKit intermittently failed, so this is not an exhaustive visual review of every app view. Existing README screenshots remain the earlier app captures and are not presented as images of the new source map.

The reading-efficiency update also passed the native Debug build, extraction/Markdown/MinerU/facsimile suites, the expanded reading-reliability suite, and the WebKit interaction suite. End-to-end simulated summary generation/export validates citations, flags missing sources, and rejects empty structured summaries. Library tests cover metadata, separate papers, restart, and stable identity after paragraph edits. Native accessibility inspection confirmed the new header controls, Reader entry, and sidebar removal in Focus Reading; the appearance popover exposed its three controls. ScreenCaptureKit/no-window failures prevented a complete pointer-driven check of the new library and quick-help panels. Real-model translation/summary quality is not evaluated by the simulated tests.

The website's eighteen chapters and six new practices passed interactions at 1440x1000, 390x844, and 320x740, including keyboard opening, source comparison, section cancellation/resume, library search/switching, terminology saving, source expansion, and typography/focus controls. No console errors or horizontal overflow were observed. The visual and code review was performed in-thread; no independent subagent review was performed.

## Follow-up Work

The extractive source map, local paper library, terminology glossary, section-prioritized queue, and quotation-linked AI summaries are included in 1.9. Semantic verification of AI claims, cross-paper comparison, independent library backup/synchronization, and persistent multi-model output histories are not implemented.

PDF paragraph reconstruction still needs a dedicated fixture-driven pass, particularly interrupted sentences around figures/tables and uncertain reference boundaries. This update does not claim to solve all paragraph extraction problems. MinerU remains a semantic reconstruction rather than an exact reproduction of PDF layout; Original PDF remains the visual source of truth.

Source-backed figure/table navigation, persistent output variants for multiple model settings, and document-wide contextual translation are separate architectural work. They have not been added in this reliability iteration.

## Release Review and Fixes

- Reimport uses the stable library identity to restore the saved revision before extracting or overwriting content. Re-extract PDF as New Copy deliberately creates a distinct library item with the current parser settings.
- Split/merge operations carry their exact changed range. Unchanged duplicate paragraphs keep their own translations; bookmarks move with content, and source annotations preserve exact UTF-16 occurrences where resolvable. Changed/ambiguous notes remain visible but unhighlighted. Undo restores old anchors without discarding notes added afterward.
- Workspace updates suppress intermediate persistence while replacing structural state or restoring a paper's settings. Edited content hashes include the stable paper identity to prevent cross-paper cache collisions.
- Changed JSON saves keep one readable atomic backup. Recovery skips corrupt primary files and never overwrites a good backup with malformed data.
- Export includes notes from Paper, Overview summaries, and Full Translation, plus explicitly labeled unresolved notes. Asset copies resolve symlinks and reject paths outside the document resource folder.
- Opening the compact inspector from a selection keeps the selected Reader paragraph in view.
- App and DMG are separately submitted for notarization and stapled. The Universal binary, nested code signatures, Gatekeeper assessment, fixed DMG filename, and signed Sparkle feed are release gates.

Expanded regression tests passed for reimport after edits/restart, duplicate paragraphs, Unicode/repeated-word anchors, split/merge/undo, translated-side invalidation, original PDF anchor preservation, unresolved-note export, readable-save fallback, and export symlink confinement. All extraction/Markdown/MinerU/PDF facsimile suites and the real WebKit interaction suite passed.

The opt-in `./test_reading_reliability.sh --live-smoke` passed against already-installed local `translategemma:4b` and `gemma4:e4b`: two fictional paragraphs translated, BRCA1 and 5 mg/L were retained in the observed output, bilingual summaries included five validated source quotes, and explanation/Markdown export succeeded. This is a bounded smoke test, not a scientific translation benchmark. It downloads no models and does not use personal papers.

Additional native pointer/keyboard checks opened and selected a paper in Paper Library, selected a word, opened compact help, applied a highlight, and opened the full inspector. The appearance popover rendered its three controls; direct slider dragging was not fully verified. Automated appearance-clamping/state tests passed. The website production build and all eighteen chapters/six practice scenarios passed at 1440px, 390px, and 320px with no console errors or horizontal overflow.

Remaining validation limits: no clean physical second Mac, no Intel runtime test, no end-to-end replacement of the user's installed app, and no exhaustive real-paper/MinerU/OCR quality benchmark. Original PDF remains the source of truth. These limits are not represented as completed tests.
