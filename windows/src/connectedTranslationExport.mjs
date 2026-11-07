import { completedBlockTranslation, usesSharedMarkdown } from './academicMarkdown.mjs';
import { connectedBatchVersion, planConnectedBatches } from './connectedTranslation.mjs';
import { referenceBlockIds } from './paper.mjs';
import { migrateOutputLanguages, normalizeOutputLanguage } from './outputLanguages.mjs';

function failedPassage(label, error, original) {
  const detail = typeof error === 'string' ? error.replace(/\s+/g, ' ').trim() : '';
  return `> [Connected translation failed for ${label}]${detail ? ` ${detail}` : ''}\n>\n> Original text retained below.\n\n${original}`;
}

// Failure metadata belongs to a particular saved draft. Never search/replace its
// source phrases: identical passages can occur in both successful and failed batches.
export function connectedTranslationMarkdown(input, _legacyTargetLanguage, content = input.connectedTranslation, outputLanguage) {
  const paper = migrateOutputLanguages(input);
  if (!content) return content || '';
  if (paper.connectedStale) return `> The source changed after this translation was saved.\n\n${content}`;
  // A saved whole-draft language can contradict its matching batch metadata.
  // Keep that uncertainty through migration/cache; only an explicitly rebuilt
  // Reader artifact (fourth argument) owns fresh failure metadata in this call.
  if (paper.connectedLanguageConflict && outputLanguage === undefined) return content;
  const language = normalizeOutputLanguage(outputLanguage === undefined ? paper.connectedLanguage : outputLanguage);
  if (language && _legacyTargetLanguage && language.targetLanguage !== _legacyTargetLanguage) return content;
  const mismatchedLanguage = value => {
    const saved = normalizeOutputLanguage(value);
    return language && saved && (language.sourceLanguage !== saved.sourceLanguage || language.targetLanguage !== saved.targetLanguage);
  };

  let passages;
  let unit;
  if (usesSharedMarkdown(paper)) {
    if (!paper.connectedShared) return content;
    const references = referenceBlockIds(paper.blocks);
    if (paper.blocks.some(block => completedBlockTranslation(block, references) && mismatchedLanguage(block.translationLanguage))) return content;
    passages = paper.blocks.map(block => ({
      output: completedBlockTranslation(block, references) || block.sourceMarkdown || block.text,
      failed: !block.resource && !references.has(block.id) && block.status === 'failed',
      label: `paragraph ${block.id}`, error: block.error
    }));
    unit = 'paragraph(s)';
  } else {
    const saved = paper.connectedBlocks;
    if (paper.connectedShared || paper.connectedBatchVersion !== connectedBatchVersion || !Array.isArray(saved) || !saved.length) return content;
    if (saved.some(batch => batch?.kind === 'translation' && mismatchedLanguage(batch.translationLanguage))) return content;
    const planned = planConnectedBatches(paper.blocks);
    if (planned.length !== saved.length || saved.some((batch, index) => !batch ||
        batch.kind !== planned[index].kind || batch.source !== planned[index].source || typeof batch.output !== 'string' ||
        !['ok', 'failed', 'pending'].includes(batch.status))) return content;
    let translationNumber = 0;
    passages = saved.map(batch => {
      if (batch.kind === 'translation') translationNumber++;
      return {
        output: batch.output,
        // Current batches retain the exact original on failure. A stale failure
        // flag beside different (possibly successful) output is not evidence.
        failed: batch.kind === 'translation' && batch.status === 'failed' && batch.output === batch.source,
        label: `batch ${translationNumber}`, error: batch.error
      };
    });
    unit = 'batch(es)';
  }
  if (passages.map(passage => passage.output).join('\n\n') !== content) return content;
  const failures = passages.filter(passage => passage.failed).length;
  if (!failures) return content;
  const body = passages.map(passage => passage.failed ? failedPassage(passage.label, passage.error, passage.output) : passage.output).join('\n\n');
  return `> ${failures} connected-translation ${unit} failed and were marked inline below.\n\n${body}`;
}
