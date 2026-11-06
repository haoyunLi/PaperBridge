// Keep results under the settings that produced them, as macOS workspaces do.
import { activeAIModel, aiCacheNamespace } from './aiSettings.mjs';
import { usesSharedMarkdown, withSharedMarkdownTranslation } from './academicMarkdown.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sourceOf = block => [block.id, block.text, block.sourceMarkdown || ''];
const paperSource = paper => paper.blocks.map(sourceOf);
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

export function switchOutputSettings(paper, previous, next, { paragraphsOnly = false } = {}) {
  const variants = { ...paper.outputVariants };
  const sourceMode = paper.sourceMode || 'text';
  const scoped = key => JSON.stringify([sourceMode, key]);
  const sourceSettings = { ...paper.sourceSettings };
  for (const mode of ['pdf', 'mineru']) {
    if (paper[`${mode}Blocks`] && !sourceSettings[mode]) sourceSettings[mode] = previous;
  }
  sourceSettings[sourceMode] = next;
  let result = { ...paper, sourceSettings, paragraphExplanations: migrateExplanations(paper, previous) };
  if (translationKey(previous) !== translationKey(next)) {
    variants.translations = { ...variants.translations, [scoped(translationKey(previous))]: paper.blocks.map(block => ({
      source: sourceOf(block), translation: block.translation || '', translationMarkdown: block.translationMarkdown,
      status: block.status, error: block.error, highlights: block.translationHighlights || [],
      notes: (block.notes || []).filter(note => note.kind === 'translation')
    })) };
    const saved = variants.translations[scoped(translationKey(next))] || [];
    result.blocks = paper.blocks.map(block => {
      const match = saved.find(item => same(item.source, sourceOf(block)));
      return { ...block, translation: match?.translation || '', translationMarkdown: match?.translationMarkdown || null,
        status: match?.status || 'pending', error: match?.error || '', translationHighlights: match?.highlights || [],
        notes: [...(block.notes || []).filter(note => note.kind !== 'translation'), ...(match?.notes || [])] };
    });
  }
  if (!paragraphsOnly && connectedKey(previous) !== connectedKey(next)) {
    variants.connected = { ...variants.connected, [scoped(connectedKey(previous))]: {
      source: paperSource(paper), text: paper.connectedTranslation, blocks: paper.connectedBlocks, stale: paper.connectedStale, shared: paper.connectedShared,
      batchVersion: paper.connectedBatchVersion,
      notes: (paper.viewNotes || []).filter(item => item.scope === 'fullTranslation'),
      highlights: (paper.viewHighlights || []).filter(item => item.scope === 'fullTranslation')
    } };
    const saved = variants.connected[scoped(connectedKey(next))];
    const match = saved && same(saved.source, paperSource(paper)) ? saved : null;
    Object.assign(result, { connectedTranslation: match?.text || '', connectedBlocks: match?.blocks || [], connectedStale: match?.stale || false, connectedShared: match?.shared || false,
      connectedBatchVersion: match?.batchVersion ?? null,
      viewNotes: [...(result.viewNotes || []).filter(item => item.scope !== 'fullTranslation'), ...(match?.notes || [])],
      viewHighlights: [...(result.viewHighlights || []).filter(item => item.scope !== 'fullTranslation'), ...(match?.highlights || [])] });
  }
  if (!paragraphsOnly && summaryKey(previous) !== summaryKey(next)) {
    const isSummary = item => ['summarySource', 'summaryTarget'].includes(item.scope);
    variants.summaries = { ...variants.summaries, [scoped(summaryKey(previous))]: { source: paperSource(paper), summary: paper.summary,
      notes: (paper.viewNotes || []).filter(isSummary), highlights: (paper.viewHighlights || []).filter(isSummary) } };
    const saved = variants.summaries[scoped(summaryKey(next))];
    const match = saved && same(saved.source, paperSource(paper)) ? saved : null;
    Object.assign(result, { summary: match?.summary || null,
      viewNotes: [...(result.viewNotes || []).filter(item => !isSummary(item)), ...(match?.notes || [])],
      viewHighlights: [...(result.viewHighlights || []).filter(item => !isSummary(item)), ...(match?.highlights || [])] });
  }
  if (!paragraphsOnly && result.connectedShared && !result.connectedStale && usesSharedMarkdown(result)
    && translationKey(previous) !== translationKey(next)) result = withSharedMarkdownTranslation(result);
  return { ...result, outputVariants: variants };
}
