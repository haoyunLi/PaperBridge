# PaperBridge

`PaperBridge` is a native macOS desktop app built with SwiftUI and Xcode.
It reads academic PDFs locally, sends prompts to your local Ollama server, and shows the paper in aligned source/target order:

- original paragraph
- translated paragraph

It can also:

- generate a whole-paper summary in the source and target languages
- explain a selected paragraph in simpler language
- export the aligned translation as Markdown

## Features

- Native macOS app, not a browser app
- Local PDF extraction with `PDFKit`
- Local Ollama inference with `URLSession`
- Selectable translation direction
- Automatic detection of installed Ollama models
- Model dropdowns for translation, summary, and explanation
- Progress bar during translation
- Paragraph-by-paragraph processing with failure isolation
- Automatic skipping of detected reference sections
- Markdown export

## Requirements

- macOS
- Full Xcode installed from the Mac App Store
- Ollama installed locally: [https://ollama.com/download/mac](https://ollama.com/download/mac)

## Project Structure

- `PaperBridge.xcodeproj`: Xcode project
- `PaperBridge/`: SwiftUI app source
- `build_app.sh`: one-command terminal build script
- `README.md`: setup and usage guide
- `requirements.txt`: kept only for repository compatibility

## Quick Start

### 1. Clone the repository

```bash
git clone <YOUR_GITHUB_REPO_URL>
cd PDF_paper_reader
```

### 2. Complete Xcode first-launch setup once

Run these once on a new Mac:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
```

### 3. Install and start Ollama

Install Ollama from:

```text
https://ollama.com/download/mac
```

Then start the local Ollama service:

```bash
ollama serve
```

If the Ollama macOS app is already open, the service may already be running.

### 4. Pull at least one translation model

The default translation direction in the app is:

```text
English -> Simplified Chinese
```

The default translation model is:

```bash
ollama pull translategemma:12b
```

You can also use smaller or larger models if they fit your Mac better.

### 5. Build the macOS app from Terminal

From the project root:

```bash
./build_app.sh
```

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
git clone <YOUR_GITHUB_REPO_URL>
cd PDF_paper_reader

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
3. Open a PDF or drag one into the window.
4. Choose the `FROM` and `TO` languages in the left sidebar.
5. Confirm the model selections in the left sidebar.
6. Click `Translate Paper`.
7. Optionally click `Generate Summary`.
8. Optionally select a paragraph, choose an explanation language, and click `Explain Selected Paragraph`.
9. Optionally click `Export Markdown`.

## Behavior Notes

- The app processes PDFs locally.
- Ollama calls go only to your local Ollama server.
- The translation direction is configurable. English to Simplified Chinese is only the default, not the only option.
- Long paragraphs are chunked only for translation reliability.
- If one paragraph translation fails, the rest continue.
- If the app can confidently detect a `References` or `Bibliography` section, it skips that section instead of translating it.

## Troubleshooting

### `./build_app.sh` says Xcode first-launch setup is incomplete

Run:

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

## Notes About `requirements.txt`

`requirements.txt` is kept only because the repository originally started as a Python prototype and you asked to keep it for GitHub.
The native macOS app does not use Python at runtime.

## Sources

- Ollama TranslateGemma library: [https://ollama.com/library/translategemma](https://ollama.com/library/translategemma)
- Ollama Gemma 4 library: [https://ollama.com/library/gemma4](https://ollama.com/library/gemma4)
- Ollama download page: [https://ollama.com/download/mac](https://ollama.com/download/mac)
# PaperBridge
