const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults } = require('../electron/storage.cjs');

const outputCache = import('../src/outputCache.mjs');
const settings = { ...defaults, translationModel: 'translate:a', summaryModel: 'summary:a', explainModel: 'explain:a' };

function paperWithOutputs(label = 'A') {
  return {
    id: 'fixture-paper',
    blocks: [
      { id: 1, text: 'Abstract', heading: true, translation: '', translationMarkdown: null, status: 'pending', error: '', translationHighlights: [], notes: [] },
      { id: 2, text: 'A reproducible method.', translation: `${label} paragraph`, translationMarkdown: `**${label} paragraph**`, status: 'ok', error: '',
        highlights: [{ text: 'method', offset: 15, color: 'amber' }],
        translationHighlights: [{ text: label, offset: 0, color: 'blue' }],
        notes: [{ id: 'source-note', kind: 'source', text: 'method', body: 'Source note' }, { id: `${label}-translation-note`, kind: 'translation', text: label, body: `${label} translation note` }] },
      { id: 3, text: 'An independent result.', translation: `${label} result`, translationMarkdown: null, status: 'ok', error: '', translationHighlights: [], notes: [] }
    ],
    connectedTranslation: `${label} full translation`, connectedBlocks: [{ source: 'A reproducible method.', output: `${label} full translation` }], connectedStale: false,
    summary: { source: `${label} source summary`, target: `${label} target summary`, claims: [{ quote: 'A reproducible method.', blockId: 2 }] },
    viewNotes: ['fullTranslation', 'summarySource', 'summaryTarget'].map(scope => ({ id: `${label}-${scope}`, scope, body: `${label} ${scope} note` })),
    viewHighlights: ['fullTranslation', 'summarySource', 'summaryTarget'].map(scope => ({ id: `${label}-${scope}`, scope, text: label, offset: 0, color: 'amber' })),
    pdfNotes: [{ page: 1, text: 'Original PDF', body: 'Keep this PDF note' }]
  };
}

function applyOutputs(paper, label) {
  const generated = paperWithOutputs(label);
  return { ...paper, blocks: generated.blocks, connectedTranslation: generated.connectedTranslation, connectedBlocks: generated.connectedBlocks,
    summary: generated.summary, viewNotes: generated.viewNotes, viewHighlights: generated.viewHighlights };
}

function assertGeneratedOutputs(paper, label) {
  const expected = paperWithOutputs(label);
  for (const key of ['blocks', 'connectedTranslation', 'connectedBlocks', 'summary', 'viewNotes', 'viewHighlights', 'pdfNotes']) {
    assert.deepEqual(paper[key], expected[key], `${key} should restore version ${label}`);
  }
}

test('changing languages, translation model, or endpoint isolates outputs and restores both settings variants', async () => {
  const { switchOutputSettings } = await outputCache;
  for (const change of [{ targetLanguage: 'German' }, { sourceLanguage: 'Japanese' }, { translationModel: 'translate:b' }, { ollamaBaseURL: 'http://127.0.0.1:11435' }]) {
    const original = paperWithOutputs();
    const originalSnapshot = structuredClone(original);
    const next = { ...settings, ...change };
    const blank = switchOutputSettings(original, settings, next);
    assert.equal(blank.blocks[1].translation, '');
    assert.equal(blank.blocks[1].status, 'pending');
    assert.equal(blank.connectedTranslation, '');
    assert.equal(blank.summary, null);
    assert.equal(blank.viewNotes.length, 0);
    assert.equal(blank.blocks[1].translationHighlights.length, 0);
    assert.deepEqual(blank.blocks[1].notes, original.blocks[1].notes.filter(note => note.kind === 'source'));
    assert.deepEqual(blank.blocks[1].highlights, original.blocks[1].highlights);
    assert.deepEqual(blank.pdfNotes, original.pdfNotes);
    const versionB = applyOutputs(blank, 'B');
    const backOnA = switchOutputSettings(versionB, next, settings);
    assertGeneratedOutputs(backOnA, 'A');
    assertGeneratedOutputs(switchOutputSettings(backOnA, settings, next), 'B');
    assert.deepEqual(original, originalSnapshot, 'switching settings must not mutate saved input');
  }
});

test('switching providers or translation style restores each saved output variant', async () => {
  const { switchOutputSettings } = await outputCache;
  const local = { ...settings, aiProvider: 'ollama', translationStyleGuide: '' };
  const online = { ...settings, aiProvider: 'openai', openAITranslationModel: 'gpt-translate', openAISummaryModel: 'gpt-summary', openAIExplainModel: 'gpt-explain', openAIQuickLookupModel: 'gpt-quick', translationStyleGuide: 'Concise academic Chinese.' };
  const blankOnline = switchOutputSettings(paperWithOutputs('LOCAL'), local, online);
  assert.equal(blankOnline.blocks[1].translation, '');
  assert.equal(blankOnline.summary, null);
  const generatedOnline = applyOutputs(blankOnline, 'ONLINE');
  const restoredLocal = switchOutputSettings(generatedOnline, online, local);
  assertGeneratedOutputs(restoredLocal, 'LOCAL');
  assertGeneratedOutputs(switchOutputSettings(restoredLocal, local, online), 'ONLINE');
  const alternateStyle = { ...online, translationStyleGuide: 'Literal academic Chinese.' };
  assert.equal(switchOutputSettings(generatedOnline, online, alternateStyle).blocks[1].translation, '');
});

test('source edits reject stale paragraph, summary, full translation and their annotations while unchanged paragraphs restore', async () => {
  const { switchOutputSettings } = await outputCache;
  const next = { ...settings, targetLanguage: 'German' };
  const switched = switchOutputSettings(paperWithOutputs(), settings, next);
  const edited = { ...switched, blocks: switched.blocks.map(block => block.id === 2 ? { ...block, text: 'A changed method.' } : block) };
  const restored = switchOutputSettings(edited, next, settings);
  assert.equal(restored.blocks[1].translation, '');
  assert.equal(restored.blocks[1].status, 'pending');
  assert.equal(restored.blocks[1].translationHighlights.length, 0);
  assert.equal(restored.blocks[1].notes.some(note => note.kind === 'translation'), false);
  assert.equal(restored.blocks[2].translation, 'A result');
  assert.equal(restored.connectedTranslation, '');
  assert.deepEqual(restored.connectedBlocks, []);
  assert.equal(restored.summary, null);
  assert.deepEqual(restored.viewNotes, []);
  assert.deepEqual(restored.viewHighlights, []);
  assert.equal(restored.pdfNotes.length, 1);
});

test('structured Markdown edits also invalidate restored translations even when rendered text is unchanged', async () => {
  const { switchOutputSettings } = await outputCache;
  const original = paperWithOutputs();
  original.blocks[1].sourceMarkdown = '**A reproducible method.**';
  const next = { ...settings, translationModel: 'translate:b' };
  const switched = switchOutputSettings(original, settings, next);
  switched.blocks = switched.blocks.map(block => block.id === 2 ? { ...block, sourceMarkdown: '*A reproducible method.*' } : block);
  const restored = switchOutputSettings(switched, next, settings);
  assert.equal(restored.blocks[1].translation, '');
  assert.equal(restored.connectedTranslation, '');
  assert.equal(restored.summary, null);
});

test('a shared structured draft follows the active Reader cache and restores the old draft and its annotations', async () => {
  const { switchOutputSettings } = await outputCache;
  const { withSharedMarkdownTranslation } = await import('../src/academicMarkdown.mjs');
  const structured = paperWithOutputs();
  structured.sourceMode = 'mineru';
  structured.blocks[1].sourceMarkdown = '**A reproducible method.**';
  const original = withSharedMarkdownTranslation(structured);
  const alternateChunks = { ...settings, maxParagraphChars: settings.maxParagraphChars + 100 };
  const alternateModel = { ...settings, translationModel: 'translate:b' };
  const differentChunks = switchOutputSettings(original, settings, alternateChunks);
  assert.match(differentChunks.connectedTranslation, /\*\*A reproducible method\.\*\*/);
  assert.doesNotMatch(differentChunks.connectedTranslation, /A paragraph/);
  assert.equal(switchOutputSettings(differentChunks, alternateChunks, settings).connectedTranslation, original.connectedTranslation);
  const differentModel = switchOutputSettings(original, settings, alternateModel);
  assert.equal(differentModel.connectedTranslation, '');
  assert.equal(differentModel.connectedShared, false);
  const restored = switchOutputSettings(differentModel, alternateModel, settings);
  assert.equal(restored.connectedShared, true);
  assert.equal(restored.connectedTranslation, original.connectedTranslation);
  assert.deepEqual(restored.viewNotes, original.viewNotes);
});

test('parser, appearance, quick lookup and explanation model changes retain translation and summary outputs', async () => {
  const { switchOutputSettings } = await outputCache;
  const changed = { ...settings, pdfExtractionMode: 'pdfOnly', mineruExecutable: 'C:\\tools\\other-mineru.exe', mineruBackend: 'pipeline',
    fontSize: 24, lineHeight: 2.1, readingWidth: 700, quickLookupModel: 'lookup:b', explainModel: 'explain:b', autoCheckUpdates: false };
  assertGeneratedOutputs(switchOutputSettings(paperWithOutputs(), settings, changed), 'A');
});

test('chunk size changes affect paragraph outputs only and retain summary and full translation annotations', async () => {
  const { switchOutputSettings } = await outputCache;
  const original = paperWithOutputs();
  const next = { ...settings, maxParagraphChars: settings.maxParagraphChars + 100 };
  const changed = switchOutputSettings(original, settings, next);
  assert.equal(changed.blocks[1].translation, '');
  assert.equal(changed.blocks[1].notes.some(note => note.kind === 'translation'), false);
  for (const key of ['summary', 'connectedTranslation', 'connectedBlocks', 'viewNotes', 'viewHighlights']) assert.deepEqual(changed[key], original[key]);
  assertGeneratedOutputs(switchOutputSettings(changed, next, settings), 'A');
});

test('changing only the summary model keeps paragraph and full translation results with their notes', async () => {
  const { switchOutputSettings } = await outputCache;
  const original = paperWithOutputs();
  const next = { ...settings, summaryModel: 'summary:b' };
  const changed = switchOutputSettings(original, settings, next);
  assert.deepEqual(changed.blocks, original.blocks);
  assert.equal(changed.connectedTranslation, original.connectedTranslation);
  assert.equal(changed.summary, null);
  assert.deepEqual(changed.viewNotes, original.viewNotes.filter(item => item.scope === 'fullTranslation'));
  assert.deepEqual(changed.viewHighlights, original.viewHighlights.filter(item => item.scope === 'fullTranslation'));
  assertGeneratedOutputs(switchOutputSettings(changed, next, settings), 'A');
});

test('paragraph explanations remain separate by model, endpoint, language and matching source with legacy migration', async () => {
  const { cachedExplanation, explanationKey, migrateExplanations } = await outputCache;
  const paper = paperWithOutputs();
  const result = { id: 2, language: 'English', source: paper.blocks[1].text, output: 'Original explanation' };
  paper.paragraphExplanations = { '2|English': result };
  paper.paragraphExplanations = migrateExplanations(paper, settings);
  assert.equal(cachedExplanation(paper, 2, 'English', settings).output, 'Original explanation');
  const modelB = { ...settings, explainModel: 'explain:b' };
  const endpointB = { ...settings, ollamaBaseURL: 'http://127.0.0.1:11435' };
  for (const [language, config] of [['French', settings], ['English', modelB], ['English', endpointB]]) {
    assert.equal(cachedExplanation(paper, 2, language, config), null);
    const key = explanationKey(2, language, config);
    paper.paragraphExplanations[key] = { ...result, language, settingsKey: key, output: `${language} ${config.explainModel} ${config.ollamaBaseURL}` };
  }
  paper.paragraphExplanations = migrateExplanations(paper, modelB);
  assert.equal(Object.keys(paper.paragraphExplanations).length, 4);
  assert.equal(cachedExplanation(paper, 2, 'English', settings).output, 'Original explanation');
  assert.match(cachedExplanation(paper, 2, 'English', modelB).output, /explain:b/);
  assert.match(cachedExplanation(paper, 2, 'French', settings).output, /French/);
  assert.match(cachedExplanation(paper, 2, 'English', endpointB).output, /11435/);
  paper.blocks[1].text = 'An edited source.';
  assert.equal(cachedExplanation(paper, 2, 'English', settings), null);
  assert.equal(cachedExplanation(paper, 2, 'English', modelB), null);
  paper.blocks[1].text = result.source;
  assert.equal(cachedExplanation(paper, 2, 'English', settings).output, 'Original explanation');
});

test('PDF and MinerU reader translations keep independent language variants including the initially hidden source', async () => {
  const { switchOutputSettings, switchReadingSource: activate } = await outputCache;
  const next = { ...settings, targetLanguage: 'German' };
  // Both parsers intentionally produce identical source IDs/text here: their saved
  // translations and annotations must remain separate even when source matching succeeds.
  const blocks = label => paperWithOutputs(label).blocks;
  let paper = { id: 'two-reader-versions', sourceMode: 'pdf', blocks: blocks('PDF A'),
    pdfBlocks: blocks('PDF A'), mineruBlocks: blocks('MinerU A'), summary: null, connectedTranslation: '' };
  paper = switchOutputSettings(paper, settings, next);
  assert.equal(paper.blocks[1].translation, '');
  assert.equal(paper.sourceSettings.pdf.targetLanguage, 'German');
  assert.equal(paper.sourceSettings.mineru.targetLanguage, settings.targetLanguage);
  assert.equal(paper.mineruBlocks[1].translation, 'MinerU A paragraph');
  paper = { ...paper, blocks: blocks('PDF B') };

  paper = activate(paper, 'mineru', next);
  assert.equal(paper.blocks[1].translation, '', 'hidden MinerU A translation must not appear under settings B');
  assert.equal(paper.blocks[1].status, 'pending');
  assert.equal(paper.blocks[1].translationHighlights.length, 0);
  assert.equal(paper.pdfBlocks[1].translation, 'PDF B paragraph');
  paper = { ...paper, blocks: blocks('MinerU B') };

  paper = activate(paper, 'pdf', next);
  assert.deepEqual(paper.blocks, blocks('PDF B'));
  paper = switchOutputSettings(paper, next, settings);
  assert.deepEqual(paper.blocks, blocks('PDF A'));
  assert.equal(paper.sourceSettings.mineru.targetLanguage, 'German');
  paper = activate(paper, 'mineru', settings);
  assert.deepEqual(paper.blocks, blocks('MinerU A'));
  paper = activate(paper, 'pdf', settings);
  assert.deepEqual(paper.blocks, blocks('PDF A'));

  paper = switchOutputSettings(paper, settings, next);
  assert.deepEqual(paper.blocks, blocks('PDF B'));
  paper = activate(paper, 'mineru', next);
  assert.deepEqual(paper.blocks, blocks('MinerU B'));
});

test('switching to a hidden parser with old settings files the outgoing draft and summary under their actual source and settings', async () => {
  const { switchOutputSettings, switchReadingSource, connectedKey, summaryKey } = await outputCache;
  const next = { ...settings, targetLanguage: 'German' };
  const original = paperWithOutputs('PDF A');
  let paper = { ...original, sourceMode: 'pdf', pdfBlocks: original.blocks, mineruBlocks: paperWithOutputs('MinerU A').blocks };
  paper = switchOutputSettings(paper, settings, next);
  paper = applyOutputs(paper, 'PDF B');
  const result = switchReadingSource(paper, 'mineru', next);
  assert.equal(result.blocks[1].translation, '');
  assert.equal(result.connectedTranslation, '');
  assert.equal(result.summary, null);
  assert.deepEqual(result.viewNotes, []);
  assert.deepEqual(result.viewHighlights, []);
  assert.equal(result.outputVariants.connected[JSON.stringify(['pdf', connectedKey(settings)])].text, 'PDF A full translation');
  assert.equal(result.outputVariants.connected[JSON.stringify(['pdf', connectedKey(next)])].text, 'PDF B full translation');
  assert.equal(result.outputVariants.summaries[JSON.stringify(['pdf', summaryKey(next)])].summary.source, 'PDF B source summary');
  assertGeneratedOutputs(switchReadingSource(result, 'pdf', next), 'PDF B');
});

test('source switches preserve independent summaries, resumable drafts and annotations across a serialized workspace', async () => {
  const { switchReadingSource } = await outputCache;
  const original = paperWithOutputs('PDF');
  const paperNote = { id: 'article', scope: 'paperArticle', body: 'Keep this Paper preview note' };
  const initial = { ...original, type: 'pdf', sourceMode: 'pdf', pdfBlocks: original.blocks, mineruBlocks: paperWithOutputs('MinerU').blocks,
    connectedBatchVersion: 3, viewNotes: [...original.viewNotes, paperNote] };
  const empty = switchReadingSource(initial, 'mineru', settings);
  assert.equal(empty.summary, null);
  assert.equal(empty.connectedTranslation, '');
  assert.deepEqual(empty.viewNotes, [paperNote]);
  const generated = applyOutputs(empty, 'MinerU');
  generated.viewNotes.push(paperNote);
  const saved = JSON.parse(JSON.stringify(switchReadingSource(generated, 'pdf', settings)));
  assert.equal(saved.summary.source, 'PDF source summary');
  assert.deepEqual(saved.connectedBlocks, initial.connectedBlocks);
  assert.equal(saved.connectedBatchVersion, 3);
  assert.equal(saved.connectedStale, false);
  assert.deepEqual(saved.viewNotes.filter(item => item.scope !== 'paperArticle'), original.viewNotes);
  assert.deepEqual(saved.viewHighlights, original.viewHighlights);
  assert.equal(saved.viewNotes.filter(item => item.id === paperNote.id).length, 1);
  assert.deepEqual(saved.pdfNotes, original.pdfNotes);
  const restoredMineru = switchReadingSource(saved, 'mineru', settings);
  assert.equal(restoredMineru.summary.source, 'MinerU source summary');
  assert.equal(restoredMineru.connectedTranslation, 'MinerU full translation');
  assert.deepEqual(restoredMineru.viewNotes.filter(item => item.scope !== 'paperArticle'), generated.viewNotes.filter(item => item.scope !== 'paperArticle'));
});

test('a re-extracted source keeps an older draft for review and old PDF cache keys remain readable', async () => {
  const { switchOutputSettings, switchReadingSource } = await outputCache;
  const next = { ...settings, targetLanguage: 'German' };
  const original = paperWithOutputs('Legacy');
  const oldCache = switchOutputSettings(original, settings, next);
  const legacyPdf = { ...oldCache, type: 'pdf', pdfBlocks: oldCache.blocks, mineruBlocks: paperWithOutputs('MinerU').blocks };
  const mineru = switchReadingSource(legacyPdf, 'mineru', next);
  const back = switchReadingSource(mineru, 'pdf', next);
  const restored = switchOutputSettings(back, next, settings);
  assertGeneratedOutputs(restored, 'Legacy');
  const hidden = switchReadingSource(restored, 'mineru', settings);
  hidden.pdfBlocks = hidden.pdfBlocks.map(block => block.id === 2 ? { ...block, text: 'Edited after archiving the output.' } : block);
  const stale = switchReadingSource(hidden, 'pdf', settings);
  assert.equal(stale.summary.stale, true);
  assert.equal(stale.summary.source, 'Legacy source summary');
  assert.equal(stale.connectedStale, true);
  assert.equal(stale.connectedTranslation, 'Legacy full translation');
  assert.deepEqual(stale.viewNotes, original.viewNotes);
});

test('legacy explanations without saved task settings remain retained but never inherit a later model identity', async () => {
  const { cachedExplanation, migrateExplanations } = await outputCache;
  const paper = paperWithOutputs();
  const legacy = { id: 2, language: 'English', source: paper.blocks[1].text, output: 'Explanation from an unknown older model' };
  paper.paragraphExplanations = { '2|English': legacy };
  paper.paragraphExplanations = migrateExplanations(paper, null);
  assert.deepEqual(paper.paragraphExplanations['2|English'], { ...legacy, unverifiedSettings: true });
  assert.equal(cachedExplanation(paper, 2, 'English', settings), null);
  paper.paragraphExplanations = migrateExplanations(paper, settings);
  assert.deepEqual(Object.keys(paper.paragraphExplanations), ['2|English']);
  assert.equal(paper.paragraphExplanations['2|English'].output, legacy.output);
  assert.equal(paper.paragraphExplanations['2|English'].unverifiedSettings, true);
  assert.equal(cachedExplanation(paper, 2, 'English', settings), null);
});
