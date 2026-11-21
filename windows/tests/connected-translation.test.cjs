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

test('explicit local formula retries preserve paragraph separators and whole protected Markdown', async () => {
  const { connectedRetryExcerpts, isLocalMarkupRetry, restoreConnectedExcerpt } = await import('../src/connectedTranslation.mjs');
  const { protectMarkdown } = await import('../src/prompts.mjs');
  const formula = '$$N = 6\n\nx = 9$$';
  const source = 'Intro '.repeat(170) + formula + '\r\n \r\n' + 'Next '.repeat(160) + '`sample`\n\nEnd.';
  const batch = { kind: 'translation', source };
  const failed = { ...batch, errorCode: 'PROTECTED_MARKDOWN_CHANGED', status: 'failed' };
  const pieces = connectedRetryExcerpts(batch, isLocalMarkupRetry(batch, failed, 'ollama'));
  assert.equal(pieces.length, 3);
  assert.equal(pieces.map(part => part.separator + part.source).join(''), source);
  assert.ok(pieces[0].source.endsWith(formula));
  assert.equal(pieces[1].separator, '\r\n \r\n');
  const legacy = { ...batch, status: 'failed', error: 'The model changed a protected formula, figure, or link. Retry this batch.' };
  assert.equal(isLocalMarkupRetry(batch, legacy, 'ollama'), true);
  for (const [saved, provider] of [[undefined, 'ollama'], [failed, 'openai'], [{ ...failed, source: 'Old' }, 'ollama'],
    [{ ...failed, status: 'ok' }, 'ollama'], [{ ...failed, errorCode: 'NETWORK' }, 'ollama']]) {
    assert.equal(isLocalMarkupRetry(batch, saved, provider), false);
  }
  const protectedFormula = protectMarkdown(formula);
  assert.throws(() => restoreConnectedExcerpt('Lost formula.', protectedFormula.tokens), { code: 'PROTECTED_MARKDOWN_CHANGED' });
});

test('last-resort local translation takes protected bytes and split technical words from the source', async () => {
  const { protectMarkdown } = await import('../src/prompts.mjs');
  const { translateAroundMarkup } = await import('../src/connectedTranslation.mjs');
  const source = 'Learn pre-so<u>ftmax</u> with $x_1$.\r\n\r\nCompare `$&` and $$y = 2$$.';
  const seen = [];
  const translated = await translateAroundMarkup(protectMarkdown(source), async text => {
    seen.push(text);
    return { Learn: '学习', with: '使用', Compare: '比较', and: '与' }[text];
  });
  assert.deepEqual(seen, ['Learn', 'with', 'Compare', 'and']);
  assert.equal(translated, '学习 pre-so<u>ftmax</u> 使用 $x_1$.\r\n\r\n比较 `$&` 与 $$y = 2$$.');
  for (const answer of ['', '__PAPERBRIDGE_TOKEN_1__', '<img src=x>']) {
    await assert.rejects(translateAroundMarkup(protectMarkdown('Compare $x$.'), async () => answer), /could not translate/);
  }
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
