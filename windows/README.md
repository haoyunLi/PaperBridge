# PaperBridge for Windows (development preview)

This folder contains a Windows desktop port of PaperBridge. It follows the macOS app's local-first workflow and visual language. The Windows code is under active development; see the [111-item macOS 1.9↔Windows feature mapping](FEATURE_MAPPING.md), [macOS 1.9.1 incremental gap report](MAC_1_9_1_GAPS.md), [macOS 1.10 incremental mapping](MAC_1_10_GAPS.md), [parity summary](PARITY.md), and [whole-app review](WHOLE_APP_REVIEW.md) for current differences before treating it as a 1:1 replacement.

Download the Windows x64 development preview from the [Windows 0.2.0 release](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.0). Run the Setup executable to install for your Windows user, or open the Portable executable directly. The app can read and annotate PDFs immediately. Select **Local AI setup** when you first need translation, or to add MinerU for OCR and structured extraction. The executables are unsigned and Windows SmartScreen may show a prompt.

The Paper Library lists recently opened papers first, with their translation progress and tags. A library label changes how the paper appears in the library. The document title and export filename still use the original name.

**Saved Terminology** prioritizes longer matching phrases in the selected language direction. Up to 24 matches guide paragraph, selection, and full translations as a dictionary. A term saved from translated text uses the reverse direction. A write failure keeps the draft or existing entry available for retry, and changing terminology leaves completed translations intact.

The current reader supports PDF drag/drop, automatic MinerU-first extraction with PDF text fallback, a separate new extraction copy, three reading modes, chapter translation with exact unfinished counts, source-checked bilingual summaries, exact Reader notes and highlights, and selection tools in Paper, Overview summaries, and Full Translation. Paper shows the exact native PDF in Original mode and the full reflowed document in Bilingual or Translation mode; Overview combines extraction review, an exact five-topic source map and optional bilingual summary like the macOS workspace. Its normalized heading rules never borrow an excerpt from the next section, and the guide includes the Mac questions, translation progress, Start Reading and View Original actions. Paper and Reader block annotations keep separate scopes and original/translation sides. Exact-PDF annotations created inside Paper are also separate from annotations in the extra Original tab. Every record renders only in its source view, carries an explicit export label, and returns to the original text and display mode; older unscoped block/PDF records remain Reader/Original annotations. When the inspector is closed, a macOS-style Quick Selection card offers translation, explanation, Amber/Cobalt/Coral highlighting, explicit highlight removal, terminology and Notes & More. Quick Selection and the expanded inspector both show lookup progress, Cancel, completion, cache-hit and local error messages. Selection translation uses at most 600 characters of surrounding context, marks that context as reference-only, and automatically retries an abnormally long short-selection result with a strict exact-selection prompt; explanations use at most 2400 context characters. Translation and explanation stay visible together; choosing another color replaces the old color for that exact selection, while removing the highlight keeps its note. Under 1400px the Research Inspector uses the macOS-style 190–340px bottom drawer with separate scrolling columns for selection and supporting content; wider windows restore the right sidebar. Legacy `blue` records remain readable as Cobalt. Independent plain-text and Markdown headings use compact bilingual rows with translation/retry, source and translation annotations, bookmarks, explanation, structure actions and translated exports; a heading followed by body text in the same paragraph stays a normal translatable paragraph. Notes update immediately, coalesce disk writes for 350 ms, preserve exact whitespace, flush when editing ends or the app closes, and retain a retryable in-memory snapshot after save failure. Reading jumps keep up to 50 Back / Forward locations in the current paper session, including tab, display mode, search, block, PDF page and per-view scroll; use the header buttons, Ctrl+[ / Ctrl+], or the Paper menu. Each paper saves its languages, models, parsing choices, explanation language and results, and inspector state; reading appearance stays global. Output caches follow their settings and source, and the last opened paper is recorded separately from library modification order. Task and save state stay above the scrolling document, and cancelled requests that finish late are ignored.

Overview summaries and Full Translation display inline highlights and support saved-note navigation. Annotation undo preserves AI outputs generated afterward. Reader navigation clears search filters, and the current translation section follows scrolling. **Export portable Markdown bundle** writes Markdown files, image assets, the unchanged original PDF, and PNG reading copies for up to the first 120 PDF pages. Analysis and bilingual exports include bookmarks, highlights, notes, source/translation sides, and review notices for changed anchors. Page images can take time and disk space on long papers. See the mapping for the remaining details.

**Generate summary** divides long body text into excerpts of at most 6,000 characters including paragraph labels. It consolidates claims as it reads and translates each final claim separately so the two summaries keep the same numbering. Source links require a verbatim quote from the cited paragraph in the excerpt the model received. Consolidation can retain previously validated quotations. Clicking a source link in Translation mode reveals the corresponding original block in the Bilingual Reader. A stopped or truncated regeneration leaves the saved summary available.

For MinerU documents, **Full Translation** builds a continuous draft from the Reader's translated blocks. It only sends unfinished text to the selected model. Formulas, images, tables and references keep their original content, and a failed block keeps its original text until a retry succeeds. Retrying in Reader updates the full draft and its Markdown export.

For pasted text and the selectable PDF text layer, **Full Translation** groups adjacent paragraphs into excerpts of at most 4,800 characters after protecting formulas, links and inline assets. Completed batches are saved as they finish. **Resume unfinished batches** retries failed and interrupted excerpts after stopping or reopening the app. The draft and its export show original text for unfinished excerpts, and references stay in their original language. **Regenerate** starts a fresh pass over a completed draft.

When a paper uses its PDF text layer, **Paper** in Bilingual or Translation mode and **Full Translation** show a browsable original page with the text. Wide views place them side by side. Use **Open original PDF** to select and annotate the exact page. A portable bundle places the original page images and a link to the unchanged PDF before the extracted text in its reading documents, including Full Translation. If you stop rendering pages, the bundle keeps the Markdown, original PDF, and previews already saved.

PDF import now follows macOS 1.9.2/1.10 feedback: the selected filename replaces stale content, elapsed time and recognized MinerU layout/formula/text stages are shown, and Cancel Import returns to the previous paper. A failed or late import cannot replace the previous translations, notes, bookmarks, or reading position.

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

Open **Local AI setup** from the sidebar or Settings for component selection. Choose Ollama, the models assigned to your tasks, and/or MinerU. **Install missing components** retains working components. Model downloads start or install Ollama if it is needed. **Repair / update MinerU** reinstalls the app-supported version in a private environment and restores the previous managed environment if activation fails. Progress and cancellation are available. MinerU can need several gigabytes; GPU drivers remain managed by Windows and your graphics vendor.

Settings is split into Local AI, Parsing, Models, Reading, Updates and Local Data. It supports manual model download with streaming progress, cancellation and retry, four independent task-model selectors, reading language/chunk/appearance controls, and hardware/runtime status. Download status remains visible when switching tabs. Manual downloads and one-click installation cannot run concurrently. Component-selection and repair/cancellation flows have automated tests with controlled installation responses; the existing RX 7800 XT installation was retained during this review.

PaperBridge connects only to an Ollama HTTP server on `localhost`, `127.0.0.1`, or `::1`. Reading, notes, bookmarks, and the original PDF do not require Ollama. The manual [Ollama for Windows](https://ollama.com/download/windows) path remains available.

Ollama selects a supported CPU or GPU backend. On Windows this can include NVIDIA, supported AMD ROCm devices, and Vulkan-capable GPUs. **Settings > Graphics acceleration** lists the video adapters and NVIDIA driver tool when available. After a model runs, **Check** reports the VRAM allocation returned by Ollama's `/api/ps`. The presence of a GPU alone does not prove that a model ran on it. See [Ollama hardware support](https://docs.ollama.com/gpu) and the [running-model API](https://docs.ollama.com/api/ps).

MinerU is optional. On Windows x64, setup installs MinerU 4.1.7 with ONNX when the legacy NVIDIA CUDA path is unavailable. MinerU 4.1 uses DirectML or CPU for local Basic-tier parsing and OCR. On a fresh installation with an eligible NVIDIA CUDA driver, setup retains the MinerU 3.4.5 path with matching PyTorch CUDA wheels. A working installation is reused, and Repair / update can upgrade an older non-CUDA managed installation. Setup verifies the uv checksum, installs a private Python environment, checks the parser, preloads the selected models, and restores the previous environment if activation fails. [MinerU Windows runtime guide](https://opendatalab.github.io/MinerU/quick_start/) · [Legacy CUDA guide](https://pytorch.org/get-started/locally/)

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
