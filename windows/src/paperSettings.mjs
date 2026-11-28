import { savedStyleGuide } from '../electron/translation-style.mjs';

// Mac workspaces retain AppSettings per paper, while reading appearance stays global.
// Windows additionally keeps update checks global rather than tying them to a paper.
export const PARSER_SETTING_KEYS = Object.freeze(['pdfExtractionMode', 'mineruExecutable', 'mineruBackend']);

export const TASK_SETTING_KEYS = Object.freeze([
  'aiProvider',
  'openAITranslationModel',
  'openAISummaryModel',
  'openAIExplainModel',
  'openAIQuickLookupModel',
  'translationStyleGuide',
  'ollamaBaseURL',
  'translationModel',
  'summaryModel',
  'explainModel',
  'quickLookupModel',
  'sourceLanguage',
  'targetLanguage',
  'maxParagraphChars',
  ...PARSER_SETTING_KEYS
]);

function isValidTaskSetting(key, value) {
  if (key === 'aiProvider') return ['ollama', 'openai'].includes(value);
  if (key === 'translationStyleGuide') return typeof value === 'string';
  if (key.startsWith('openAI')) return typeof value === 'string';
  if (key === 'maxParagraphChars') return Number.isSafeInteger(value) && value > 0;
  if (key === 'pdfExtractionMode') return ['mineruPreferred', 'mineruOnly', 'pdfOnly'].includes(value);
  if (key === 'mineruBackend') return ['auto', 'pipeline'].includes(value);
  if (key === 'mineruExecutable') return typeof value === 'string';
  return typeof value === 'string' && value.trim().length > 0;
}

export function snapshotPaperSettings(settings) {
  const snapshot = {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return snapshot;
  for (const key of TASK_SETTING_KEYS) {
    if (!Object.hasOwn(settings, key) || !isValidTaskSetting(key, settings[key])) continue;
    snapshot[key] = key === 'translationStyleGuide' ? savedStyleGuide(settings[key]) : settings[key];
  }
  return snapshot;
}

export function restorePaperSettings(currentSettings, paperTaskSettings) {
  return { ...(currentSettings || {}), ...snapshotPaperSettings(paperTaskSettings) };
}
