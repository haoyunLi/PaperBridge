# PaperBridge for Windows (development preview)

This folder contains a Windows desktop port of PaperBridge. It follows the macOS app's local-first workflow and visual language. The Windows code is under active development; see the [111-item macOS 1.9↔Windows feature mapping](FEATURE_MAPPING.md), [macOS 1.9.1 incremental gap report](MAC_1_9_1_GAPS.md), [parity summary](PARITY.md), and [whole-app review](WHOLE_APP_REVIEW.md) for current differences before treating it as a 1:1 replacement.

The current reader supports PDF drag/drop, automatic MinerU-first extraction with PDF text fallback, a separate new extraction copy, three reading modes, chapter translation, source-checked bilingual summaries, exact Reader notes and highlights, and selection tools in Paper, Summary, and Full Translation. Notes update immediately, coalesce disk writes for 350 ms, preserve exact whitespace, flush when editing ends or the app closes, and retain a retryable in-memory snapshot after save failure. Each paper saves its languages, models, parsing choices, explanation language and results, and inspector state; reading appearance stays global. Output caches follow their settings and source, and the last opened paper is recorded separately from library modification order. Task and save state stay above the scrolling document, and cancelled requests that finish late are ignored.

Summary and Full Translation display inline highlights and support saved-note navigation. Annotation undo preserves AI outputs generated afterward. Reader navigation clears search filters, and the current translation section follows scrolling. **Export portable Markdown bundle** writes Markdown files, image assets, the unchanged original PDF, and PNG reading copies for up to the first 120 PDF pages. Analysis and bilingual exports include bookmarks, highlights, notes, source/translation sides, and review notices for changed anchors. Page images can take time and disk space on long papers. See the mapping for the remaining details.

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
npm run test:mineru-detect-e2e
npm run test:update-restart-e2e
npm run test:official-links-e2e
npm run test:reader-review-e2e
npm run test:note-autosave-e2e
npm run test:task-isolation-e2e
npm run test:markdown
npm run test:reopen-mineru
npm run dist
npm run test:packaged
node tests/installer-e2e.cjs --preflight
```

The NSIS installer and portable executable appear in `release/`. The assisted installer uses electron-builder's safe per-user default directory; a custom path page is disabled because NSIS update removal still has a traditional 260-character boundary for the longest unpacked file. GitHub Actions also uploads the Windows build as a workflow artifact. Builds are currently unsigned, so Windows SmartScreen may warn until release signing is configured.

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

MinerU is optional. The managed installer pins MinerU 3.4.5 because the current reader uses its 3.x command interface. It downloads a SHA-256-verified uv binary, creates an isolated Python environment, installs MinerU, verifies the command, and preloads pipeline models. A previous managed installation is restored if activation fails. **Settings > Parsing > Use Auto-Detect** uses the same resolver as import and setup status: it prefers the compatible app-managed command, then checks `PATH`; an explicit executable remains authoritative. If NVIDIA reports CUDA 12.6 or newer, setup tries the matching PyTorch CUDA wheel in this same environment and checks `torch.cuda.is_available()` afterward. If the wheel or runtime fails, the CPU pipeline remains available and the setup panel reports the reason. AMD GPUs can accelerate Ollama where supported; CUDA does not apply to AMD. **Auto** lets MinerU choose available acceleration. **Pipeline compatibility mode** passes `-b pipeline`. You can still manually install MinerU and enter its executable path in Settings. See the [MinerU 3.4.5 quick usage guide](https://github.com/opendatalab/MinerU/blob/mineru-3.4.5-released/docs/en/usage/quick_usage.md) and [PyTorch installer](https://pytorch.org/get-started/locally/).

## Data location and privacy

Papers, source PDF copies, translations, notes, and settings are stored in PaperBridge's local Electron user-data directory under `%APPDATA%`. JSON saves keep one readable `.backup` copy. The original source file is copied into the workspace, so moving or deleting the imported file does not remove the saved PDF. **Settings > Remove all saved PaperBridge data** clears saved workspaces, settings, and terminology while retaining the copied original PDFs. No cloud account is required.

## Development layout

- `electron/` — native dialogs, secure local storage, MinerU process, Ollama IPC, GPU inventory.
- `src/` — reader, PDF.js original PDF, translation, summary, library, annotations, settings.
- `tests/` — unit tests, isolated Electron workflow suites, packaged startup checks, and opt-in real Ollama/MinerU device tests.
- `assets/` — Windows icon generated from the macOS brand mark with `node scripts/make-icon.cjs`.

Keep macOS and Windows in this repository, with separate platform folders and build jobs. Shared behavior can migrate into cross-platform packages once both ports are stable.
