import { markdownHeadingText } from './academicMarkdown.mjs';
import { referenceBlockIds } from './references.mjs';

import { detectedSectionTitle, trimWhitespace } from './sectionHeadings.mjs';
export { countCharacters, detectedSectionTitle } from './sectionHeadings.mjs';

// Mirrors PaperReaderViewModel.documentSections. Windows keeps resource and
// reference blocks in its Reader, so omit them here without renumbering IDs.
export function documentOutline(paper) {
  const blocks = Array.isArray(paper?.blocks) ? paper.blocks : [];
  const references = referenceBlockIds(blocks);
  const readable = blocks.filter(block => Number.isInteger(block.id) && block.id > 0 &&
    !block.resource && !references.has(block.id) && typeof block.text === 'string' && trimWhitespace(block.text));
  if (paper?.sourceMode === 'mineru') {
    const headings = readable.flatMap(block => {
      const title = markdownHeadingText(block);
      return title ? [{ id: block.id, title }] : [];
    });
    if (headings.length) return headings;
  }
  const detected = readable.flatMap(block => {
    const title = detectedSectionTitle(block.text);
    return title ? [{ id: block.id, title }] : [];
  });
  if (detected.length) return detected;
  return readable.length ? [{ id: readable[0].id, title: 'Beginning' }] : [];
}

export function sectionRanges(blocks, excluded = referenceBlockIds(blocks)) {
  const sections = [];
  for (const block of blocks) {
    if (block.resource || excluded.has(block.id) || !block.text?.trim()) continue;
    const label = block.text.replace(/^#{1,6}\s+/, '').trim();
    const title = markdownHeadingText(block) || detectedSectionTitle(label) || (block.heading ? label : '');
    if (title || !sections.length) sections.push({ title, startId: block.id, ids: [] });
    sections.at(-1).ids.push(block.id);
  }
  if (sections.length && !sections[0].title) sections[0].title = sections.length === 1 ? 'Document' : 'Opening material';
  return sections;
}
