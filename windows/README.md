# PaperBridge for Windows (development preview)

This folder contains a Windows desktop port of PaperBridge. It follows the macOS app's local-first workflow and visual language. The Windows code is under active development; see the [111-item macOS↔Windows feature mapping](FEATURE_MAPPING.md) and [parity summary](PARITY.md) for current differences before treating it as a 1:1 replacement.

The current reader supports PDF drag/drop, automatic MinerU-first extraction with PDF text fallback, a separate new extraction copy, three reading modes, chapter translation, source-checked bilingual summaries, exact Reader notes and highlights, and selection tools in Paper, Summary, and Full Translation. Summary and Full Translation selections can save notes and highlights in the inspector; inline coloring in those Markdown views remains in progress. **Export portable Markdown bundle** writes Markdown files, image assets, the unchanged original PDF, and PNG reading copies for up to the first 120 PDF pages. Page images can take time and disk space on long papers. See the mapping for the remaining details.

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
npm run dist
```

The NSIS installer and portable executable appear in `release/`. GitHub Actions also uploads the Windows build as a workflow artifact. Builds are currently unsigned, so Windows SmartScreen may warn until release signing is configured.

For an opt-in device check, `npm run test:live-ocr` generates an image-only PDF, imports it through the app with MinerU, translates an OCR paragraph with local Ollama, and verifies that Original can return to the OCR Reader. It requires the managed MinerU Python environment, a running Ollama service, and `translategemma:4b` (or `PAPERBRIDGE_LIVE_MODEL`). The [AMD device report](AMD_DEVICE_TEST.md) records results from an RX 7800 XT.

## Updates

PaperBridge checks the official GitHub Release API for published `windows-vX.Y.Z` releases at startup and, while open, at most once per day. Settings lets you turn off automatic checks or select **Check now**. When a newer Windows installer is published, the app shows a banner that opens that release page for review and download. The current unsigned preview does not download or run installers automatically. Mac releases use a separate tag and are ignored. The update request contains the app version and standard network metadata; no paper, note, or translation content is sent. A Windows release tag must match the version in `windows/package.json`; the GitHub workflow checks this before publishing its installer.

## Local AI and GPU acceleration

Open **Set up local AI** on the welcome screen, in the sidebar, or through Settings. PaperBridge checks the local Ollama service, selected models, MinerU installation, and graphics hardware. **Install missing components** starts an existing Ollama installation or downloads its official signed Windows installer, downloads the selected Ollama models, and installs MinerU into a private Python 3.12 environment. Progress and cancellation are available in the setup panel. Existing working installations are retained. MinerU can need several gigabytes; the first setup may take a while. GPU drivers are not installed by PaperBridge.

PaperBridge connects only to an Ollama HTTP server on `localhost`, `127.0.0.1`, or `::1`. Reading, notes, bookmarks, and the original PDF do not require Ollama. The manual [Ollama for Windows](https://ollama.com/download/windows) path remains available.

Ollama selects a supported CPU or GPU backend. On Windows this can include NVIDIA, supported AMD ROCm devices, and Vulkan-capable GPUs. **Settings > Graphics acceleration** lists the video adapters and NVIDIA driver tool when available. After a model runs, **Check** reports the VRAM allocation returned by Ollama's `/api/ps`. The presence of a GPU alone does not prove that a model ran on it. See [Ollama hardware support](https://docs.ollama.com/gpu) and the [running-model API](https://docs.ollama.com/api/ps).

MinerU is optional. The managed installer pins MinerU 3.4.5 because the current reader uses its 3.x command interface. It downloads a SHA-256-verified uv binary, creates an isolated Python environment, installs MinerU, verifies the command, and preloads pipeline models. A previous managed installation is restored if activation fails. If NVIDIA reports CUDA 12.6 or newer, setup tries the matching PyTorch CUDA wheel in this same environment and checks `torch.cuda.is_available()` afterward. If the wheel or runtime fails, the CPU pipeline remains available and the setup panel reports the reason. AMD GPUs can accelerate Ollama where supported; CUDA does not apply to AMD. **Auto** lets MinerU choose available acceleration. **Pipeline compatibility mode** passes `-b pipeline`. You can still manually install MinerU and enter its executable path in Settings. See the [MinerU 3.4.5 quick usage guide](https://github.com/opendatalab/MinerU/blob/mineru-3.4.5-released/docs/en/usage/quick_usage.md) and [PyTorch installer](https://pytorch.org/get-started/locally/).

## Data location and privacy

Papers, source PDF copies, translations, notes, and settings are stored in PaperBridge's local Electron user-data directory under `%APPDATA%`. JSON saves keep one readable `.backup` copy. The original source file is copied into the workspace, so moving or deleting the imported file does not remove the saved PDF. **Settings > Remove all saved PaperBridge data** clears saved workspaces, settings, and terminology while retaining the copied original PDFs. No cloud account is required.

## Development layout

- `electron/` — native dialogs, secure local storage, MinerU process, Ollama IPC, GPU inventory.
- `src/` — reader, PDF.js original PDF, translation, summary, library, annotations, settings.
- `tests/` — unit tests and an Electron workflow test with a local fake Ollama server and sample PDF.
- `assets/` — Windows icon generated from the macOS brand mark with `node scripts/make-icon.cjs`.

Keep macOS and Windows in this repository, with separate platform folders and build jobs. Shared behavior can migrate into cross-platform packages once both ports are stable.
