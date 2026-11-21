import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sectionRanges, overviewSectionIds, qualityIssues } from '../../src/paper.mjs';
import { readingMap } from '../../src/text.mjs';
import { protectMarkdown, restoreMarkdown } from '../../src/prompts.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const reference = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.deepEqual(reference.papers.map(paper => paper.name), fixtures.papers.map(paper => paper.name));
for (const [index, fixture] of fixtures.papers.entries()) {
  const blocks = fixture.blocks.map((block, index) => ({ ...block, id: index + 1 }));
  const sections = sectionRanges(blocks);
  const actual = {
    name: fixture.name,
    sections,
    overview: overviewSectionIds(sections),
    guide: readingMap(blocks, sections),
    issues: qualityIssues(blocks).map(({ id, reason }) => ({ id, reason }))
  };
  assert.deepEqual(actual, reference.papers[index], fixture.name);
}

const restored = fixtures.markdown.map(source => {
  const { text, tokens } = protectMarkdown(source);
  return restoreMarkdown(text.replaceAll('Before', '前文').replaceAll('After', '后文'), tokens);
});
assert.deepEqual(restored, reference.markdown);
assert.deepEqual(restored, fixtures.markdown.map(source => source.replaceAll('Before', '前文').replaceAll('After', '后文')));
console.log(`Matched native macOS results for ${fixtures.papers.length} papers and ${restored.length} protected Markdown translations.`);
