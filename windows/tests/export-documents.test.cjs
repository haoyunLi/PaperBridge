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
  assert.ok(docs.analysis.includes(`## Connected Full Translation (French)\n\n${docs.full}`));
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
  assert.equal(markdownDocuments(original, 'German', 'full')[0].content, markdownDocuments(original, 'French', 'full')[0].content,
    'The legacy current-language argument cannot relabel a saved artifact or suppress its valid failure markers.');
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

const pair = targetLanguage => ({ sourceLanguage: 'English', targetLanguage });
const translatedBlock = (id, targetLanguage, extra = {}) => ({ id, text: `Source ${id}.`, status: 'ok',
  translation: `Saved output ${id}.`, translationLanguage: targetLanguage ? pair(targetLanguage) : null, ...extra });
const descriptors = documents => Object.fromEntries(documents.map(document => [document.kind, document]));

test('each analysis language and filename describes its own saved output rather than current settings', async () => {
  const [{ markdownDocuments, markdownExportName }] = await modules;
  const paper = { name: 'Study.draft.pdf', blocks: [translatedBlock(1, 'Japanese')], taskSettings: pair('Spanish'),
    summary: { source: 'Saved source summary.', target: 'Résumé français.', sourceLanguage: 'English', targetLanguage: 'French' },
    connectedTranslation: 'Gespeicherte Übersetzung.', connectedLanguage: pair('German') };
  const before = structuredClone(paper);
  const docs = descriptors(markdownDocuments(paper, 'Russian'));
  assert.match(docs.analysis.content, /## Whole-paper summary \(English\)\n\nSaved source summary\./);
  assert.match(docs.analysis.content, /## Whole-paper summary \(French\)\n\nRésumé français\./);
  assert.match(docs.analysis.content, /## Connected Full Translation \(German\)\n\nGespeicherte Übersetzung\./);
  assert.match(docs.analysis.content, /### Paragraph 1\n\n#### Original English\n\nSource 1\.\n\n#### Translation \(Japanese\)\n\nSaved output 1\./);
  assert.doesNotMatch(docs.analysis.content, /Spanish|Russian/);
  assert.deepEqual(Object.fromEntries(Object.entries(docs).map(([kind, document]) => [kind, document.filename])), {
    original: 'paper_original.md', translated: 'paper_translation_ja.md', bilingual: 'paper_bilingual_en_ja.md',
    analysis: 'paper_analysis_notes.md', full: 'paper_full_translation_de.md'
  });
  assert.deepEqual([docs.original.name, docs.translated.name, docs.bilingual.name, docs.analysis.name, docs.full.name],
    ['Original', 'Translated', 'Bilingual', 'Analysis', 'Full Translation']);
  assert.equal(markdownExportName(paper, docs.analysis), 'Study.draft_bilingual');
  assert.equal(markdownExportName(paper, docs.original), 'Study.draft_original');
  assert.equal(markdownExportName(paper, docs.translated), 'Study.draft_translation_ja');
  assert.equal(markdownExportName(paper, docs.bilingual), 'Study.draft_bilingual_en_ja');
  assert.equal(markdownExportName(paper, docs.full), 'Study.draft_full_translation_de');
  assert.deepEqual(paper, before);
});

test('all eleven Mac language codes are deterministic and Chinese scripts stay distinct', async () => {
  const [{ markdownDocuments }] = await modules;
  for (const [language, code] of Object.entries({ English: 'en', 'Simplified Chinese': 'zh-Hans', 'Traditional Chinese': 'zh-Hant',
    Japanese: 'ja', Korean: 'ko', French: 'fr', German: 'de', Spanish: 'es', Italian: 'it', Portuguese: 'pt', Russian: 'ru' })) {
    const docs = descriptors(markdownDocuments({ name: 'Study', blocks: [translatedBlock(1, language)],
      connectedTranslation: 'Saved full text.', connectedLanguage: pair(language) }, 'Unrelated language'));
    assert.equal(docs.translated.filename, `paper_translation_${code}.md`);
    assert.equal(docs.bilingual.filename, `paper_bilingual_en_${code}.md`);
    assert.equal(docs.full.filename, `paper_full_translation_${code}.md`);
  }
});

test('old unknown, explicit unknown and mixed outputs retain text with generic language labels and names', async () => {
  const [{ markdownDocuments }] = await modules;
  const legacy = { name: 'Old paper', sourceMode: 'mineru', blocks: [
    { id: 1, text: 'Old source.', sourceMarkdown: 'Old **source**.', status: 'ok', translation: '旧中文译文。' }
  ], connectedTranslation: '独立旧全文。', summary: { source: 'Old source summary.', target: '旧摘要。' } };
  for (const paper of [legacy, { ...legacy, taskSettings: pair('German'), connectedLanguage: null,
    blocks: legacy.blocks.map(block => ({ ...block, translationLanguage: null })) },
  { ...legacy, taskSettings: pair('Chinese') }]) {
    const before = structuredClone(paper);
    const docs = descriptors(markdownDocuments(paper, 'German'));
    assert.equal(docs.translated.filename, 'paper_translation.md');
    assert.equal(docs.bilingual.filename, 'paper_bilingual.md');
    assert.equal(markdownDocuments(paper, 'German', 'full')[0].filename, 'paper_full_translation.md');
    assert.match(docs.bilingual.content, /> \*\*Translation\*\*\n>\n> 旧中文译文。/);
    assert.match(docs.analysis.content, /## Source summary\n\nOld source summary\./);
    assert.match(docs.analysis.content, /## Target summary\n\n旧摘要。/);
    assert.match(docs.analysis.content, /## Connected Full Translation\n\n独立旧全文。/);
    assert.doesNotMatch(docs.analysis.content + docs.bilingual.content, /German|Simplified Chinese|Traditional Chinese|undefined|null/);
    assert.deepEqual(paper, before);
  }
  for (const second of [translatedBlock(2, null), translatedBlock(2, 'German')]) {
    const mixed = { name: 'Mixed saved outputs', blocks: [translatedBlock(1, 'French'), second] };
    const docs = descriptors(markdownDocuments(mixed, 'French'));
    assert.equal(docs.translated.filename, 'paper_translation.md');
    assert.equal(docs.bilingual.filename, 'paper_bilingual.md');
    assert.match(docs.translated.content, /Saved output 1\.\n\nSaved output 2\./);
    assert.match(docs.analysis.content, /#### Translation \(French\)/);
  }
});

test('structured and facsimile file languages follow only adopted output while direct legacy full stays independent', async () => {
  const [{ markdownDocuments }] = await modules;
  const blocks = [translatedBlock(1, 'French', { sourceMarkdown: 'Ready **source**.', translationMarkdown: 'Texte **français**.' }),
    translatedBlock(2, 'German', { sourceMarkdown: 'Failed source.', status: 'failed', error: 'Retry needed.', translation: 'Alte Übersetzung.' }),
    translatedBlock(3, 'Japanese', { sourceMarkdown: '![Figure](images/a.png)', resource: true })];
  const base = { name: 'Saved variants.pdf', type: 'pdf', blocks, connectedShared: false,
    connectedTranslation: 'Vecchia traduzione completa.', connectedLanguage: pair('Italian') };
  const structured = { ...base, sourceMode: 'mineru' };
  const bundle = descriptors(markdownDocuments(structured, 'Russian'));
  assert.equal(bundle.translated.filename, 'paper_translation_fr.md');
  assert.equal(bundle.bilingual.filename, 'paper_bilingual_en_fr.md');
  assert.equal(bundle.full.filename, 'paper_full_translation_fr.md');
  assert.equal(bundle.full.content, bundle.translated.content);
  assert.doesNotMatch(bundle.full.content, /Alte Übersetzung|Vecchia traduzione/);
  const direct = markdownDocuments(structured, 'Russian', 'full')[0];
  assert.equal(direct.filename, 'paper_full_translation_it.md');
  assert.equal(direct.content, base.connectedTranslation);
  assert.match(bundle.analysis.content, /Connected Full Translation \(Italian\)/);
  const facsimile = descriptors(markdownDocuments({ ...base, sourceMode: 'pdf' }, 'Russian'));
  assert.equal(facsimile.translated.filename, 'paper_translation_fr.md');
  assert.match(facsimile.bilingual.content, /Ready \*\*source\*\*\.\n\n> \*\*French translation\*\*/);
  assert.match(facsimile.bilingual.content, /Failed source\.\n\n> \*\*Translation\*\*\n>\n> \[Translation unavailable\]/);
  assert.doesNotMatch(facsimile.bilingual.content, /German translation|Alte Übersetzung/);
  const directPlain = markdownDocuments({ ...base, sourceMode: 'pdf' }, 'Russian', 'translated')[0];
  assert.equal(directPlain.filename, 'paper_translation.md');
  assert.match(directPlain.content, /Alte Übersetzung/);
  const stale = descriptors(markdownDocuments({ ...structured, connectedStale: true }, 'German'));
  assert.equal(stale.full.filename, 'paper_full_translation_it.md');
  assert.equal(stale.full.content, `> The source changed after this translation was saved.\n\n${base.connectedTranslation}`);
});

test('contradictory connected batch language metadata cannot attach failure labels to another saved artifact', async () => {
  const [{ markdownDocuments }, , , { switchOutputSettings }] = await modules;
  const { migrateOutputLanguages } = await import('../src/outputLanguages.mjs');
  const paper = await fixture();
  const { connectedTranslationMarkdown } = await import('../src/connectedTranslationExport.mjs');
  assert.equal(connectedTranslationMarkdown(paper, 'German'), paper.connectedTranslation,
    'The legacy explicit-target conflict guard remains conservative for direct helper callers.');
  paper.connectedLanguage = pair('French');
  paper.connectedBlocks = paper.connectedBlocks.map(batch => ({ ...batch, translationLanguage: pair('German') }));
  const before = structuredClone(paper);
  const migrated = migrateOutputLanguages(paper);
  assert.equal(migrated.connectedLanguage, null);
  assert.equal(migrated.connectedLanguageConflict, true);
  const serialized = JSON.parse(JSON.stringify(migrated));
  assert.deepEqual(migrateOutputLanguages(serialized), serialized);
  const next = { ...settings, targetLanguage: 'German' };
  const switched = switchOutputSettings(serialized, settings, next);
  const restored = switchOutputSettings(JSON.parse(JSON.stringify(switched)), next, settings);
  for (const document of [paper, migrated, serialized, restored]) {
    const full = markdownDocuments(document, 'German', 'full')[0];
    assert.equal(full.filename, 'paper_full_translation.md');
    assert.equal(full.content, paper.connectedTranslation);
  }
  assert.equal(restored.connectedLanguageConflict, true);
  assert.equal(restored.connectedLanguage, null);
  assert.deepEqual(paper, before, 'Export and pure migration must not overwrite the conflicting input evidence.');
});

test('a rebuilt shared artifact uses current Reader evidence while a conflicting saved full draft stays literal', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = { name: 'Shared conflict', sourceMode: 'mineru', connectedShared: true, connectedLanguage: pair('French'),
    blocks: [translatedBlock(1, 'German', { sourceMarkdown: 'Ready source.', translation: 'Ergebnis.' }),
      translatedBlock(2, 'German', { sourceMarkdown: 'Failed source.', translation: '', status: 'failed', error: 'Interrupted.' })],
    connectedTranslation: 'Ergebnis.\n\nFailed source.' };
  const direct = markdownDocuments(paper, 'French', 'full')[0];
  assert.equal(direct.filename, 'paper_full_translation.md');
  assert.equal(direct.content, paper.connectedTranslation);
  const rebuilt = descriptors(markdownDocuments(paper, 'French')).full;
  assert.equal(rebuilt.filename, 'paper_full_translation_de.md');
  assert.match(rebuilt.content, /\[Connected translation failed for paragraph 2\] Interrupted\./);
  assert.ok(rebuilt.content.endsWith('Failed source.'));
});

test('failed Analysis passages do not claim the language of retained old output and summary sides resolve independently', async () => {
  const [{ markdownDocuments }] = await modules;
  const paper = { name: 'Failed retained translation', blocks: [translatedBlock(1, 'German', { status: 'failed', error: 'Model interrupted.' })],
    summary: { source: 'Source summary.', target: 'Unknown-script summary.', sourceLanguage: 'English', targetLanguage: 'Chinese' } };
  const output = markdownDocuments(paper, 'French', 'analysis')[0].content;
  assert.match(output, /## Whole-paper summary \(English\)\n\nSource summary\./);
  assert.match(output, /## Target summary\n\nUnknown-script summary\./);
  assert.match(output, /#### Original English\n\nSource 1\.\n\n#### Translation\n\n\[Translation failed\] Model interrupted\./);
  assert.doesNotMatch(output, /Translation \(German\)|French|Simplified Chinese|Saved output 1/);
});
