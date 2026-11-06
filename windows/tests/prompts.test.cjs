const test = require('node:test');
const assert = require('node:assert/strict');

test('Markdown translation tokens preserve formulas and figure references', async () => {
  const { protectMarkdown, restoreMarkdown } = await import('../src/prompts.mjs');
  const original = 'The formula $E=mc^2$ appears beside ![plot](data:image/png;base64,AAAA).';
  const protectedBlock = protectMarkdown(original);
  assert.ok(!protectedBlock.text.includes('AAAA'));
  assert.equal(restoreMarkdown(protectedBlock.text, protectedBlock.tokens), original);
  assert.throws(() => restoreMarkdown('A model dropped every token.', protectedBlock.tokens));
});

test('Markdown translation also protects HTML, fenced code, bracket formulas, and URLs', async () => {
  const { protectMarkdown, restoreMarkdown } = await import('../src/prompts.mjs');
  const original = [
    'A<sup>2</sup> and \\[x+y\\] and \\(a+b\\) beside https://example.org/paper.',
    'Table 1: Scores. <table><tr><td>$0.42$</td></tr></table>',
    '~~~python',
    'print("<img src=figure.png>")',
    '~~~'
  ].join('\n');
  const protectedBlock = protectMarkdown(original);
  assert.ok(!protectedBlock.text.includes('<sup>'));
  assert.ok(!protectedBlock.text.includes('x+y'));
  assert.ok(!protectedBlock.text.includes('example.org'));
  assert.ok(!protectedBlock.text.includes('print('));
  assert.ok(!protectedBlock.text.includes('<td>'));
  assert.equal(restoreMarkdown(protectedBlock.text, protectedBlock.tokens), original);
  assert.throws(() => restoreMarkdown(protectedBlock.text.replace(protectedBlock.tokens[0][0], ''), protectedBlock.tokens));
});

test('selection translation keeps a bounded context separate from the exact requested text', async () => {
  const { selectionContext, selectionTranslationPrompt, strictSelectionTranslationPrompt } = await import('../src/prompts.mjs');
  const selected = 'target phrase';
  const context = `${'A'.repeat(450)}${selected}${'B'.repeat(450)}`;
  const bounded = selectionContext(context, selected, 600);
  assert.equal(bounded.length, 600);
  assert.ok(bounded.includes(selected));
  const prompt = selectionTranslationPrompt(selected, bounded, 'English', 'Chinese', [{ source: 'target', target: '目标' }]);
  assert.match(prompt, /PAPERBRIDGE_CONTEXT_DO_NOT_TRANSLATE/);
  assert.match(prompt, /PAPERBRIDGE_SELECTION_TRANSLATE_ONLY/);
  assert.match(prompt, /"source":"target","translation":"目标"/);
  assert.match(strictSelectionTranslationPrompt(selected, 'English', 'Chinese'), /Do not add a label/);
  assert.doesNotMatch(strictSelectionTranslationPrompt(selected, 'English', 'Chinese'), /CONTEXT_DO_NOT_TRANSLATE/);
});

test('the length guard flags excessive output for short selections', async () => {
  const { isLikelyOverexpandedSelection, selectionTranslationCacheVersion } = await import('../src/prompts.mjs');
  assert.equal(selectionTranslationCacheVersion, 'selection-translation-v3');
  assert.equal(isLikelyOverexpandedSelection('x'.repeat(49), 'short phrase'), true);
  assert.equal(isLikelyOverexpandedSelection('concise translation', 'short phrase'), false);
  assert.equal(isLikelyOverexpandedSelection('x'.repeat(1000), 's'.repeat(321)), false);
});

test('translation context requires a unique selection spanning complete sentences', async () => {
  const { spansCompleteSentences } = await import('../src/prompts.mjs');
  const context = 'Deeper networks are hard to train. We present a residual learning framework for training deeper models. We evaluate it on ImageNet.';
  assert.equal(spansCompleteSentences('train. We present a residual learning framework', context), false);
  assert.equal(spansCompleteSentences('framework for training deeper models.', context), false);
  assert.equal(spansCompleteSentences('We present a residual learning framework', context), false);
  assert.equal(spansCompleteSentences('We present a residual learning framework\nfor training deeper models.', context), true);
  assert.equal(spansCompleteSentences('Deeper networks are hard to train. We present a residual learning framework for training deeper models.', context), true);
  assert.equal(spansCompleteSentences('我们验证了结果。', '我们提出了新方法。我们验证了结果。研究仍有局限。'), true);
  assert.equal(spansCompleteSentences('We evaluated it.', 'We evaluated it. The comparison found no difference. We evaluated it.'), false);
  assert.equal(spansCompleteSentences('Abstract', 'Abstract'), false);
  assert.equal(spansCompleteSentences('Unmatched quote.', context), false);
});

test('translation prompts treat short items as complete and never request more context', async () => {
  const { translationSystem, selectionTranslationSystem, translationPrompt, markdownTranslationPrompt } = await import('../src/prompts.mjs');
  for (const prompt of [translationSystem('Chinese'), selectionTranslationSystem('Chinese'), translationPrompt('Abstract', 'English', 'Chinese'), markdownTranslationPrompt('# Methods', 'English', 'Chinese')]) {
    assert.match(prompt, /complete translation unit|complete academic item|complete academic Markdown item/);
    assert.match(prompt, /(?:Do not|never) ask for more context/i);
  }
});
