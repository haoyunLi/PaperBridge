const test = require('node:test');
const assert = require('node:assert/strict');

test('connected translation groups adjacent paragraphs and leaves resources and references in order', async () => {
  const { planConnectedBatches } = await import('../src/connectedTranslation.mjs');
  const blocks = [
    { id: 1, text: 'Opening paragraph.' },
    { id: 2, text: 'Second paragraph.' },
    { id: 3, sourceMarkdown: '$$x=2$$', resource: true },
    { id: 4, text: 'Results go here.' },
    { id: 5, text: 'References', heading: true },
    { id: 6, text: '[1] Leave this citation entry alone.' },
    { id: 7, text: 'Appendix', heading: true },
    { id: 8, text: 'Supplemental text.' }
  ];
  assert.deepEqual(planConnectedBatches(blocks), [
    { kind: 'translation', source: 'Opening paragraph.\n\nSecond paragraph.' },
    { kind: 'original', source: '$$x=2$$' },
    { kind: 'translation', source: 'Results go here.' },
    { kind: 'original', source: 'References' },
    { kind: 'original', source: '[1] Leave this citation entry alone.' },
    { kind: 'translation', source: 'Appendix\n\nSupplemental text.' }
  ]);
});

test('long excerpts preserve punctuation, Unicode, and whole protected figures at a batch boundary', async () => {
  const { planConnectedBatches, restoreConnectedExcerpt } = await import('../src/connectedTranslation.mjs');
  const { protectMarkdown } = await import('../src/prompts.mjs');
  const image = `data:image/png;base64,${'A'.repeat(7000)}`;
  const source = `${'a'.repeat(4799)}😀${'b'.repeat(4788)}${image}?! \$x=2\$ tail.`;
  const batches = planConnectedBatches([{ id: 1, text: source }]);
  assert.ok(batches.length > 2);
  assert.equal(batches.map(batch => batch.source).join('').replace(/\s/g, ''), source.replace(/\s/g, ''));
  assert.equal(batches.filter(batch => batch.source.includes(image)).length, 1);
  for (const batch of batches) {
    assert.doesNotMatch(batch.source, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    assert.ok(protectMarkdown(batch.source).text.length <= 4800);
  }
  const protectedBlock = protectMarkdown(`Equation $x=2$ and ${image}`);
  const [first, second] = protectedBlock.tokens.map(([marker]) => marker);
  assert.equal(restoreConnectedExcerpt(protectedBlock.text, protectedBlock.tokens), `Equation $x=2$ and ${image}`);
  for (const output of [first, `${first} ${second} ${second}`, `${second} ${first}`]) {
    assert.throws(() => restoreConnectedExcerpt(output, protectedBlock.tokens), /Retry this batch/);
  }
});

test('connected batch status survives model switches and excludes stale or legacy drafts from resume', async () => {
  const { pendingConnectedBatches, connectedBatchVersion } = await import('../src/connectedTranslation.mjs');
  const { switchOutputSettings } = await import('../src/outputCache.mjs');
  const settings = { aiProvider: 'ollama', translationModel: 'model:a', sourceLanguage: 'English', targetLanguage: 'French' };
  const next = { ...settings, translationModel: 'model:b' };
  const failed = { kind: 'translation', source: 'Second excerpt.', output: 'Second excerpt.', status: 'failed' };
  const paper = {
    blocks: [{ id: 1, text: 'First excerpt.' }, { id: 2, text: 'Second excerpt.' }],
    connectedTranslation: 'Premier extrait.\n\nSecond excerpt.',
    connectedBatchVersion,
    connectedBlocks: [
      { kind: 'translation', source: 'First excerpt.', output: 'Premier extrait.', status: 'ok' },
      failed
    ]
  };
  const switched = switchOutputSettings(paper, settings, next);
  assert.deepEqual(pendingConnectedBatches(switched), []);
  const restored = switchOutputSettings(switched, next, settings);
  assert.equal(restored.connectedTranslation, paper.connectedTranslation);
  assert.deepEqual(pendingConnectedBatches(restored), [{ ...failed, translationLanguage: null }]);
  assert.equal(Object.hasOwn(failed, 'translationLanguage'), false, 'migration must leave the original legacy fixture untouched');
  assert.deepEqual(pendingConnectedBatches({ ...restored, connectedStale: true }), []);
  assert.deepEqual(pendingConnectedBatches({ ...restored, connectedBatchVersion: null }), []);
});
