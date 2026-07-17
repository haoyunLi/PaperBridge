# PaperBridge

`PaperBridge` is a native macOS desktop app built with SwiftUI and Xcode.
It reads academic PDFs locally, sends prompts to your local Ollama server, and shows the paper in aligned source/target order:

- original paragraph
- translated paragraph

It can also:

- generate a whole-paper summary in the source and target languages
- translate or explain an exact text selection without leaving the reader
- highlight selected text, attach notes, and bookmark paragraphs
- explain a full selected paragraph in simpler language
- optionally create a second, connected full-paper translation for smoother context
- export available summaries, connected translation, and aligned paragraphs as Markdown
- accept pasted text directly when you do not want to load a PDF
- restore the most recent paper, translations, reading position, bookmarks, and annotations

## Features

- Native macOS app, not a browser app
- Clean three-pane workspace with document outline, reader, and research inspector
- Local PDF extraction with `PDFKit`
- Local Ollama inference with `URLSession`
- Selectable translation direction
- PDF upload and pasted-text input
- Automatic detection of installed Ollama models
- Dedicated model settings for translation, summary, paragraph explanation, and quick lookup
- Progress bar during translation
- Paragraph-by-paragraph processing with failure isolation
- Cross-page word and sentence repair without character-based sentence cuts
- Filtering of repeated headers, footers, and runs of extracted chart labels
- Automatic skipping of detected reference sections, including papers with methods after references
- Search plus bilingual, original-only, and translation-only reading modes
- Section outline navigation and paragraph bookmarks
- Selected-text translation, explanation, three-color highlights, and notes
- Automatic local workspace recovery between launches
- Native menu commands and keyboard shortcuts
- Manual paragraph edit, split, merge, reflow, undo, and failed-translation retry controls
- Optional connected full-paper translation view
- Markdown export

## Requirements

- macOS 14 or later
- Full Xcode installed from the Mac App Store
- Ollama installed locally: [https://ollama.com/download/mac](https://ollama.com/download/mac)

## Project Structure

- `PaperBridge.xcodeproj`: Xcode project
- `PaperBridge/`: SwiftUI app source
- `build_app.sh`: one-command terminal build script
- `test_text_processing.sh`: paragraph-processing regression tests
- `Tests/`: command-line regression test source
- `README.md`: setup and usage guide
- `requirements.txt`: kept for repository compatibility; the native app has no Python packages

## Quick Start

### 1. Create a normal project folder on your Mac

To avoid macOS permission problems, do not build this app inside `Documents` or `Downloads`.
Use a normal folder such as `~/Projects` instead:

```bash
mkdir -p ~/Projects
cd ~/Projects
```

### 2. Clone the repository

```bash
git clone https://github.com/haoyunLi/PaperBridge.git
cd PaperBridge
```

### 3. Complete Xcode first-launch setup once

Run these once on a new Mac:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
```

`build_app.sh` should work on another person's Mac without editing it, as long as:

- full Xcode is installed
- Xcode has finished first-launch setup
- `xcode-select` points to the Xcode developer directory

If their Xcode app is in the normal location, they usually do not need to change anything.
If they installed or renamed Xcode in a different location, they only need to point `xcode-select` at that Xcode once, for example:

```bash
sudo xcode-select -s "/Applications/Xcode-beta.app/Contents/Developer"
```

### 4. Install and start Ollama

Install Ollama from:

```text
https://ollama.com/download/mac
```

Then start the local Ollama service:

```bash
ollama serve
```

If the Ollama macOS app is already open, the service may already be running.

### 5. Pull at least one translation model

The default translation direction in the app is:

```text
English -> Simplified Chinese
```

The default translation model is:

```bash
ollama pull translategemma:12b
```

You can also use smaller or larger models if they fit your Mac better.

### 6. Build the macOS app from Terminal

From the project root:

```bash
./build_app.sh
```

The script builds relative to the repository folder, so users do not need to edit personal paths inside the script.

If the build succeeds, the generated app will be here:

```text
build/Build/Products/Release/PaperBridge.app
```

Open it with:

```bash
open "build/Build/Products/Release/PaperBridge.app"
```

## Terminal Build Flow

For users who want the exact terminal-only workflow:

```bash
mkdir -p ~/Projects
cd ~/Projects

git clone https://github.com/haoyunLi/PaperBridge.git
cd PaperBridge

sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch

ollama pull translategemma:12b
ollama serve

./build_app.sh
open "build/Build/Products/Release/PaperBridge.app"
```

## How the App Uses Models

When the app starts, it queries your local Ollama installation and automatically lists the models you already pulled.

Inside the app, you can choose:

- source language
- target language
- translation model
- summary model
- explanation model
- quick lookup model for selected-text translation and explanation

The app is not fixed to one language pair. English to Simplified Chinese is only the default.

The current UI includes common language options such as:

- English
- Simplified Chinese
- Traditional Chinese
- Japanese
- Korean
- French
- German
- Spanish
- Italian
- Portuguese
- Russian

The app does not require one fixed model family. It will show whatever Ollama reports locally.

## Recommended Model Choices

The exact best choice depends on your Mac's memory and speed.

### Translation

Best results are usually from the `TranslateGemma` family.

Examples:

```bash
ollama pull translategemma:12b
```

If you want a smaller translation model and it is available for your setup, you can also use a smaller `TranslateGemma` variant such as:

```bash
ollama pull translategemma:4b
```

### Summary and Explanation

You can keep using `translategemma:12b`, or use a more general-purpose local model for summary and explanation.

Examples from Ollama's Gemma 4 library:

```bash
ollama pull gemma4:e2b
ollama pull gemma4:e4b
ollama pull gemma4:26b
ollama pull gemma4:31b
```

Suggested rough guidance:

- smaller Macs: `gemma4:e2b` or `gemma4:e4b`
- stronger Macs: `translategemma:12b` or `gemma4:26b`
- high-memory Macs: `gemma4:31b`

You can mix them, for example:

- translation: `translategemma:12b`
- summary: `gemma4:e4b`
- explanation: `gemma4:e4b`

or:

- translation: `translategemma:4b`
- summary: `gemma4:e2b`
- explanation: `gemma4:e2b`

## Example Ollama Setup

### Balanced setup

```bash
ollama pull translategemma:12b
ollama pull gemma4:e4b
```

Then choose:

- `TRANSLATION_MODEL`: `translategemma:12b`
- `SUMMARY_MODEL`: `gemma4:e4b`
- `EXPLAIN_MODEL`: `gemma4:e4b`
- `FROM`: `English`
- `TO`: `Simplified Chinese`

### Lighter setup

```bash
ollama pull translategemma:4b
ollama pull gemma4:e2b
```

Then choose:

- `TRANSLATION_MODEL`: `translategemma:4b`
- `SUMMARY_MODEL`: `gemma4:e2b`
- `EXPLAIN_MODEL`: `gemma4:e2b`
- choose the `FROM` and `TO` languages that match your paper

## How to Use the App

1. Launch `PaperBridge.app`.
2. Make sure Ollama is running locally.
3. Open a PDF, drag one into the window, or paste text into the sidebar.
4. Choose the `FROM` and `TO` languages in the left sidebar.
5. Open `Models & Settings` to choose the four task models and translation chunk limit.
6. Review the extracted paragraphs. Use the outline to jump between sections, or open a paragraph's `...` menu to edit, split, merge, or reflow it at complete sentences.
7. Click `Translate` for aligned paragraph-by-paragraph translation. If a run is interrupted, the same button resumes unfinished paragraphs.
8. Select any text in the original or translation to open the Research Inspector. From there you can translate, explain, highlight, or attach a note to the exact selection.
9. Use the bookmark button on a paragraph to add it to the sidebar's bookmark list.
10. Open the `Summary` workspace for source- and target-language summaries.
11. Open `Full Translation` for an optional second, context-aware translation pass.
12. Choose `More > Export Markdown` to export all available reading results, highlights, notes, and bookmarks.

## Keyboard Shortcuts

- `Command-O`: open a PDF
- `Command-Return`: translate or resume
- `Command-Shift-E`: export Markdown
- `Command-Shift-I`: show the Research Inspector
- `Command-Shift-T`: translate selected text
- `Command-Option-E`: explain selected text
- `Command-Shift-H`: highlight selected text in amber

## Local Recovery and Privacy

PaperBridge stores recovery data only on the current Mac:

```text
~/Library/Application Support/PaperBridge
```

This includes app settings, the most recent workspace, translated paragraphs, summaries, bookmarks, highlights, and notes. Use `Models & Settings > Local Data` to clear this recovery data.

## Behavior Notes

- The app processes PDFs locally.
- The app can also process pasted text locally without needing a PDF file.
- Ollama calls are restricted to `localhost`, `127.0.0.1`, or `::1` on your Mac.
- Building under `~/Projects` is recommended to avoid macOS protected-folder issues.
- The translation direction is configurable. English to Simplified Chinese is only the default, not the only option.
- Long paragraphs are chunked only for translation reliability.
- Translation chunks are split at sentence or clause boundaries whenever possible, then reassembled into one translated paragraph.
- PDF line-wrap fragments such as `mea- sure` and `out- perform` are repaired while established compounds such as `model-based` remain hyphenated.
- Major section headings such as `Abstract`, `Introduction`, and `Methods` stay in the same translation paragraph as their opening text, but appear on their own line for readability.
- If one paragraph translation fails, the rest continue.
- Failed paragraphs have an individual `Retry` button.
- Connected full-paper translation is optional and is not run automatically with `Translate Paper`.
- If the app confidently detects a `References` or `Bibliography` section, it excludes that section while preserving a later methods or supplemental section when present.
- PDF layouts vary. The paragraph menu and undo button are the safe fallback when an equation, unusual heading, or figure layout cannot be inferred automatically.

## Paragraph Regression Tests

After changing text extraction or paragraph rules, run:

```bash
./test_text_processing.sh
```

The tests cover cross-page words, spaced PDF word fragments, incomplete phrases, citations, numbered and inline section headings, compound hyphens, equations, chart-label runs, numeric plot data, and references that appear before a later method or methods section.

## Troubleshooting

### The build reports missing Xcode components or an unaccepted license

The script may print a note when Xcode's first-launch status cannot be checked. It will still try the real build. If that build fails with a setup or license error, run:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
```

### The app opens but no models appear

Make sure Ollama is running:

```bash
ollama serve
```

Then pull at least one model:

```bash
ollama pull translategemma:12b
```

Then relaunch the app or click `Refresh Models`.

### Translation is too slow

Try a smaller local model, such as:

- `translategemma:4b`
- `gemma4:e2b`
- `gemma4:e4b`

### The app builds but does not launch from Finder

Try launching it from Terminal:

```bash
open "build/Build/Products/Release/PaperBridge.app"
```

### Finder or the Dock still shows an old or generic icon

Quit any older copy of PaperBridge, rebuild with `./build_app.sh`, and open the app from `build/Build/Products/Release`. macOS caches app icons by bundle identifier, so opening the newest build once may be required before Finder and the Dock refresh it.

## Sources

- Ollama TranslateGemma library: [https://ollama.com/library/translategemma](https://ollama.com/library/translategemma)
- Ollama Gemma 4 library: [https://ollama.com/library/gemma4](https://ollama.com/library/gemma4)
- Ollama download page: [https://ollama.com/download/mac](https://ollama.com/download/mac)
