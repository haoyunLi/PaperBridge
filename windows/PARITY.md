# macOS 1.9 ↔ Windows 0.2 parity summary

The [111-item feature mapping](FEATURE_MAPPING.md) is the detailed source of truth. Current code and automated workflow review: **41 aligned, 70 partial, 0 missing**. These are implementation states, not a claim that every complex paper or GPU has passed device testing.

| Area | Current Windows state | Highest-impact gap |
| --- | --- | --- |
| PDF and text import | Drag/drop, duplicate recovery, independent new copy, automatic MinerU preferred/only/PDF text modes | Real MinerU and OCR failures, complex two-column papers, cross-page repair. |
| Original PDF and structured reading | Original PDF, Markdown resources, quality warnings, repeated running-head/footer filter | Complex figure and footnote order, asset recovery. |
| Reader and navigation | Three saved modes, per-view scroll, per-page PDF position, search and focus restoration | Long-document and high-DPI checks. |
| Paragraph translation | Paragraph queue, chapter selection/priority, reference exclusion | Real-model terminology and cancellation checks. |
| Full translation | Independent structure-preserving draft and export | Complex Markdown and failure-resume checks. |
| Summary and evidence | Dual-language claims with exact-quote source validation | Model-output reliability across long papers. |
| Highlights, notes, terminology | Exact Reader offsets, Paper/summary/full selection, compact toolbar, edit migration | Inline summary/full annotations and cross-view PDF/Markdown anchors. |
| Library and local recovery | Label/tag editing, new extraction copy, saved positions and data clearing | Per-paper task settings and recovery checks. |
| Export | Markdown bundle with external assets, original PDF and up to 120 page PNGs | Long bundle and asset portability checks. |
| One-click local AI setup | Implemented path, device verification pending | Real NVIDIA, AMD, CPU, installation, cancellation and rollback tests. |
| Windows delivery | Unsigned NSIS and portable builds; opt-in daily release checks and update prompts | Signing and verified in-app installation (G14). |

## GPU behavior

The Windows port detects video adapters, NVIDIA driver presence and reported CUDA version, and Ollama's running-model VRAM use. Ollama chooses its own supported backend. One-click setup selects a PyTorch CUDA wheel only when a suitable NVIDIA driver is detected, then checks `torch.cuda.is_available()` inside the managed MinerU environment. MinerU falls back to its CPU pipeline when CUDA cannot be verified. CUDA does not apply to AMD; the Windows GPU driver itself is not installed by PaperBridge.
