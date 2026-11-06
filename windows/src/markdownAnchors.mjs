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

export function selectionOffsets(captured, offset, markdown) {
  const displayOffset = captured.offset;
  if (Number.isInteger(offset) || !markdown) return { offset, displayOffset };
  const end = displayOffset + captured.text.length;
  return {
    offset: null, displayOffset, renderedSource: markdown, renderedText: captured.context,
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

export function renderedAnchorOffset(text, item) {
  if (!hasRenderedAnchor(item)) return null;
  const { offset, before, after } = item.renderedAnchor;
  const end = offset + item.text.length;
  return text.slice(offset, end) === item.text &&
    text.slice(Math.max(0, offset - before.length), offset) === before &&
    text.slice(end, end + after.length) === after ? offset : null;
}

export function textAnchorAvailable(item, source, markdown) {
  if (item?.renderedAnchor) return Boolean(markdown) && hasRenderedAnchor(item);
  return Number.isInteger(item?.offset) && item.offset >= 0 && typeof item.text === 'string' && item.text.length > 0 &&
    source?.slice(item.offset, item.offset + item.text.length) === item.text;
}

export function validTextSelection(item, source, markdown) {
  if (!textAnchorAvailable(item, source, markdown)) return false;
  return !item.renderedAnchor || (item.renderedSource === markdown && typeof item.renderedText === 'string' &&
    renderedAnchorOffset(item.renderedText, item) !== null);
}

export function sameTextAnchor(left, right) {
  if (left.text !== right.text) return false;
  if (!left.renderedAnchor && !right.renderedAnchor) return left.offset === right.offset;
  const a = left.renderedAnchor;
  const b = right.renderedAnchor;
  return Boolean(a && b && a.offset === b.offset && a.before === b.before && a.after === b.after);
}

export function sameViewAnchor(left, right) {
  return left.scope === right.scope &&
    (left.scope !== 'paperArticle' || left.displayMode === right.displayMode && left.sourceMode === right.sourceMode) && sameTextAnchor(left, right);
}
