const contextSize = 32;
const markdownViews = new Set(['paperArticle', 'summarySource', 'summaryTarget', 'fullTranslation']);
const paperDisplayModes = new Set(['source', 'bilingual', 'translation']);

export function isMarkdownView(scope) {
  return markdownViews.has(scope);
}

export function paperArticleSource(paper) {
  return {
    mode: paper.sourceMode || (paper.type === 'pdf' ? 'pdf' : 'text'),
    structured: Boolean(paper.sourceMode === 'mineru' && paper.mineruMarkdown),
    blocks: paper.blocks
  };
}

export function paperArticleAnchorAvailable(paper, item) {
  if (!paper || !paperDisplayModes.has(item.displayMode) ||
      (item.displayMode === 'source' && paper.type === 'pdf') || !hasRenderedAnchor(item)) return false;
  const current = paperArticleSource(paper);
  if (item.sourceMode === current.mode) return Boolean(current.blocks?.length);
  return paper.type === 'pdf' && (item.sourceMode === 'mineru' ? Boolean(paper.mineruBlocks?.length)
    : item.sourceMode === 'pdf' && Boolean(paper.pdfBlocks?.length));
}

export function validPaperArticleSelection(paper, item) {
  if (!paperArticleAnchorAvailable(paper, item) || typeof item.renderedText !== 'string' ||
      renderedAnchorOffset(item.renderedText, item) === null) return false;
  const source = item.renderedSource;
  const current = paperArticleSource(paper);
  if (item.sourceMode !== current.mode || source?.mode !== current.mode ||
      source.structured !== current.structured || source.blocks?.length !== current.blocks.length) return false;
  // Notes and highlights can change without changing the rendered article.
  return source.blocks.every((block, index) => {
    const other = current.blocks[index];
    return block === other || ['id', 'heading', 'resource', 'text', 'sourceMarkdown', 'status', 'translation', 'translationMarkdown']
      .every(key => block[key] === other[key]);
  });
}

export function blockMarkdown(block, kind) {
  return kind === 'translation' ? block?.translationMarkdown : block?.sourceMarkdown;
}

export function selectionOffsets(captured, offset, markdown, anchorSource) {
  const displayOffset = captured.offset;
  if (!markdown) return { offset, displayOffset };
  const projection = { displayOffset, renderedSource: markdown, renderedText: captured.context, anchorSource };
  if (Number.isInteger(offset)) return { offset, ...projection };
  const end = displayOffset + captured.text.length;
  return {
    offset: null, ...projection,
    renderedAnchor: {
      offset: displayOffset,
      before: captured.context.slice(Math.max(0, displayOffset - contextSize), displayOffset),
      after: captured.context.slice(end, end + contextSize)
    }
  };
}

function hasRenderedAnchor(item) {
  const anchor = item?.renderedAnchor;
  return Number.isInteger(anchor?.offset) && anchor.offset >= 0 &&
    typeof anchor.before === 'string' && typeof anchor.after === 'string' && typeof item.text === 'string' && item.text.length > 0;
}

function matchesTextAt(source, offset, text) {
  return Number.isInteger(offset) && offset >= 0 && typeof text === 'string' && text.length > 0 &&
    source?.slice(offset, offset + text.length) === text;
}

export function matchingTextOffset(from, to, text, offset) {
  if (!matchesTextAt(from, offset, text)) return null;
  if (from === to) return offset;
  let fromAt = from.indexOf(text);
  let toAt = to.indexOf(text);
  let match = null;
  // Formatting can hide raw occurrences or introduce new ones.
  while (fromAt >= 0 && toAt >= 0) {
    if (fromAt === offset) match = toAt;
    fromAt = from.indexOf(text, fromAt + text.length);
    toAt = to.indexOf(text, toAt + text.length);
  }
  return fromAt < 0 && toAt < 0 ? match : null;
}

export function renderedAnchorOffset(text, item) {
  if (!hasRenderedAnchor(item)) return null;
  const { offset, before, after } = item.renderedAnchor;
  const end = offset + item.text.length;
  return text.slice(offset, end) === item.text &&
    text.slice(Math.max(0, offset - before.length), offset) === before &&
    text.slice(end, end + after.length) === after ? offset : null;
}

export function markdownAnnotationOffset(rendered, item, source = rendered) {
  if (typeof item?.text !== 'string' || !item.text.length || item.needsReview) return null;
  if (item.renderedAnchor ? !hasRenderedAnchor(item) : !Number.isInteger(item.offset) || item.offset < 0) return null;
  const stored = item.renderedAnchor ? renderedAnchorOffset(rendered, item)
    : matchingTextOffset(source, rendered, item.text, item.offset);
  if (stored !== null) return stored;
  const first = rendered.indexOf(item.text);
  return first >= 0 && first === rendered.lastIndexOf(item.text) ? first : null;
}

export function textAnchorAvailable(item, source, markdown) {
  if (item?.renderedAnchor) return Boolean(markdown) && hasRenderedAnchor(item);
  return matchesTextAt(source, item?.offset, item?.text) ||
    Boolean(markdown && Number.isInteger(item?.offset) && item.offset >= 0 && typeof item.text === 'string' && item.text.length);
}

export function validTextSelection(item, source, markdown) {
  if (item?.renderedSource && item.renderedSource !== markdown) return false;
  if (!item?.renderedAnchor) return matchesTextAt(source, item?.offset, item?.text);
  return Boolean(markdown && item.renderedSource === markdown && typeof item.renderedText === 'string' &&
    renderedAnchorOffset(item.renderedText, item) !== null);
}

export function sameTextAnchor(left, right) {
  if (left.text !== right.text) return false;
  const captured = typeof right.renderedText === 'string' ? right : left;
  if (typeof captured.renderedText === 'string') {
    const saved = captured === right ? left : right;
    return markdownAnnotationOffset(captured.renderedText, saved, captured.anchorSource) === captured.displayOffset;
  }
  if (!left.renderedAnchor && !right.renderedAnchor) return left.offset === right.offset;
  const a = left.renderedAnchor;
  const b = right.renderedAnchor;
  return Boolean(a && b && a.offset === b.offset && a.before === b.before && a.after === b.after);
}

export function sameViewAnchor(left, right) {
  return left.scope === right.scope &&
    (left.scope !== 'paperArticle' || left.displayMode === right.displayMode && left.sourceMode === right.sourceMode) && sameTextAnchor(left, right);
}
