# macOS 1.9 to Windows feature inventory

This is a development ledger, not a claim of completed 1:1 parity. Each item is based on the macOS repository's README and product code. “Partial” means a working path exists with meaningful differences.

| macOS feature | Windows state | Next parity work |
| --- | --- | --- |
| Exact original PDF | Implemented | Stress-test large, encrypted, and unusual PDFs. |
| PDF text extraction | Partial | Improve two-column, footer, formula, and table reconstruction. |
| MinerU structured Markdown and figures | Partial | Improve paragraph-level anchors, figure handling, and export asset folders. |
| Pasted text and practice paper | Implemented | Validate more languages and large documents. |
| Aligned paragraph translation | Implemented | Preserve structured Markdown tokens and exact formula positions. |
| Resume failed or pending translations | Implemented | Add more queue prioritization and cancellation regression tests. |
| Translation range | Partial | Add every detected section as a selectable range. |
| Connected full-paper translation | Partial | Better context windows and structure-preserving output. |
| Original and target summaries | Partial | Validate exact source quotations and reject fabricated citations like macOS 1.9. |
| Selected text translation and explanation | Implemented | Add the stricter selection expansion guard from macOS. |
| Highlights, notes, bookmarks | Partial | Exact offset anchors, PDF page annotations, and structured Markdown highlights. |
| Paragraph edit, split, merge, undo | Partial | Better anchor migration and reflow action. |
| Paper library, search, tags | Implemented | Detect damaged assets and improve recovery UI. |
| Restore reading position | Partial | Restore exact PDF/Markdown viewport within the page. |
| Reading appearance and focus mode | Implemented | Check more window sizes and dark mode. |
| Search within Reader | Implemented | Add result navigation and PDF search. |
| Saved terminology | Implemented | Add term review, matching diagnostics, and translation warnings. |
| Markdown exports | Partial | Bundle MinerU image assets as files instead of data URIs. |
| Ollama model download and setup | Implemented | Test the signed installer and large downloads on more physical Windows PCs. |
| One-click local AI and MinerU setup | Partial | Test full MinerU installation, model preloading, rollback, and CUDA wheels on NVIDIA, AMD, and CPU-only machines. |
| Automatic updates | Not implemented | Choose a signed Windows update channel after release signing. |
| Native macOS menus and shortcuts | Partial | Add Windows menus, accessibility audit, and remaining shortcuts. |

## GPU behavior

The Windows port detects video adapters, NVIDIA driver presence and reported CUDA version, and Ollama's running-model VRAM use. Ollama chooses its own backend. One-click setup selects a PyTorch CUDA wheel only when a suitable NVIDIA driver is detected, then checks `torch.cuda.is_available()` inside the managed MinerU environment. MinerU falls back to its CPU pipeline when CUDA cannot be verified. The Windows GPU driver itself is not installed by PaperBridge.
