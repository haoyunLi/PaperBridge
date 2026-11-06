// Keep results under the settings that produced them, as macOS workspaces do.
import { activeAIModel, aiCacheNamespace } from './aiSettings.mjs';
import { usesSharedMarkdown, withSharedMarkdownTranslation } from './academicMarkdown.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sourceOf = block => [block.id, block.text, block.sourceMarkdown || ''];
const paperSource = paper => paper.blocks.map(sourceOf);
const modeOf = paper => paper.sourceMode || (paper.type === 'pdf' ? 'pdf' : 'text');
const scoped = (mode, key) => JSON.stringify([mode, key]);
const variantFor = (variants, mode, key) => variants?.[scoped(mode, key)] ??
  (mode === 'pdf' ? variants?.[scoped('text', key)] : undefined);
const isSummary = item => item.scope === 'summarySource' || item.scope === 'summaryTarget';
const isConnected = item => item.scope === 'fullTranslation';
const direction = settings => [aiCacheNamespace(settings), activeAIModel(settings, 'translation'), settings.sourceLanguage, settings.targetLanguage];
export const translationKey = settings => JSON.stringify([...direction(settings), settings.maxParagraphChars]);
export const connectedKey = settings => JSON.stringify(direction(settings));
export const summaryKey = settings => JSON.stringify([...direction(settings), activeAIModel(settings, 'summary')]);
export const explanationKey = (id, language, settings) => JSON.stringify([id, language, aiCacheNamespace(settings), activeAIModel(settings, 'explanation')]);

export function migrateExplanations(paper, settings) {
  const results = {};
  for (const result of Object.values(paper.paragraphExplanations || {})) {
    if (!result.settingsKey && (!settings || result.unverifiedSettings)) {
      results[`${result.id}|${result.language}`] = { ...result, unverifiedSettings: true };
      continue;
    }
    const key = result.settingsKey || explanationKey(result.id, result.language, settings);
    results[key] = { ...result, settingsKey: key };
  }
  return results;
}

export function cachedExplanation(paper, id, language, settings) {
  if (!paper || !settings) return null;
  const key = explanationKey(id, language, settings);
  const result = paper.paragraphExplanations?.[key];
  return result?.source === paper.blocks.find(block => block.id === id)?.text ? result : null;
}

function switchParagraphOutputs(paper, previous, next) {
  const variants = { ...paper.outputVariants };
  const sourceMode = modeOf(paper);
  const sourceSettings = { ...paper.sourceSettings };
  for (const mode of ['pdf', 'mineru']) {
    if (paper[`${mode}Blocks`] && !sourceSettings[mode]) sourceSettings[mode] = previous;
  }
  sourceSettings[sourceMode] = next;
  let result = { ...paper, sourceSettings, paragraphExplanations: migrateExplanations(paper, previous) };
  if (translationKey(previous) !== translationKey(next)) {
    variants.translations = { ...variants.translations, [scoped(sourceMode, translationKey(previous))]: paper.blocks.map(block => ({
      source: sourceOf(block), translation: block.translation || '', translationMarkdown: block.translationMarkdown,
      status: block.status, error: block.error, highlights: block.translationHighlights || [],
      notes: (block.notes || []).filter(note => note.kind === 'translation')
    })) };
    const saved = variantFor(variants.translations, sourceMode, translationKey(next)) || [];
    result.blocks = paper.blocks.map(block => {
      const match = saved.find(item => same(item.source, sourceOf(block)));
      return { ...block, translation: match?.translation || '', translationMarkdown: match?.translationMarkdown || null,
        status: match?.status || 'pending', error: match?.error || '', translationHighlights: match?.highlights || [],
        notes: [...(block.notes || []).filter(note => note.kind !== 'translation'), ...(match?.notes || [])] };
    });
  }
  return { ...result, outputVariants: variants };
}

function switchDocumentOutputs(current, destination, previous, next) {
  const from = modeOf(current);
  const to = modeOf(destination);
  const sourceChanged = from !== to;
  const connectedChanged = sourceChanged || connectedKey(previous) !== connectedKey(next);
  const summaryChanged = sourceChanged || summaryKey(previous) !== summaryKey(next);
  if (!connectedChanged && !summaryChanged) return destination;
  const variants = { ...destination.outputVariants };
  const result = { ...destination, outputVariants: variants };
  const source = paperSource(current);
  const target = current.blocks === destination.blocks ? source : paperSource(destination);

  if (connectedChanged) {
    const notes = (current.viewNotes || []).filter(isConnected);
    const highlights = (current.viewHighlights || []).filter(isConnected);
    if (current.connectedTranslation || current.connectedBlocks?.length || notes.length || highlights.length) {
      variants.connected = { ...variants.connected, [scoped(from, connectedKey(previous))]: {
        source, text: current.connectedTranslation, blocks: current.connectedBlocks, stale: current.connectedStale,
        shared: current.connectedShared, batchVersion: current.connectedBatchVersion, notes, highlights
      } };
    }
    const saved = variantFor(variants.connected, to, connectedKey(next));
    const exact = saved && same(saved.source, target);
    // An older draft for this source can still be read and exported for review.
    const match = exact || sourceChanged ? saved : null;
    Object.assign(result, {
      connectedTranslation: match?.text || '', connectedBlocks: match?.blocks || [],
      connectedStale: Boolean(match && (match.stale || !exact)), connectedShared: match?.shared || false,
      connectedBatchVersion: match?.batchVersion ?? null,
      viewNotes: [...(result.viewNotes || []).filter(item => !isConnected(item)), ...(match?.notes || [])],
      viewHighlights: [...(result.viewHighlights || []).filter(item => !isConnected(item)), ...(match?.highlights || [])]
    });
  }
  if (summaryChanged) {
    const notes = (current.viewNotes || []).filter(isSummary);
    const highlights = (current.viewHighlights || []).filter(isSummary);
    if (current.summary || notes.length || highlights.length) {
      variants.summaries = { ...variants.summaries, [scoped(from, summaryKey(previous))]: { source, summary: current.summary, notes, highlights } };
    }
    const saved = variantFor(variants.summaries, to, summaryKey(next));
    const exact = saved && same(saved.source, target);
    const match = exact || sourceChanged ? saved : null;
    const summary = match?.summary || null;
    Object.assign(result, {
      summary: summary && !exact ? { ...summary, stale: true } : summary,
      viewNotes: [...(result.viewNotes || []).filter(item => !isSummary(item)), ...(match?.notes || [])],
      viewHighlights: [...(result.viewHighlights || []).filter(item => !isSummary(item)), ...(match?.highlights || [])]
    });
  }
  return result;
}

function switchPaperOutputs(current, destination, previous, next, destinationSettings = previous) {
  const paragraphs = switchParagraphOutputs(destination, destinationSettings, next);
  const restored = switchDocumentOutputs(current, paragraphs, previous, next);
  if (restored.connectedShared && !restored.connectedStale && usesSharedMarkdown(restored)
      && translationKey(destinationSettings) !== translationKey(next)) return withSharedMarkdownTranslation(restored);
  return restored;
}

export function switchOutputSettings(paper, previous, next) {
  return switchPaperOutputs(paper, paper, previous, next);
}

export function switchReadingSource(paper, mode, settings) {
  const destination = mode === 'mineru'
    ? { ...paper, pdfBlocks: paper.blocks, blocks: paper.mineruBlocks, extraction: 'MinerU', sourceMode: 'mineru' }
    : { ...paper, mineruBlocks: paper.blocks, blocks: paper.pdfBlocks, extraction: 'PDF.js', sourceMode: 'pdf' };
  return switchPaperOutputs(paper, destination, settings, settings, paper.sourceSettings?.[mode] || settings);
}
