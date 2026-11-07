# PaperBridge for Windows (development preview)

This folder contains a Windows desktop port of PaperBridge. It follows the macOS app's local-first workflow and visual language. The Windows code is under active development; see the [111-item macOS 1.9↔Windows feature mapping](FEATURE_MAPPING.md), [macOS 1.9.1 incremental gap report](MAC_1_9_1_GAPS.md), [macOS 1.10 incremental mapping](MAC_1_10_GAPS.md), [parity summary](PARITY.md), and [whole-app review](WHOLE_APP_REVIEW.md) for current differences before treating it as a 1:1 replacement.

The parity target is **the same functionality and available actions**. Windows layout adapts to its fonts, window size and display scaling; macOS pixel dimensions are a reference, not a requirement.

Version 0.2.20 fixes long-paragraph chunking and adds an independent library metadata index. Formulas, links, punctuation and Unicode graphemes stay intact across model requests. Unreadable workspaces retain editable library labels, and same-ID reimport restores the original text without discarding those labels. The [release build](https://github.com/haoyunLi/PaperBridge/actions/runs/42359081106) passed 273 unit tests, 36 desktop suites and packaged startup. Both public executables were downloaded and hash-verified; a real 0.2.19→0.2.20 upgrade verified the update prompt, old-paper index migration, notes, highlights, appearance and restart. The public Portable passed the saved real-paper baseline plus actual bounded Markdown requests, damaged-workspace metadata editing and same-ID reimport. The chunking acceptance uses controlled responses; see the [AMD report](AMD_DEVICE_TEST.md) for separate real-model evidence and limits.

Version 0.2.19 saves the selected paragraph independently of the reading position, including source switches, history and structural Undo. Exports now use the saved output's language for headings and Mac-style filenames; older outputs with unknown or conflicting language records keep their text and generic names. Saved annotations now group an exact-anchor highlight and its notes into one entry, use clear source/translation labels and creation-time order, and keep full text in two-line previews. Deleting the active note synchronizes its editor; deleting a combined annotation is a single undoable action.

The [0.2.19 release build](https://github.com/haoyunLi/PaperBridge/actions/runs/42354219845) passed 259 unit tests, 36 desktop suites and packaged startup. Both public executables were downloaded and hash-verified. A real 0.2.18→0.2.19 upgrade preserved notes, highlights and reading appearance, while the published Portable retained a real paper, its saved AMD translation and unchanged PDF through a full restart. Separate fixtures verified selection/viewport independence, output-language cache preservation and annotation deletion/Undo. This acceptance did not run new model inference; see the [whole-app review](WHOLE_APP_REVIEW.md) for coverage and limits.

Version 0.2.18 gives paper titles more vertical space and up to two visible lines, with the complete title available on hover. Long Inspector content and the entire document sidebar scroll naturally; narrow sidebars scale the brand to keep it visible. Reader and Overview use consistent content insets. In very short viewports, the title becomes a single line and the Inspector opens over the workspace to keep reading space available. A narrow Document sidebar has a fixed **Close** button, including during PDF import, so its controls remain accessible with a mouse.

Version 0.2.18 also puts **Paste Text** in the sidebar. **Load Text** opens a new text paper in Overview, or restores an existing paper's saved view and edits. The draft stays available after loading; **Clear** only clears the input. You can prepare the next draft while a task runs. Opening a pasted paper waits for current notes to save, including edits made during that wait; a failed save keeps the current paper available for retry.

Download the Windows x64 development preview from the [Windows 0.2.20 release](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.20). Run the Setup executable to install for your Windows user, or open the Portable executable directly. The app can read and annotate PDFs immediately. Select **Local AI setup** when you first need translation, or to add MinerU for OCR and structured extraction. The executables are unsigned and Windows SmartScreen may show a prompt.

Code signing identifies the publisher and lets Windows verify the signed file's integrity. It does not change PaperBridge's features, translation quality or GPU acceleration. An unsigned executable can encounter startup restrictions on managed PCs or devices using Smart App Control; a newly signed release can also show a SmartScreen reputation warning. See [Microsoft's signing and reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation). SHA-256 checksums verify downloaded bytes and do not replace a publisher signature.

Version 0.2.11 adds separate zoom for exact PDFs in **Paper** and **Original**. Zoom with the PDF toolbar, **Ctrl+mouse wheel**, or **Ctrl+Plus/Minus**. Press **Ctrl+0** or choose **Fit** to fit the PDF to the window. Each view remembers its zoom for the current paper. PDF annotations remain anchored while scaling, and opening a saved annotation also brings its text into view horizontally.

**Reading Appearance** in the paper toolbar updates text size, line spacing, and reading width in the text views. New workspaces and **Reset Appearance** use size 16, 5 pixels of extra line spacing, and width 920, matching the macOS defaults. Existing Windows font sizes, widths and proportional spacing remain unchanged across updates and restarts. **Use extra spacing** switches proportional spacing to a fixed extra gap. Reselect a passage to show its existing translation and explanation for the current session.

Version 0.2.16 brings the Reader and sidebar closer to the macOS layout:

- Paragraph and heading menus group translation, editing, merging and reflow. The lightbulb opens the selected paragraph in Research Inspector; choose **Explain full paragraph** there to generate a result.
- **Edit or Split** opens a **Repair Paragraph** dialog. Blank lines split the text; **Ctrl+Enter** saves and **Escape** cancels. Drafts remain isolated from background commands and delayed callbacks.
- Headings follow Reading Appearance for text size and line spacing, while preserving distinct source and translation styles. The complete outline keeps two-line titles and paragraph numbers, with a **Beginning** link when headings are absent. Expand **Document & Import** for language swapping and Ollama/MinerU status.
- Overview source links reveal the original passage. Reopened papers show **Saved on this PC** immediately. Analysis exports group Reader highlights and notes with their paragraph and keep other or unresolved annotations in an appendix; failed full-translation batches carry inline context while retaining source text.
- Scrolling a text view after opening a paper interrupts delayed location restoration, so the previous saved position cannot pull the text back after you start reading elsewhere.
- New PDF/pasted-text imports repair spaced fragments such as `re- sults` using the Mac rules while retaining compounds such as `model-based`. Complete MinerU lists and quotations avoid prose-only extraction warnings. Existing saved text and annotation positions remain intact.

The [0.2.18 release build](https://github.com/haoyunLi/PaperBridge/actions/runs/42346834301) passed 203 unit tests, 33 desktop suites and packaged startup. Both public executables were downloaded and hash-verified; an actual 0.2.16→0.2.18 installer upgrade verified the update prompt and retained the test paper, annotations and reading appearance. The public Portable build reopened a real paper with its saved AMD translation and verified title spacing, narrow-window controls and inline paste. Document & Import also retains its closed state when an import immediately starts or is cancelled. See the [whole-app review](WHOLE_APP_REVIEW.md) for evidence and remaining differences.

Version 0.2.15 adds original/translation language labels, bilingual dividers, full selected-card outlines and direct translation/setup buttons to Reader paragraphs. Compact headings keep their separate layout. Existing highlights and notes stay anchored to the passage text.

From a scanned page, **Open OCR Reader** opens the first located OCR passage on that page. **Back** restores the original PDF page and scroll position.

In version 0.2.13, **File > Export Markdown or Bundle**, **Ctrl+Shift+E**, and the export action under **More** open the appropriate save dialog. PDF and MinerU papers export to a folder with Markdown and referenced assets. Pasted text exports an analysis file with the source passages, saved translations, summary, evidence and annotations. **More > Export Options** still offers the separate Markdown editions and the portable bundle.

In a MinerU bundle, the original edition uses the stored MinerU Markdown. Translated and bilingual editions keep original wording wherever translation is unfinished and retain figures, equations and reference links. A saved structured full draft is exported using the current paragraph translations. PDF text bundles preserve the source passage when its translation is unavailable.

MinerU exports and recovered page references use the files from the saved extraction. Older workspaces reuse a local resource directory when its Markdown uniquely matches the saved source. If an attachment cannot be verified or found, the export keeps its link and reports it as missing.

Version 0.2.14 retains local files referenced by the main Markdown in new MinerU 4.x ZIP imports, including CSV and supplemental Markdown. The export rewrites their paths and preserves query strings and fragments. Attachments are limited to 256 MiB per file and 1 GiB per archive. Re-extract an older PDF as a new copy to recover attachments omitted by a previous release.

File Explorer selects the new folder when a portable bundle is ready, including the page index for a PDF bundle. PaperBridge also displays its path. If you stop page export, the files completed so far remain in the chosen destination.

Version 0.2.12 prepares PNG previews for the first 120 original pages during PDF text import, including scans and MinerU fallback. The import screen shows progress and lets you cancel without replacing the open paper. Portable Markdown export reuses completed pages across restarts and regenerates missing or damaged entries. Each bundle includes its own images and exact original PDF. Clearing saved PaperBridge data removes the page archive.

In version 0.2.15, portable page images use a 1,800-pixel longest edge and follow the PDF page crop and rotation. Existing papers regenerate older previews on the next export. The original PDF, reader zoom and saved annotations retain their existing behavior.

Version 0.2.15 also keeps the Reader display modes, search and undo above the scrolling text. Choose **Bilingual**, **Original** or **Translation** with the segmented control or arrow keys. **Ctrl+F** focuses search; **Clear search** and **Escape** return to the paragraph you were reading. That paragraph survives resizing, changing display mode during search, or closing the app with a filter active.

The Paper Library lists recently opened papers first, with their translation progress and tags. A library label changes how the paper appears in the library. The document title and export filename still use the original name.

During paragraph translation, **More > Translation Range > Prioritize current section in queue** moves the current section’s waiting blocks after the block in progress. The menu shows how many queued blocks can move. **Stop** keeps completed blocks, and **Resume Translation** retries unfinished blocks, including failures. The progress bar counts failures from the current pass. The sidebar shows the paper’s total.

AI tasks open the setup they need when the runtime, task models, or session permission are missing. Local task setup selects Ollama and the required models by default. **Choose task models** opens Models to select an installed alternative. OpenAI tasks open Models for key, model and session permission setup. Run the task after closing settings.

**Saved Terminology** prioritizes longer matching phrases in the selected language direction. Up to 24 matches guide paragraph, selection, and full translations as a dictionary. A term saved from translated text uses the reverse direction. A write failure keeps the draft or existing entry available for retry, and changing terminology leaves completed translations intact.

The current reader supports PDF drag/drop, automatic MinerU-first extraction with PDF text fallback, a separate new extraction copy, three reading modes, chapter translation with exact unfinished counts, source-checked bilingual summaries, exact Reader notes and highlights, and selection tools in Paper, Overview summaries, and Full Translation. Paper shows the exact native PDF in Original mode and the full reflowed document in Bilingual or Translation mode; Overview combines extraction review, an exact five-topic source map and optional bilingual summary like the macOS workspace. Its normalized heading rules never borrow an excerpt from the next section, and the guide includes the Mac questions, translation progress, Start Reading and View Original actions. Paper and Reader block annotations keep separate scopes and original/translation sides. Exact-PDF annotations created inside Paper are also separate from annotations in the extra Original tab. Every record renders only in its source view, carries an explicit export label, and returns to the original text and display mode; older unscoped block/PDF records remain Reader/Original annotations. When the inspector is closed, a macOS-style Quick Selection card offers translation, explanation, Amber/Cobalt/Coral highlighting, explicit highlight removal, terminology and Notes & More. Quick Selection and the expanded inspector both show lookup progress, Cancel, completion, cache-hit and local error messages. Selection translation uses at most 600 characters of surrounding context, marks that context as reference-only, and automatically retries an abnormally long short-selection result with a strict exact-selection prompt; explanations use at most 2400 context characters. Translation and explanation stay visible together; choosing another color replaces the old color for that exact selection, while removing the highlight keeps its note. Under 1400px the Research Inspector uses the macOS-style 190–340px bottom drawer with separate scrolling columns for selection and supporting content; wider windows restore the right sidebar. Legacy `blue` records remain readable as Cobalt. Independent plain-text and Markdown headings use compact bilingual rows with translation/retry, source and translation annotations, bookmarks, explanation, structure actions and translated exports; a heading followed by body text in the same paragraph stays a normal translatable paragraph. Notes update immediately, coalesce disk writes for 350 ms, preserve exact whitespace, flush when editing ends or the app closes, and retain a retryable in-memory snapshot after save failure. Reading jumps keep up to 50 Back / Forward locations in the current paper session, including tab, display mode, search, block, PDF page and per-view scroll; use the header buttons, Ctrl+[ / Ctrl+], or the Paper menu. Each paper saves its languages, models, parsing choices, explanation language and results, and inspector state; reading appearance stays global. Output caches follow their settings and source, and the last opened paper is recorded separately from library modification order. Task and save state stay above the scrolling document, and cancelled requests that finish late are ignored.

Overview summaries and Full Translation display inline highlights and support saved-note navigation. Annotation undo preserves AI outputs generated afterward. Reader navigation clears search filters, and the current translation section follows scrolling. **Export portable Markdown bundle** writes Markdown files, image assets, the unchanged original PDF, and PNG reading copies for up to the first 120 PDF pages. Analysis and bilingual exports include bookmarks, highlights, notes, source/translation sides, and review notices for changed anchors. Page images can take time and disk space on long papers. See the mapping for the remaining details.

Use **Focus Reading** in the paper toolbar or **View**, or press **Ctrl+Alt+F**, to hide both panels and restore them on exit. **Ctrl+Alt+S** toggles the document sidebar. Quick Selection lets you select result text in a scrolling area. Closing the card preserves the paper selection so you can open it in the Research Inspector.

In version 0.2.15, drag the dividers to resize the document sidebar and, in a wide window, the Research Inspector. You can also focus a divider and use the arrow keys, **Home** or **End**. Widths are kept for the current session, including when leaving Focus Reading. The saved indicator sits at the right edge above the reading area, and save errors still offer **Retry save**.

Tab to a reading area or click its text, then hold **Shift** and use the arrow keys to select. Use **Ctrl+Shift+Left/Right** to select by word or **Shift+Home/End** to select to a line boundary. The selection is available to the inspector and the usual translation and highlighting shortcuts.

**Generate summary** divides long body text into excerpts of at most 6,000 characters including paragraph labels. It consolidates claims as it reads and translates each final claim separately so the two summaries keep the same numbering. The two languages appear side by side when space permits. Expand a claim under **Check the Sources** to read its quotations or review the missing-evidence notice. Source links require a verbatim quote from the cited paragraph in the excerpt the model received. Consolidation can retain previously validated quotations. Clicking a source link opens the original block in Reader and selects the quote when it has a unique location. Back returns to the expanded claim. Editing a paragraph marks the summary stale and updates citations that can still be traced to the original passage. Undo restores the prior citations if the summary has not been replaced. A stopped or truncated regeneration leaves the saved summary available.

For MinerU documents, **Full Translation** builds a continuous draft from the Reader's translated blocks. It only sends unfinished text to the selected model. Formulas, images, tables and references keep their original content, and a failed block keeps its original text until a retry succeeds. Retrying in Reader updates the full draft and its Markdown export.

For pasted text and the selectable PDF text layer, **Full Translation** groups adjacent paragraphs into excerpts of at most 4,800 characters after protecting formulas, links and inline assets. Completed batches are saved as they finish. **Resume unfinished batches** retries failed and interrupted excerpts after stopping or reopening the app. The draft and its export show original text for unfinished excerpts, and references stay in their original language. **Regenerate** starts a fresh pass over a completed draft.

PDF text and MinerU keep separate summaries, full drafts, and annotations for each set of AI settings. Returning to a source restores its saved output and unfinished batches. A draft archived before its source was edited is available for review with a source-change notice.

When a paper uses its PDF text layer, **Paper** in Bilingual or Translation mode and **Full Translation** show a browsable original page with the text. Wide views place them side by side. Use **Open original PDF** to select and annotate the exact page. A portable bundle places the original page images and a link to the unchanged PDF before the extracted text in its reading documents, including Full Translation. If you stop rendering pages, the bundle keeps the Markdown, original PDF, and previews already saved.

PDF import shows the selected filename, elapsed time, and MinerU layout, formula and text stages. **Cancel Import** returns to the previous paper. In **MinerU only** mode a failed or unreadable result keeps the current paper and reports the cause. **MinerU preferred** keeps the original PDF and uses any selectable text when MinerU fails. The fallback reason appears again when you reopen the paper. **PDF only** reads the original and its text layer without starting MinerU. **Re-extract PDF as New Copy** uses the same import rules and preserves the saved version.

On a scanned page in Paper or Original, **Open OCR Reader** opens the saved MinerU text. If the paper is showing the PDF text layer, the button switches to MinerU. Use Back to return to the original page and reading source.

**Export portable Markdown bundle** includes figures in Markdown and HTML tables, plus available files linked from the saved MinerU output. The Markdown uses relative links to the exported files, and the result reports how many local references could not be included.

## Build and run

Requirements: Windows 10 or later, Node.js 20.19+ or 22.12+, and npm. From this folder:

```powershell
npm ci
npm run dev
```

To verify and create Windows executables:

```powershell
npm test
npm run build
npm run test:e2e
npm run test:paper-settings-e2e
npm run test:last-opened-e2e
npm run test:model-pull-e2e
npm run test:menu-state-e2e
npm run test:menu-ui-e2e
npm run test:setup-components-e2e
npm run test:onboarding-e2e
npm run test:onboarding-startup-e2e
npm run test:settings-models-e2e
npm run test:openai-settings-e2e
npm run test:import-progress-e2e
npm run test:paste-text-e2e
npm run test:short-workspace-e2e
npm run test:mineru-detect-e2e
npm run test:update-restart-e2e
npm run test:official-links-e2e
npm run test:reader-review-e2e
npm run test:reading-history-e2e
npm run test:heading-parity-e2e
npm run test:note-autosave-e2e
npm run test:task-isolation-e2e
npm run test:markdown
npm run test:reopen-mineru
npm run dist
npm run test:packaged
node tests/installer-e2e.cjs --preflight
```

The NSIS installer and portable executable appear in `release/` as `PaperBridge-Windows-<version>-x64-Setup.exe` and `PaperBridge-Windows-<version>-x64-Portable.exe`. The installer uses the per-user default directory to stay within the NSIS update path limit. GitHub Actions uploads both executables and their SHA-256 checksums. A `windows-vX.Y.Z` tag that matches the package version publishes the same four files to a dedicated Windows Release. The repository's Latest release remains the macOS download.

Build before running the Electron suites, which load `dist/`. Each regression suite uses an isolated workspace under `test-artifacts/`. The service-based regression tests use a local fake Ollama server or controlled IPC; real model and hardware checks are separate. The opt-in [real NSIS lifecycle test](tests/installer-e2e.md) installs only after a read-only safety preflight, then checks first install, same-version reinstall, saved-paper recovery, uninstall and retained local data.

For an opt-in device check, `npm run test:live-ocr` generates an image-only PDF, imports it through the app with MinerU, translates an OCR paragraph with local Ollama, and verifies that Original can return to the OCR Reader. It requires the managed MinerU Python environment, a running Ollama service, and `translategemma:4b` (or `PAPERBRIDGE_LIVE_MODEL`). The [AMD device report](AMD_DEVICE_TEST.md) records results from an RX 7800 XT; the latest [whole-app review](WHOLE_APP_REVIEW.md#验证范围) includes another successful real OCR and GPU translation run. Complex real-world scans and NVIDIA devices still require separate checks.

## Updates

PaperBridge checks the official GitHub Release API for published `windows-vX.Y.Z` releases at startup and, while open, at most once per day after a successful check. Failed network requests can retry at the next hourly check. A validated newer-release result is cached locally, rechecked against the current app version, and remains visible after restart; stale cached availability remains visible if a later refresh fails. Settings lets you turn off automatic checks or select **Check now**. The banner opens the official release page for review and download. The current unsigned preview does not download or run installers automatically. Mac releases use a separate tag and are ignored. The update request contains the app version and standard network metadata; no paper, note, or translation content is sent. A Windows release tag must match the version in `windows/package.json`; the GitHub workflow checks this before publishing its installer.

## Local AI and GPU acceleration

First launch opens a six-step **Getting Started** guide: introduction, Ollama, translation model, optional MinerU, optional assistant model, and readiness summary. The guide saves its page, supports skipping, and can be reopened from Settings or the Help menu. Downloads start only after you click their button; running setup or model downloads keep the guide open until completion or cancellation. The final step can open a PDF or load a practice paper.

The guide and **Settings > Local AI** have the Mac app's three TranslateGemma sizes (4B/12B/27B) and six optional assistants, with download estimates and installed/selected states. The starting suggestion uses system RAM, which is separate from GPU VRAM. Choosing an assistant applies it to summary, explanation and quick lookup. Choosing a translation model preserves installed specialist assistants and updates roles that followed the previous translation model or are missing locally.

Open **Local AI setup** from the sidebar or Settings to choose Ollama, task models, and MinerU. **Install missing components** retains working components. Model downloads start or install Ollama if needed. **Repair / update MinerU** checks the new runtime before removing the previous managed environment. A failed or cancelled check restores the previous installation. Once the parser is ready, cancelling optional model preloading keeps the parser installed. MinerU can require several gigabytes. Windows and your graphics vendor manage GPU drivers.

Settings is split into Local AI, Parsing, Models, Reading, Updates and Local Data. It supports manual model download with streaming progress, cancellation and retry, four independent task-model selectors, reading language/chunk/appearance controls, and hardware/runtime status. Download status remains visible when switching tabs. Manual downloads and one-click installation cannot run concurrently. Component-selection and repair/cancellation flows have automated tests with controlled installation responses; the existing RX 7800 XT installation was retained during this review.

PaperBridge connects only to an Ollama HTTP server on `localhost`, `127.0.0.1`, or `::1`. Reading, notes, bookmarks, and the original PDF do not require Ollama. The manual [Ollama for Windows](https://ollama.com/download/windows) path remains available.

Ollama selects a supported CPU or GPU backend. On Windows this can include NVIDIA, supported AMD ROCm devices, and Vulkan-capable GPUs. **Settings > Graphics acceleration** lists the video adapters and NVIDIA driver tool when available. After a model runs, **Check** reports the VRAM allocation returned by Ollama's `/api/ps`. The presence of a GPU alone does not prove that a model ran on it. See [Ollama hardware support](https://docs.ollama.com/gpu) and the [running-model API](https://docs.ollama.com/api/ps).

MinerU is optional. On Windows x64, setup installs MinerU 4.1.7 with ONNX when the legacy NVIDIA CUDA path is unavailable. MinerU 4.1 uses DirectML or CPU for local Basic-tier parsing and OCR. On a fresh installation with an eligible NVIDIA CUDA driver, setup retains the MinerU 3.4.5 path with matching PyTorch CUDA wheels. A working installation is reused, and Repair / update can upgrade an older non-CUDA managed installation. Setup verifies the uv checksum, installs a private Python environment, checks the parser, preloads the selected models, and restores the previous environment if activation fails. [MinerU Windows runtime guide](https://opendatalab.github.io/MinerU/quick_start/) · [Legacy CUDA guide](https://pytorch.org/get-started/locally/)

MinerU paragraphs with a verified page show their page in Reader. **Compare Original** opens the page where the passage begins. New MinerU 4.x extractions keep page metadata from the same local run. Older papers can recover pages from their matching extraction files or a unique passage in the saved PDF text layer. When the page remains unknown, comparison opens at the current PDF page. [MinerU output formats](https://opendatalab.github.io/MinerU/reference/output_files/)

**Settings > Parsing > Use Auto-Detect** checks the managed installation and then `PATH`. An explicit `mineru.exe` path takes precedence. Supported parsers are 3.x and 4.1+ within the 4.x series, with `mineru-kit.exe` beside the 4.x launcher. **Auto** uses MinerU's device selection. **Compatibility mode** selects ONNX CPU on 4.x or the legacy pipeline on 3.x. PaperBridge invokes the local MinerU 4.x CLI for all pages and keeps its configuration in the private tools directory with telemetry disabled. The Graphics acceleration panel shows which adapter MinerU would select in Auto, separately from Ollama model VRAM.

## Optional OpenAI provider

Ollama remains the default. Under **Settings > Models**, you may explicitly choose **OpenAI (Online)**, save your own API key, select separate translation, summary, explanation and quick-lookup model IDs, and enable permission for the current app session. No paid model is selected automatically, there is no automatic cloud fallback, and permission is never restored after restart. Switching provider/model/style keeps earlier output variants so they can be restored later without re-enabling online access.

The key is encrypted for the current Windows account through Electron `safeStorage` / Windows DPAPI and is never stored in settings, papers, or exports. OpenAI requests use the official Responses API with `store: false`; redirects, partial responses, refusals and malformed output are rejected. `store: false` does not guarantee zero retention. Selection requests send the selected text, bounded nearby context, paper title and matching terms; whole-paper tasks send extracted text in batches. PaperBridge does not upload PDF files or image bytes. API usage is billed separately from ChatGPT. Clearing PaperBridge workspaces retains the separately managed key; remove it explicitly in Models.

## Data location and privacy

Papers, source PDF copies, translations, notes, and settings are stored in PaperBridge's local Electron user-data directory under `%APPDATA%`. JSON saves keep one readable `.backup` copy. The original source file is copied into the workspace, so moving or deleting the imported file does not remove the saved PDF. **Settings > Remove all saved PaperBridge data** clears saved workspaces, settings, and terminology while retaining copied original PDFs and the separately encrypted OpenAI key. No cloud account is required for local use. Development runs use the separate **PaperBridge Dev** user-data directory so they do not reuse the installed app's workspace.

## Development layout

- `electron/` — native dialogs, secure local storage, MinerU process, Ollama IPC, GPU inventory.
- `src/` — reader, PDF.js original PDF, translation, summary, library, annotations, settings.
- `tests/` — unit tests, isolated Electron workflow suites, packaged startup checks, and opt-in real Ollama/MinerU device tests.
- `assets/` — Windows icon generated from the macOS brand mark with `node scripts/make-icon.cjs`.

Keep macOS and Windows in this repository, with separate platform folders and build jobs. Shared behavior can migrate into cross-platform packages once both ports are stable.
