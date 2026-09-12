# PaperBridge 1.9

## Read with less interruption

- Start in Overview with a source reading map and optional source-linked AI summary. Try a fictional practice paper without downloading a model.
- Translate selected sections first, reprioritize queued sections, and resume unfinished paragraphs without repeating successful translations.
- Keep multiple papers in a searchable local library, with titles, tags, translations, notes, bookmarks, and reading positions.
- Use compact selected-text help and save reviewed terminology for future translations.
- Adjust type size, spacing, reading width, and Focus Reading. Mode buttons respond across their full area.

## Safer repairs and recovery

- Reimporting the original PDF reopens your saved revision instead of overwriting manual repairs. Re-extract PDF as New Copy creates a separate library copy with the current parser.
- Splits and merges move bookmarks and resolvable notes with their source, including repeated words and Unicode. Uncertain anchors retain their notes without highlighting unrelated text. Undo restores original anchors.
- Local saves retain a readable backup and recover it if the primary JSON is damaged. Export important papers for independent backup.
- Cancellation cannot overwrite a replacement request; incomplete model responses and local save failures are reported.
- Improved exact PDF selections, Markdown annotation navigation, and reading-position recovery.

## Installation and limits

Download PaperBridge.dmg, drag PaperBridge into Applications, and open it. macOS 14 or later; Universal Apple Silicon and Intel. Xcode, Homebrew, and Python are not needed to install the app. Ollama and a local translation model are needed for AI translation; MinerU is optional and recommended for structured extraction.

Existing users can choose PaperBridge > Check for Updates. The app and DMG are signed and Apple-notarized; updates use the existing signed Sparkle feed.

PDF reconstruction remains heuristic. Original PDF is the layout reference; source-quote matching does not verify AI reasoning. Website demonstrations are illustrative, not performance benchmarks or actual AI output.
