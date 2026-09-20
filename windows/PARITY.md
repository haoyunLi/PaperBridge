# macOS 1.9 ↔ Windows 0.2 parity summary

The [111-item feature mapping](FEATURE_MAPPING.md) is the source of truth. It links each Mac behavior to the Windows entry point, marks the current gap, and gives a concrete acceptance check. These statuses come from code inspection; physical GPU and installer verification is still required.

| Area | Current Windows state | Highest-impact gap |
| --- | --- | --- |
| PDF and text import | Working core, partial parity | Drag and drop; automatic MinerU-first strategy; complete PDF text cleanup. |
| Original PDF and structured reading | Working core, partial parity | Interleaved Reader resources and portable facsimile/image assets. |
| Reader and navigation | Working core, partial parity | Bilingual/original/translation modes and precise per-view position restore. |
| Paragraph translation | Working core, partial parity | Reference exclusion, choose any section, prioritize a running queue. |
| Full translation | Working plain-text path, partial parity | One structure-preserving document shared by preview and export. |
| Summary and evidence | Working dual-language summary, partial parity | Exact-quote claim validation before a source link is trusted. |
| Highlights, notes, terminology | Working Reader path, partial parity | Exact selection anchors, cross-workspace selection, annotation migration. |
| Library and local recovery | Working core, partial parity | Title editing, new extraction copy, per-paper settings and exact position. |
| Export | Working Markdown files, partial parity | Self-contained bundle with referenced assets and original PDF. |
| One-click local AI setup | Implemented path, device verification pending | Real NVIDIA, AMD, CPU, installation, cancellation and rollback tests. |
| Windows delivery | Unsigned NSIS and portable builds | Signing and a trusted update channel. |

## GPU behavior

The Windows port detects video adapters, NVIDIA driver presence and reported CUDA version, and Ollama's running-model VRAM use. Ollama chooses its own supported backend. One-click setup selects a PyTorch CUDA wheel only when a suitable NVIDIA driver is detected, then checks `torch.cuda.is_available()` inside the managed MinerU environment. MinerU falls back to its CPU pipeline when CUDA cannot be verified. CUDA does not apply to AMD; the Windows GPU driver itself is not installed by PaperBridge.
