const validParagraphID = value => Number.isSafeInteger(value) && value > 0;
const selectable = block => block && validParagraphID(block.id) && !block.resource;

export function firstSelectableParagraphID(blocks) {
  return Array.isArray(blocks) ? blocks.find(selectable)?.id ?? null : null;
}

export function isSelectableParagraphID(id, blocks) {
  return validParagraphID(id) && Array.isArray(blocks) &&
    blocks.some(block => selectable(block) && block.id === id);
}

// Older workspaces stored the selected paragraph and the viewport in one field.
// Only a missing selection field inherits that old value. An explicit null is
// a deliberate absence of selection; a stale ID cannot select an unrelated
// viewport paragraph after the document's structure or extraction source changes.
export function resolveSelectedParagraphID(paper) {
  const blocks = paper?.blocks;
  if (paper && Object.hasOwn(paper, 'selectedParagraphID')) {
    if (paper.selectedParagraphID === null) return null;
    return isSelectableParagraphID(paper.selectedParagraphID, blocks)
      ? paper.selectedParagraphID : firstSelectableParagraphID(blocks);
  }
  return isSelectableParagraphID(paper?.position?.block, blocks)
    ? paper.position.block : firstSelectableParagraphID(blocks);
}
