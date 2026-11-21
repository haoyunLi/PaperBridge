import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { markdownDocuments } from '../../src/exportDocuments.mjs';
import { annotationsMarkdown } from '../../src/annotationsMarkdown.mjs';
import { referenceBlockIds } from '../../src/references.mjs';
import { writeBundle } from '../../electron/bundle.cjs';

const directory = new URL('./good-enough/', import.meta.url);
const language = { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };

export function savedPDFJournal(partial = false) {
  const { sourceSHA256, blocks } = JSON.parse(readFileSync(new URL('reader.json', directory), 'utf8'));
  return { id: sourceSHA256, name: 'Good enough practices in scientific computing.pdf', type: 'pdf',
    sourceMode: 'pdf', taskSettings: language, blocks: blocks.map(block => ({
      ...block, status: partial && block.id === 189 ? 'failed' : block.translation && !(partial && block.id === 75) ? 'ok' : 'pending',
      ...(block.translation && { translationLanguage: language })
    })) };
}

function readPairs(body, blocks, windows) {
  let position = 0;
  return blocks.map((block, index) => {
    const start = block.text + '\n\n> **';
    assert.ok(body.startsWith(start, position), 'Original at PDF paragraph ' + block.id);
    const labelStart = position + start.length;
    const labelEnd = body.indexOf('**\n', labelStart);
    assert.ok(labelEnd >= labelStart);
    const label = body.slice(labelStart, labelEnd);
    assert.equal(label, !windows || block.status === 'ok' ? 'Simplified Chinese translation' : 'Translation');
    const next = blocks[index + 1];
    const end = next ? body.indexOf('\n\n' + next.text + '\n\n> **', labelEnd + 3) : body.length;
    assert.ok(end >= labelEnd, 'Bilingual pair at PDF paragraph ' + block.id);
    const quote = body.slice(labelEnd + 3, end);
    position = end + 2;
    if (!windows) {
      assert.ok(quote.startsWith('> '));
      return quote.slice(2);
    }
    assert.ok(quote.startsWith('>\n'));
    return quote.slice(2).split('\n').map(line => {
      assert.ok(line === '>' || line.startsWith('> '));
      return line.slice(2);
    }).join('\n');
  });
}

export function comparePDFJournalEditions(paper, native, translated, bilingual) {
  const references = referenceBlockIds(paper.blocks);
  const body = paper.blocks.filter(block => !references.has(block.id));
  const bibliography = paper.blocks.filter(block => references.has(block.id)).map(block => block.text).join('\n\n');
  assert.deepEqual([...references], [209, 210]);
  assert.equal(body.length, 208);
  // Windows also supplies the exact bibliography and its annotation appendix.
  assert.equal(translated.trimEnd(), native.translated + '\n\n' + bibliography);
  const appendix = '\n\n' + bibliography + '\n\n' + annotationsMarkdown(paper);
  assert.ok(bilingual.trimEnd().endsWith(appendix));
  const result = readPairs(bilingual.trimEnd().slice(0, -appendix.length), body, true);
  assert.deepEqual(result, readPairs(native.bilingual, body, false));
  assert.deepEqual(result, body.map(block => block.status === 'ok' ? block.translation : '[Translation unavailable]'));
}

export function verifyPDFJournal(reference, work) {
  const pdf = fileURLToPath(new URL('article.pdf', directory));
  assert.equal(createHash('sha256').update(readFileSync(pdf)).digest('hex'), reference.sourceSHA256);
  assert.ok(reference.nativeSource.some(text => text.includes('Good enough practices in scientific computing')));
  for (const state of ['complete', 'partial']) {
    const paper = savedPDFJournal(state === 'partial');
    assert.equal(paper.id, reference.sourceSHA256);
    const docs = markdownDocuments(paper);
    const translated = docs.find(d => d.kind === 'translated');
    const bilingual = docs.find(d => d.kind === 'bilingual');
    assert.equal(translated.filename, 'paper_translation_zh-Hans.md');
    assert.equal(bilingual.filename, 'paper_bilingual_en_zh-Hans.md');
    comparePDFJournalEditions(paper, reference[state], translated.content, bilingual.content);
    const bundle = writeBundle(work, { ...paper, facsimile: true }, [translated, bilingual], pdf);
    assert.deepEqual(bundle.facsimileDocuments.map(file => file.heading),
      ['Simplified Chinese translation of selectable text', 'Extracted bilingual text']);
  }
}
