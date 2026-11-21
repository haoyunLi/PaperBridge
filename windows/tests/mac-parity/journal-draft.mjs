import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBundle } from '../../electron/bundle.cjs';
import { parsedMarkdownBlocks, withSharedMarkdownTranslation } from '../../src/academicMarkdown.mjs';
import { annotationsMarkdown } from '../../src/annotationsMarkdown.mjs';
import { markdownDocuments } from '../../src/exportDocuments.mjs';
import { parseMarkdown, renderedMarkdownText } from '../../src/markdownRendering.mjs';

const directory = fileURLToPath(new URL('./tabbed/', import.meta.url));
const languages = { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function markdownTree(markdown, assetDirectory) {
  const tree = parseMarkdown(markdown);
  function visit(node) {
    // Different blank lines and relocated file names may represent the same document.
    delete node.position;
    if (node.type === 'image' && assetDirectory) {
      node.url = sha(readFileSync(path.join(assetDirectory, decodeURIComponent(node.url))));
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  return tree.children;
}

function checkEditions(blocks, native, source) {
  const paper = withSharedMarkdownTranslation({ name: 'Tabbed.pdf', type: 'pdf', sourceMode: 'mineru',
    blocks, taskSettings: languages, mineruMarkdown: source });
  const translated = markdownDocuments(paper, undefined, 'translated')[0].content;
  const bilingual = markdownDocuments(paper, undefined, 'bilingual')[0].content;
  const appendix = '\n\n' + annotationsMarkdown(paper);
  assert.ok(bilingual.endsWith(appendix));
  assert.deepEqual(markdownTree(translated), markdownTree(native.translated));
  assert.deepEqual(markdownTree(paper.connectedTranslation), markdownTree(native.translated));
  assert.deepEqual(markdownTree(bilingual.slice(0, -appendix.length)), markdownTree(native.bilingual));
  return paper;
}

export function verifyJournalDraft(native, exportDirectory) {
  const source = readFileSync(path.join(directory, 'article.md'), 'utf8').replace(/\r\n/g, '\n');
  const translations = JSON.parse(readFileSync(path.join(directory, 'translations.json'), 'utf8'));
  const blocks = parsedMarkdownBlocks(source).map(block => {
    const translation = translations[sha(block.sourceMarkdown)];
    return translation ? { ...block, translation, translationMarkdown: translation, translationLanguage: languages, status: 'ok' } : block;
  });
  assert.equal(blocks.filter(block => block.status === 'ok').length, 42);
  assert.equal(native.matched, 42);
  assert.deepEqual(native.unmatched, []);
  const paper = checkEditions(blocks, native.complete, source);
  const completed = blocks.filter(block => block.status === 'ok');
  const windowsAnalysis = markdownDocuments(paper, undefined, 'analysis')[0].content;
  // Compare each article heading within its numbered analysis paragraph. The Mac
  // numbers translatable segments, while Windows IDs also count resource blocks.
  function paragraphs(text) {
    return text.split(/\n(?=#{2,3} Paragraph \d+\r?$)/m).slice(1).map(section => {
      const newline = section.indexOf('\n');
      return { id: Number(section.slice(0, newline).split(' ').at(-1)), body: section.slice(newline + 1) };
    });
  }
  const nativeParagraphs = paragraphs(native.analysis);
  const windowsParagraphs = paragraphs(windowsAnalysis);
  assert.equal(nativeParagraphs.length, completed.length);
  assert.deepEqual(windowsParagraphs.map(paragraph => paragraph.id), completed.map(block => block.id));
  let headingPairs = 0;
  for (const [index, block] of completed.entries()) {
    if (!block.heading) continue;
    function headingBodies(section) {
      const body = section.trim().split(/^#{3,4} (?:Original|Translation)[^\n]*\n/gm).slice(1);
      assert.equal(body.length, 2);
      return body.map(markdown => {
        const nodes = parseMarkdown(markdown.trim()).children;
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].type, 'paragraph', 'Article titles must stay inside analysis paragraphs');
        return renderedMarkdownText(markdown.trim());
      });
    }
    assert.deepEqual(headingBodies(windowsParagraphs[index].body), headingBodies(nativeParagraphs[index].body));
    headingPairs++;
  }
  assert.equal(headingPairs, 13);
  const unfinished = blocks.map(block => block.sourceMarkdown.startsWith('Automated reading of large')
    ? { ...block, status: 'failed', error: 'Model stopped.' } : block);
  assert.equal(unfinished.filter(block => block.status === 'failed').length, 1);
  assert.equal(native.failedCount, 1);
  checkEditions(unfinished, native.unfinished, source);

  const full = markdownDocuments(paper, undefined, 'full');
  const bundle = writeBundle(exportDirectory, paper, full, undefined, directory);
  assert.deepEqual(bundle.missingAssetPaths, []);
  assert.equal(native.assets, 2);
  assert.equal(bundle.assets, native.assets);
  const saved = readFileSync(path.join(bundle.folder, full[0].filename), 'utf8');
  const exported = markdownTree(saved, bundle.folder);
  assert.deepEqual(exported, markdownTree(native.exportedFull, directory));
  assert.deepEqual(exported.flatMap(node => node.type === 'paragraph'
    ? node.children.filter(child => child.type === 'image').map(child => child.url) : []).sort(), native.imageHashes);

  const legacySource = '## Signals\n\n1. Calibrate the sensor.\n\n> Keep the probe dry.';
  const plain = ['信号', '校准传感器。', '保持探针干燥。\n记录温度。'];
  const legacy = parsedMarkdownBlocks(legacySource).map((block, index) => ({ ...block,
    translation: plain[index], translationLanguage: languages, status: 'ok' }));
  checkEditions(legacy, { translated: native.legacyTranslated, bilingual: native.legacyBilingual }, legacySource);
}
