import { referenceBlockIds } from './references.mjs';

const supportedLanguages = new Set(['English', 'Simplified Chinese', 'Traditional Chinese', 'Japanese', 'Korean',
  'French', 'German', 'Spanish', 'Italian', 'Portuguese', 'Russian']);
const owns = (value, key) => Boolean(value && Object.hasOwn(value, key));
const hasTranslation = block => {
  const value = block?.translationMarkdown || block?.translation;
  return typeof value === 'string' && Boolean(value.trim());
};

export function normalizeOutputLanguage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !owns(value, 'sourceLanguage') || !owns(value, 'targetLanguage') ||
      !supportedLanguages.has(value.sourceLanguage) || !supportedLanguages.has(value.targetLanguage)) return null;
  return { sourceLanguage: value.sourceLanguage, targetLanguage: value.targetLanguage };
}

export function commonOutputLanguage(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const first = normalizeOutputLanguage(pairs[0]);
  return first && pairs.every(pair => {
    const normalized = normalizeOutputLanguage(pair);
    return normalized?.sourceLanguage === first.sourceLanguage && normalized?.targetLanguage === first.targetLanguage;
  }) ? first : null;
}

export function readerOutputLanguage(paper) {
  const blocks = paper?.blocks || [];
  const references = referenceBlockIds(blocks);
  const translated = blocks.filter(block => !block.resource && !references.has(block.id) && hasTranslation(block));
  // A failed retry can retain an older translation. Plain direct exports retain
  // that text too, so its language still participates in this aggregate.
  return translated.length ? commonOutputLanguage(translated.map(block => block.translationLanguage))
    : normalizeOutputLanguage(paper?.taskSettings);
}

function migratedLanguage(value, field, fallback) {
  return owns(value, field) ? normalizeOutputLanguage(value[field]) : fallback;
}

function migrateBlocks(blocks, fallback) {
  return Array.isArray(blocks) ? blocks.map(block => !block || typeof block !== 'object' ? block : ({ ...block,
    translationLanguage: hasTranslation(block) ? migratedLanguage(block, 'translationLanguage', fallback) : null
  })) : blocks;
}

function migrateBatches(batches, fallback) {
  return Array.isArray(batches) ? batches.map(batch => !batch || typeof batch !== 'object' ? batch : ({ ...batch,
    translationLanguage: migratedLanguage(batch, 'translationLanguage', fallback)
  })) : batches;
}

function matchingBatchLanguage(text, batches) {
  if (!Array.isArray(batches) || !batches.length || batches.some(batch => !batch ||
      !['translation', 'original'].includes(batch.kind) || !['ok', 'pending', 'failed'].includes(batch.status) ||
      typeof batch.source !== 'string' || typeof batch.output !== 'string') ||
      batches.map(batch => batch.output).join('\n\n') !== text) return undefined;
  const translated = batches.filter(batch => batch.kind === 'translation');
  const pairs = (translated.length ? translated : batches).map(batch => batch.translationLanguage);
  const language = commonOutputLanguage(pairs);
  return { pairs, language: translated.length || language?.sourceLanguage === language?.targetLanguage ? language : null };
}

function connectedMetadata(text, value, hasValue, batches, fallback, shared = false, stale = false, blocks, conflict = false) {
  const result = (language, inconsistent = false) => ({ connectedLanguage: inconsistent ? null : language,
    connectedLanguageConflict: inconsistent });
  if (!text) return result(null);
  if (conflict === true) return result(null, true);
  const explicit = normalizeOutputLanguage(value);
  if (hasValue && !explicit) return result(null);
  const fromExact = (language, pairs) => result(language, Boolean(explicit && pairs.some(pair => {
    const known = normalizeOutputLanguage(pair);
    return known && (known.sourceLanguage !== explicit.sourceLanguage || known.targetLanguage !== explicit.targetLanguage);
  })));
  if (shared) {
    if (!stale && Array.isArray(blocks)) {
      const references = referenceBlockIds(blocks);
      const output = block => !block.resource && !references.has(block.id) && block.status === 'ok'
        ? block.translationMarkdown || block.translation || '' : '';
      if (blocks.map(block => output(block) || block.sourceMarkdown || block.text).join('\n\n') === text) {
        const completed = blocks.filter(block => output(block));
        const pairs = completed.map(block => block.translationLanguage);
        return fromExact(completed.length ? commonOutputLanguage(pairs) : fallback, pairs);
      }
    }
    return result(hasValue ? explicit : fallback);
  }
  const aggregate = matchingBatchLanguage(text, batches);
  return aggregate === undefined ? result(hasValue ? explicit : fallback) : fromExact(aggregate.language, aggregate.pairs);
}

export function migrateOutputLanguages(paper) {
  if (!paper || typeof paper !== 'object') return paper;
  const rawDirection = normalizeOutputLanguage(paper.taskSettings);
  const next = { ...paper, blocks: migrateBlocks(paper.blocks, rawDirection) };
  for (const mode of ['pdf', 'mineru']) {
    const key = `${mode}Blocks`;
    if (owns(paper, key)) next[key] = migrateBlocks(paper[key], normalizeOutputLanguage(paper.sourceSettings?.[mode]));
  }
  if (owns(paper, 'connectedBlocks')) next.connectedBlocks = migrateBatches(paper.connectedBlocks, rawDirection);
  Object.assign(next, connectedMetadata(paper.connectedTranslation, paper.connectedLanguage, owns(paper, 'connectedLanguage'),
    next.connectedBlocks, rawDirection, paper.connectedShared, paper.connectedStale, next.blocks, paper.connectedLanguageConflict));
  if (paper.outputVariants && typeof paper.outputVariants === 'object') {
    next.outputVariants = { ...paper.outputVariants };
    if (paper.outputVariants.translations) next.outputVariants.translations = Object.fromEntries(
      Object.entries(paper.outputVariants.translations).map(([key, blocks]) => [key, migrateBlocks(blocks, null)]));
    if (paper.outputVariants.connected) next.outputVariants.connected = Object.fromEntries(
      Object.entries(paper.outputVariants.connected).map(([key, saved]) => {
        if (!saved || typeof saved !== 'object') return [key, saved];
        const batches = migrateBatches(saved.blocks, null);
        return [key, { ...saved,
          // A missing cache field is explicitly unknown, even if the cache key
          // or another artifact happens to contain a complete language pair.
          ...connectedMetadata(saved.text, saved.connectedLanguage, true, batches, null, saved.shared, saved.stale, undefined, saved.connectedLanguageConflict),
          ...(owns(saved, 'blocks') && { blocks: batches })
        }];
      }));
  }
  return next;
}
