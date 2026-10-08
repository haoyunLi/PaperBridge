# PaperBridge 1.9.2

## Know which paper is opening

- Selecting a PDF immediately shows its filename in the header and sidebar, with a dedicated import screen instead of the previous paper's content.
- The import screen shows elapsed time and recognized MinerU stages for layout, formula, and text recognition. Counts belong to the current stage, not the overall import.
- Cancel Import returns to the previous paper. An unsuccessful import identifies the attempted file without replacing saved translations, notes, bookmarks, or reading positions.
- Structured Markdown preparation runs off the main UI thread. Cancelled imports cannot overwrite the status of a newer task.

## Keep development builds separate

- Debug builds use the distinct name and bundle identifier PaperBridge Dev and update the same app in the user's Applications folder.
- Build, archive, and release staging folders now use `.noindex` paths to keep temporary bundles out of Spotlight indexing. Existing manually installed copies are not deleted automatically.
- Isolated development runs keep their MinerU output inside the test workspace rather than the user's parser cache.

## Install or update

Use PaperBridge > Check for Updates, or download PaperBridge.dmg from this release and replace PaperBridge in Applications. Existing papers, translations, and notes remain in local Application Support storage.

macOS 14 or later; Universal Apple Silicon and Intel. Installing the app does not require Xcode or Homebrew. AI features use local Ollama models; MinerU remains optional and recommended for structured PDF extraction.

## Validation and limits

Regression coverage includes immediate import identity, live parser stage updates, cancellation, failure recovery, completed and cached imports, and preserving the previous paper. Reading reliability, Markdown interaction, text processing, structured Markdown, MinerU, and PDF facsimile checks are included in the release validation.

Progress messages depend on recognizable MinerU log output; other versions or backends can show the general processing message and elapsed time instead. This update does not change OCR quality, translation accuracy, or parsing speed. No physical Intel Mac or clean second-Mac runtime test was performed.
