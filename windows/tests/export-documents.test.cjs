const test = require('node:test');
const assert = require('node:assert/strict');

const modules = Promise.all([
  import('../src/exportDocuments.mjs'), import('../src/connectedTranslation.mjs'),
  import('../src/academicMarkdown.mjs'), import('../src/outputCache.mjs')
]);
const settings = { aiProvider: 'ollama', translationModel: 'translation:a', sourceLanguage: 'English', targetLanguage: 'French' };
const failureMarker = '[Connected translation failed for';
const disclaimer = '> AI interpretation is unverified. Matching a quotation confirms its location, not whether it supports the claim.';

async function fixture() {
  const [, { planConnectedBatches, connectedBatchVersion }] = await modules;
  const blocks = [
    { id: 1, text: 'Repeated exact source.', status: 'ok' },
    { id: 2, text: '![Figure](images/figure.png)', resource: true },
    { id: 3, text: 'Repeated exact source.', status: 'ok' },
    { id: 4, text: '$$x=2$$', resource: true },
    { id: 5, text: 'A pending excerpt remains in its original language.' },
    { id: 6, text: 'References', heading: true },
    { id: 7, text: '[1] An untranslated reference.', status: 'failed' }
  ];
  let number = 0;
  const connectedBlocks = planConnectedBatches(blocks).map(batch => {
    if (batch.kind === 'original') return { ...batch, output: batch.source, status: 'ok' };
    number++;
    return { ...batch, output: batch.source, status: number === 1 ? 'ok' : number === 2 ? 'failed' : 'pending',
      error: number === 2 ? 'Model timed out.\nRetry later.' : 'Obsolete error must not be exported.' };
  });
  return { name: 'Export fixture.pdf', type: 'pdf', sourceMode: 'pdf', blocks, connectedBlocks,
    connectedTranslation: connectedBlocks.map(batch => batch.output).join('\n\n'),
    connectedBatchVersion, connectedShared: false, connectedStale: false, taskSettings: { ...settings } };
}

const byKind = documents => Object.fromEntries(documents.map(document => [document.kind, document.content]));

test('full exports mark only failed batch positions and retain duplicate originals, resources and pending text', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = await fixture();
  const before = structuredClone(paper);
  const docs = byKind(markdownDocuments(paper, 'French'));
  assert.match(docs.full, /^> 1 connected-translation batch\(es\) failed and were marked inline below\./);
  assert.equal(docs.full.split(failureMarker).length - 1, 1);
  assert.match(docs.full, /Repeated exact source\.\n\n!\[Figure\]\(images\/figure\.png\)\n\n> \[Connected translation failed for batch 2\] Model timed out\. Retry later\./);
  assert.match(docs.full, /> Original text retained below\.\n\nRepeated exact source\.\n\n\$\$x=2\$\$\n\nA pending excerpt/);
  assert.match(docs.full, /References\n\n\[1\] An untranslated reference\.$/);
  assert.doesNotMatch(docs.full, /batch 1\]|batch 3\]|Obsolete error/);
  assert.ok(docs.analysis.includes(`## Connected Full Translation\n\n${docs.full}`));
  assert.equal(markdownDocuments(paper, 'French', 'full')[0].content, docs.full);
  assert.ok(markdownDocuments(paper, 'French', 'analysis')[0].content.includes(docs.full));
  assert.doesNotMatch(docs.original + docs.translated + docs.bilingual, /Connected translation failed/);
  assert.deepEqual(paper, before, 'Export must not rewrite saved text or source-bound annotations.');
});

test('successful text remains exact, including old error fields and output equal to its original', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = await fixture();
  paper.connectedBlocks = paper.connectedBlocks.map(batch => ({ ...batch, status: 'ok' }));
  paper.connectedBlocks[0].output = '# Successful translation\n\n**Formatting stays exact.**\n';
  paper.connectedTranslation = paper.connectedBlocks.map(batch => batch.output).join('\n\n');
  assert.equal(markdownDocuments(paper, 'French', 'full')[0].content, paper.connectedTranslation);
  // A contradictory failure flag must not relabel text that replaced the source fallback.
  paper.connectedBlocks[0].status = 'failed';
  assert.equal(markdownDocuments(paper, 'French', 'full')[0].content, paper.connectedTranslation);
});

test('legacy, mismatched or unsupported batch metadata never injects failure labels into a saved draft', async () => {
  const [{ markdownDocuments }] = await modules;
  const original = await fixture();
  const changes = [
    { connectedBatchVersion: undefined }, { connectedBatchVersion: 999 }, { connectedBlocks: [] },
    { connectedShared: true }, { connectedTranslation: 'An unrelated successful saved draft.' },
    { blocks: original.blocks.map(block => block.id === 3 ? { ...block, text: 'A different source variant.' } : block) },
    { connectedBlocks: original.connectedBlocks.map((batch, index) => index === 2 ? null : batch) },
    { connectedBlocks: original.connectedBlocks.map((batch, index) => index === 2 ? { ...batch, status: 'unknown' } : batch) },
    { connectedBlocks: original.connectedBlocks.map((batch, index) => index === 2 ? { ...batch, output: undefined } : batch) }
  ];
  for (const change of changes) {
    const paper = { ...original, ...change };
    assert.equal(markdownDocuments(paper, 'French', 'full')[0].content, paper.connectedTranslation, JSON.stringify(change));
  }
  assert.equal(markdownDocuments(original, 'German', 'full')[0].content, original.connectedTranslation,
    'Current-language metadata cannot describe a different requested language.');
});

test('stale saved drafts retain their original contents and carry the source-change notice in all full exports', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = { ...await fixture(), connectedStale: true };
  const expected = `> The source changed after this translation was saved.\n\n${paper.connectedTranslation}`;
  const docs = byKind(markdownDocuments(paper, 'French'));
  assert.equal(docs.full, expected);
  assert.equal(markdownDocuments(paper, 'French', 'full')[0].content, expected);
  assert.ok(docs.analysis.includes(expected));
  assert.doesNotMatch(docs.full, /Connected translation failed/);
});

test('shared MinerU exports identify failed paragraphs without relabeling pending blocks or references', async () => {
  const [{ markdownDocuments }, , { withSharedMarkdownTranslation }] = await modules;
  const blocks = [
    { id: 1, text: 'Study', sourceMarkdown: '# Study', heading: true, status: 'ok', translationMarkdown: '# Étude' },
    { id: 2, text: 'Ready paragraph.', sourceMarkdown: 'Ready **paragraph**.', status: 'ok', translationMarkdown: 'Une phrase.\n\nUne autre.' },
    { id: 3, text: 'Failed paragraph.', sourceMarkdown: 'Failed $x=2$ paragraph.', status: 'failed', error: 'Model stopped.', translation: 'Old successful output must not replace the fallback.' },
    { id: 4, text: 'Pending paragraph.', sourceMarkdown: 'Pending paragraph.', status: 'pending' },
    { id: 5, text: 'Figure', sourceMarkdown: '![Figure](assets/a.png)', resource: true, status: 'failed' },
    { id: 6, text: 'References', sourceMarkdown: '## References', heading: true, status: 'failed' },
    { id: 7, text: '[1] Source citation.', sourceMarkdown: '[1] Source citation.', status: 'failed' }
  ];
  const paper = withSharedMarkdownTranslation({ name: 'Structured fixture', sourceMode: 'mineru', blocks, taskSettings: settings });
  const before = structuredClone(paper);
  const docs = byKind(markdownDocuments(paper, 'French'));
  assert.match(docs.full, /^> 1 connected-translation paragraph\(s\) failed/);
  assert.match(docs.full, /# Étude\n\nUne phrase\.\n\nUne autre\.\n\n> \[Connected translation failed for paragraph 3\] Model stopped\./);
  assert.match(docs.full, /> Original text retained below\.\n\nFailed \$x=2\$ paragraph\.\n\nPending paragraph\.\n\n!\[Figure\]\(assets\/a\.png\)\n\n## References\n\n\[1\] Source citation\.$/);
  assert.doesNotMatch(docs.full, /paragraph [124567]\]|Old successful output/);
  assert.ok(docs.analysis.includes(docs.full));
  assert.equal(markdownDocuments(paper, 'French', 'full')[0].content, docs.full);
  assert.equal(docs.translated, paper.connectedTranslation, 'Reader translation editions keep their existing format.');
  assert.deepEqual(paper, before);
  const legacy = { ...paper, connectedShared: false, connectedTranslation: 'Older independent draft.' };
  assert.equal(markdownDocuments(legacy, 'French', 'full')[0].content, legacy.connectedTranslation);
  assert.equal(byKind(markdownDocuments(legacy, 'French')).full, docs.translated,
    'Legacy bundle behavior remains unchanged and does not claim current failure metadata belongs to its old draft.');
  const mismatched = { ...paper, connectedTranslation: 'Another successful saved draft.' };
  assert.equal(markdownDocuments(mismatched, 'French', 'full')[0].content, mismatched.connectedTranslation);
});

test('language variants restore only their own connected failures across a serialized workspace', async () => {
  const [{ markdownDocuments }, , , { switchOutputSettings }] = await modules;
  const original = await fixture();
  const next = { ...settings, targetLanguage: 'German' };
  const switched = { ...switchOutputSettings(original, settings, next), taskSettings: next };
  assert.equal(markdownDocuments(switched, 'German', 'full').length, 0);
  const connectedBlocks = original.connectedBlocks.map(batch => ({ ...batch, status: 'ok', output: batch.kind === 'translation' ? `German: ${batch.source}` : batch.source }));
  const generated = { ...switched, connectedBlocks, connectedBatchVersion: original.connectedBatchVersion,
    connectedTranslation: connectedBlocks.map(batch => batch.output).join('\n\n') };
  assert.equal(markdownDocuments(generated, 'German', 'full')[0].content, generated.connectedTranslation);
  const restored = { ...switchOutputSettings(JSON.parse(JSON.stringify(generated)), next, settings), taskSettings: settings };
  assert.match(markdownDocuments(restored, 'French', 'full')[0].content, /failed for batch 2/);
  assert.doesNotMatch(markdownDocuments(restored, 'French', 'full')[0].content, /German:/);
});

test('PDF and MinerU variants keep failure locations separate and stale source restoration remains literal', async () => {
  const [{ markdownDocuments }, , { withSharedMarkdownTranslation }, { switchReadingSource }] = await modules;
  const original = await fixture();
  const initial = { ...original, pdfBlocks: original.blocks, mineruBlocks: [
    { id: 1, text: 'MinerU source.', sourceMarkdown: 'MinerU **source**.', status: 'pending' }
  ] };
  const switched = switchReadingSource(initial, 'mineru', settings);
  assert.equal(markdownDocuments(switched, 'French', 'full').length, 0);
  const generated = withSharedMarkdownTranslation({ ...switched, blocks: switched.blocks.map(block => ({ ...block, status: 'ok', translationMarkdown: 'MinerU **traduction**.' })) });
  assert.equal(markdownDocuments(generated, 'French', 'full')[0].content, generated.connectedTranslation);
  const restored = switchReadingSource(JSON.parse(JSON.stringify(generated)), 'pdf', settings);
  assert.match(markdownDocuments(restored, 'French', 'full')[0].content, /failed for batch 2/);
  const changed = { ...generated, pdfBlocks: generated.pdfBlocks.map(block => block.id === 3 ? { ...block, text: 'Changed after archiving.' } : block) };
  const stale = switchReadingSource(changed, 'pdf', settings);
  assert.equal(stale.connectedStale, true);
  const exported = markdownDocuments(stale, 'French', 'full')[0].content;
  assert.ok(exported.endsWith(original.connectedTranslation));
  assert.match(exported, /^> The source changed/);
  assert.doesNotMatch(exported, /Connected translation failed|MinerU \*\*traduction/);
});

test('summary exports distinguish verified quote locations from interpretation and discard displaced quotations', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = await fixture();
  paper.summary = { source: 'Source summary.', target: 'Target summary.', claims: [
    { text: 'Interpretation needs checking.', sources: [{ paragraphID: 1, quote: 'Repeated exact source.' }, { paragraphID: 3, quote: 'A quotation no longer in this source.' }] },
    { text: 'An unlinked interpretation.', sources: [] }
  ] };
  const analysis = markdownDocuments(paper, 'French', 'analysis')[0].content;
  assert.ok(analysis.includes(`## Checked sources\n\n${disclaimer}\n\n### Claim 1:`));
  assert.match(analysis, /- Block 1: “Repeated exact source\.”/);
  assert.doesNotMatch(analysis, /A quotation no longer in this source/);
  assert.match(analysis, /### Claim 2: An unlinked interpretation\.\n\n- No exact source quotation validated\./);
  assert.equal(byKind(markdownDocuments(paper, 'French')).analysis, analysis);
  for (const claims of [[], [{ text: 'No sources supplied.' }]]) {
    const empty = markdownDocuments({ ...paper, summary: { ...paper.summary, claims } }, 'French', 'analysis')[0].content;
    assert.ok(empty.includes(disclaimer));
    assert.match(empty, /No exact source quotation/);
  }
  const legacy = markdownDocuments({ ...paper, summary: { source: 'Legacy plain summary.', target: 'Legacy translation.' } }, 'French', 'analysis')[0].content;
  assert.match(legacy, /Legacy plain summary/);
  assert.doesNotMatch(legacy, /undefined|null|Claim 1:/);
});
