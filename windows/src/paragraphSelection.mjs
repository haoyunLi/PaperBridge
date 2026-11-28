import { characterPrefix } from '../electron/library-metadata.mjs';

export function paragraphPreview(text) {
  const flattened = (text ?? '').replaceAll('\n', ' ');
  if (characterPrefix(flattened, 96) === flattened) return flattened;
  return characterPrefix(flattened, 93) + '...';
}

const validParagraphID = value => Number.isSafeInteger(value) && value > 0;
const selectable = block => block && validParagraphID(block.id) && !block.resource;

const readable = block => !block.resource && Boolean(block.text?.trim());

export function paragraphOnPdfPage(blocks, page) {
  return blocks.find(block => readable(block) && block.page === page) ||
    blocks.find(block => readable(block) && block.page > 0 && block.page < page && block.endPage >= page);
}

export function ocrCoverageForPage(paper, page) {
  const blocks = paper.sourceMode === 'mineru' ? paper.blocks : paper.mineruBlocks;
  if (!blocks?.length) return null;
  if (paragraphOnPdfPage(blocks, page)) return 'matched';
  return blocks.some(block => readable(block) && !(block.page > 0)) ? 'unknown' : 'absent';
}

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
