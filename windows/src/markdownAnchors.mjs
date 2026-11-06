const contextSize = 32;

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
