# macOS 1.9 ↔ Windows 0.2 parity summary

The [111-item feature mapping](FEATURE_MAPPING.md) is the detailed source of truth. Current code and automated workflow review: **43 aligned, 68 partial, 0 missing**. The [2026-09-20 whole-app review](WHOLE_APP_REVIEW.md) compares Windows 0.2 with macOS 1.9 at `origin/main` commit `73951d9`, records 12 initial classes of fixes, and follows up with the six-step guide, model recommendations, component selection, menu state and interaction fixes. The [AMD device report](AMD_DEVICE_TEST.md) records real RX 7800 XT translation, installation, a 15-page MinerU paper import, and OCR of an image-only PDF. These implementation states do not establish complete Mac device parity or coverage of every complex paper and GPU.

| Area | Current Windows state | Highest-impact gap |
| --- | --- | --- |
| PDF and text import | First PDF from a multi-file drop, duplicate recovery, independent new copy, automatic extraction modes, cancellation with late-result isolation | Real MinerU and OCR failures, complex two-column papers, cross-page repair. |
| Original PDF and structured reading | Original PDF, Markdown resources, quality warnings, repeated running-head/footer filter | Complex figure and footnote order, asset recovery. |
| Reader and navigation | Three saved modes, per-view scroll, per-page PDF position, search/focus restoration, navigation clears filters and current section follows scrolling | Complex page reflow and high-DPI checks. |
| Paragraph translation | Paragraph queue, chapter selection/priority, reference exclusion, chunk-size slider, source/settings-aware output variants | Real-model terminology, long queues and cancellation checks. |
| Full translation | Independent structure-preserving draft, settings/source-aware cache with its annotations, and export | Complex Markdown and failure-resume checks. |
| Summary and evidence | Dual-language claims with exact-quote source validation | Model-output reliability across long papers. |
| Highlights, notes, terminology | Inline highlights and notes in Reader, Paper, PDF, Summary and Full Translation; scoped undo; selection-bound explanations; reverse-direction terms and duplicate replacement | Complex cross-view PDF/Markdown anchors and mixed edits. |
| Library and local recovery | Label/tag editing, new extraction copy, per-paper settings, saved positions, distinct last-opened record and data clearing | Cross-version recovery and long-document checks. |
| Export | Bundle with external assets, original PDF and up to 120 page PNGs; Analysis/bilingual include all saved highlights, notes and bookmarks | Long bundle and asset portability checks. |
| One-click local AI setup | Six-step resumable guide; all nine Mac model recommendations; selectable components; managed MinerU repair; model download progress, cancellation and role assignment; previous real AMD installation and reuse verified | Real MinerU repair on multiple machines, NVIDIA/CPU installation and failure recovery; model suitability on more memory configurations. |
| Windows delivery | Native menu availability follows paper, selection, undo and task state; unsigned NSIS and portable builds; automatic daily release checks, failure retry and update prompts | Signing and verified in-app installation (G14). |

The initial review passed 53 unit tests, eight Electron workflow suites, and another AMD live OCR run. The follow-up adds onboarding, component selection and native-menu coverage; see [the review](WHOLE_APP_REVIEW.md) for current results and boundaries. Automated fake-service tests verify workflow and data isolation, not translation quality or real installation compatibility.

## GPU behavior

The Windows port detects video adapters, NVIDIA driver presence and reported CUDA version, and Ollama's running-model VRAM use. Ollama chooses its own supported backend. One-click setup selects a PyTorch CUDA wheel only when a suitable NVIDIA driver is detected, then checks `torch.cuda.is_available()` inside the managed MinerU environment. MinerU falls back to its CPU pipeline when CUDA cannot be verified. CUDA does not apply to AMD; the Windows GPU driver itself is not installed by PaperBridge. On the tested RX 7800 XT, Ollama selected ROCm and loaded the 4B model fully into VRAM.
