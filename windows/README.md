# PaperBridge for Windows (development preview)

This folder contains a Windows desktop port of PaperBridge. It follows the macOS app's local-first workflow and visual language. The Windows code is under active development; consult [PARITY.md](PARITY.md) before calling it a feature-complete 1:1 replacement.

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

## Local AI and GPU acceleration

PaperBridge connects only to an Ollama HTTP server on `localhost`, `127.0.0.1`, or `::1`. Install [Ollama for Windows](https://ollama.com/download/windows), start it, then use **Settings** to download `translategemma:4b` or select another installed model. Reading, notes, bookmarks, and the original PDF do not require Ollama.

Ollama selects a supported CPU or GPU backend. On Windows this can include NVIDIA, supported AMD ROCm devices, and Vulkan-capable GPUs. **Settings > Graphics acceleration** lists the video adapters and NVIDIA driver tool when available. After a model runs, **Check** reports the VRAM allocation returned by Ollama's `/api/ps`. The presence of a GPU alone does not prove that a model ran on it. See [Ollama hardware support](https://docs.ollama.com/gpu) and the [running-model API](https://docs.ollama.com/api/ps).

MinerU is optional. Install it in a local Python environment following the [official quick-start guide](https://github.com/opendatalab/MinerU/blob/master/docs/en/usage/quick_usage.md), then enter its executable path in **Settings** if it is not on `PATH`. **Auto** lets MinerU select its available backend. **Pipeline compatibility mode** passes `-b pipeline`. On Windows, MinerU CUDA acceleration requires an NVIDIA GPU, a compatible driver, and CUDA-enabled `torch` and `torchvision` in the *same Python environment as MinerU*, followed by the appropriate MinerU extras. The app reports hardware but does not claim that a Python environment is CUDA-ready without checking it. AMD GPUs can accelerate Ollama where supported; CUDA does not apply to AMD. See the [MinerU Windows CUDA FAQ](https://github.com/opendatalab/MinerU/blob/master/docs/en/faq/index.md).

## Data location and privacy

Papers, source PDF copies, translations, notes, and settings are stored in PaperBridge's local Electron user-data directory under `%APPDATA%`. JSON saves keep one readable `.backup` copy. The original source file is copied into the workspace, so moving or deleting the imported file does not remove the saved PDF. No cloud account is required.

## Development layout

- `electron/` — native dialogs, secure local storage, MinerU process, Ollama IPC, GPU inventory.
- `src/` — reader, PDF.js original PDF, translation, summary, library, annotations, settings.
- `tests/` — unit tests and an Electron workflow test with a local fake Ollama server and sample PDF.
- `assets/` — Windows icon generated from the macOS brand mark with `node scripts/make-icon.cjs`.

Keep macOS and Windows in this repository, with separate platform folders and build jobs. Shared behavior can migrate into cross-platform packages once both ports are stable.
