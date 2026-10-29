# PaperBridge 1.10.0

## Local by default, online when you choose

- Optional OpenAI support for paragraph translation, structure-preserving full translation, bilingual summaries, paragraph explanations, and selected-text lookup.
- Open Settings > Models > OpenAI (Online), save your own API key, fetch accessible model IDs or enter one manually, and choose separate models for the four tasks. No paid model is selected automatically. A listed model must support text generation through the Responses API.
- API keys are stored in the local macOS Keychain with iCloud synchronization disabled, never in workspace settings or exports. Normal Mac backup or migration can include Keychain data.
- Explicit online permission is required for each app session. Turning it off cancels in-flight work and stops later batches; already-sent text cannot be recalled. There is no automatic cloud fallback.

## More faithful translation and safer switching

- Translation prompts treat a word, phrase, heading, or paragraph as a complete item and request only the translation, not explanations or requests for more context.
- Document titles, matching saved terminology, and an optional translation style guide help preserve context. Formula, image, URL, code, and Markdown protections remain in place.
- Local and OpenAI model choices remain separate. Existing output variants are retained locally when changing providers/models, including across restarts, without restoring cloud permission.
- A recoverable paragraph failure does not stop the remaining paragraphs. Invalid credentials, missing setup, unavailable models, and quota/rate errors stop the run rather than repeating a failing request for every paragraph.
- Repeated selected-text actions now have independent run identifiers so an older cancelled request cannot clear a newer task.

## Clearer PDF import feedback

- The selected filename immediately replaces stale paper content with an import screen showing elapsed time and recognized MinerU stages.
- Cancelling or failing an import preserves the previous paper, translations, notes, bookmarks, and reading position.
- Development builds remain distinct from the downloaded app; temporary build bundles stay in `.noindex` folders. Local source builds use ad-hoc signing without requiring an Apple account.

## Privacy and API costs

Ollama remains the default, and PDF parsing, previews, exports, and recovery storage remain local. With OpenAI explicitly enabled, requests send the requested text and necessary context; whole-paper translation and summary send extracted text in batches. PDF files and image bytes are not uploaded. OpenAI API usage is billed separately from ChatGPT.

Requests use the Responses API with `store: false`, which does not promise zero retention. Review [OpenAI's data controls](https://developers.openai.com/api/docs/guides/your-data) before sending unpublished, sensitive, or restricted material.

## Install or update

Choose **PaperBridge > Check for Updates**, or download **PaperBridge.dmg** from this release and replace the app in Applications. Existing papers and notes remain in local Application Support storage. The installer is Universal for Apple Silicon and Intel, requires macOS 14 or later, and does not require Xcode or Homebrew.

## Validation and known limits

Regression coverage includes mocked OpenAI requests, redirect blocking and credential redaction, session consent, per-task model routing, incomplete responses, quota stops, cancellation races, provider-cache restoration, structured formulas/images/tables, paragraph extraction, MinerU, PDF facsimiles, and WebKit selection/highlighting.

No real OpenAI API key or paid inference was used during validation. Keychain policy is checked without reading or writing real credentials. Native visual inspection was blocked by a macOS screen-capture error; no clean second-Mac or physical Intel runtime test was performed. AI outputs remain fallible and should be checked against the source paper.
