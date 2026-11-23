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

test('structured paragraphs mask complete code spans and nested figures before translation', async () => {
  const { protectStructuredMarkdown } = await import('../src/academicMarkdown.mjs');
  const { restoreMarkdown } = await import('../src/prompts.mjs');
  const code = '``printf(`sample`, "β")``';
  const image = '![reference](figures/panel(2).png "run 2")';
  const tagged = '<span title="Δ > 0">';
  const source = 'Use [' + code + ' on the ' + image + '](notes/method(2).md), then compare ' + tagged + 'the result</span>.';
  const { text, tokens } = protectStructuredMarkdown(source);
  for (const literal of [code, image, tagged, '](notes/method(2).md)']) assert.ok(tokens.some(([, value]) => value === literal), literal);
  for (const word of ['printf', 'sample', 'figures/', 'run 2', 'notes/', 'Δ']) assert.equal(text.includes(word), false, word);
  const translated = text.replace('Use ', '使用').replace(' on the ', '，见').replace('then compare', '再比较').replace('the result', '结果');
  const rendered = restoreMarkdown(translated, tokens);
  assert.ok(rendered.includes('[' + code + '，见' + image + '](notes/method(2).md)'));
  assert.ok(rendered.includes(tagged + '结果</span>'));
  const fence = ['````python', 'print("```")', 'x = "second line"', '````'].join('\n');
  const mixed = protectStructuredMarkdown('The example follows.\n\n' + fence + '\n\nCompare the readings.');
  assert.ok(mixed.tokens.some(([, value]) => value === fence));
  assert.ok(mixed.text.endsWith('Compare the readings.'));
  assert.equal(mixed.text.includes('second line'), false);
});

test('visible web and email addresses stay whole while their surrounding prose can be translated', async () => {
  const { protectStructuredMarkdown } = await import('../src/academicMarkdown.mjs');
  const { restoreMarkdown } = await import('../src/prompts.mjs');
  const urls = ['https://example.org/a/(phase)/calibration#plot', 'www.example.org/archive_(notes)/data', 'authors+study@example.org'];
  const source = `See (${urls[0]}), then ${urls[1]}. Contact ${urls[2]}.`;
  const { text, tokens } = protectStructuredMarkdown(source);
  assert.equal(text, 'See (__PAPERBRIDGE_TOKEN_0__), then __PAPERBRIDGE_TOKEN_1__. Contact __PAPERBRIDGE_TOKEN_2__.');
  const { parseMarkdown } = await import('../src/markdownRendering.mjs');
  const translated = '参见__PAPERBRIDGE_TOKEN_0__。其次是__PAPERBRIDGE_TOKEN_1__，联系__PAPERBRIDGE_TOKEN_2__。';
  const links = value => parseMarkdown(value).children[0].children.filter(node => node.type === 'link')
    .map(node => [node.url, node.children.map(child => child.value).join('')]);
  assert.deepEqual(links(restoreMarkdown(translated, tokens)), links(source));
  for (const address of ['https://example.org/a>file', 'www.example.org/a_(b)?x=1&amp;y=2', 'www.example.org/path*a*c', 'a+b@example.org']) {
    const original = 'See ' + address + ' for data.';
    const item = protectStructuredMarkdown(original);
    assert.deepEqual(links(restoreMarkdown('见' + item.tokens[0][0] + '。', item.tokens)), links(original));
  }
  const plain = protectStructuredMarkdown(source, { boundLinks: false });
  assert.equal(restoreMarkdown(plain.text, plain.tokens), source);
  const visibleAddress = '[www.example.org/readings_(v2)](https://example.org/redirect?n=1)';
  const explicit = protectStructuredMarkdown('See ' + visibleAddress + ' for measurements.');
  assert.deepEqual(explicit.tokens.map(([, value]) => value), [visibleAddress]);
  const angle = '<https://example.org/measurements_(v2)>';
  assert.deepEqual(protectStructuredMarkdown('See ' + angle + '!').tokens.map(([, value]) => value), [angle]);
});

test('structured translation keeps clickable link destinations when the model localizes punctuation', async () => {
  const { protectStructuredMarkdown } = await import('../src/academicMarkdown.mjs');
  const { restoreMarkdown } = await import('../src/prompts.mjs');
  const { parseMarkdown } = await import('../src/markdownRendering.mjs');
  const source = '(see [documentation](https://mscaudill.github.io/tabbed/)) and [**notes**](docs/a_(2).md "Notes").';
  const { text, tokens } = protectStructuredMarkdown(source);
  const localized = text.replace('documentation', '文档').replace('notes', '说明')
    .replaceAll('(', '（').replaceAll(')', '）');
  const result = restoreMarkdown(localized, tokens);
  const links = parseMarkdown(result).children[0].children.filter(node => node.type === 'link');
  assert.deepEqual(links.map(({ url, title }) => [url, title]), [
    ['https://mscaudill.github.io/tabbed/', null], ['docs/a_(2).md', 'Notes']
  ]);
  assert.ok(result.startsWith('（see [文档](https://mscaudill.github.io/tabbed/)）'));
  assert.ok(result.endsWith('[**说明**](docs/a_(2).md "Notes").'));

  const rich = '[](#empty) [![figure](fig.png)](fig.pdf) and `[literal](text)`';
  const protectedRich = protectStructuredMarkdown(rich);
  assert.equal(restoreMarkdown(protectedRich.text, protectedRich.tokens), rich);
  assert.throws(() => restoreMarkdown(text.replace(tokens[1][0], ''), tokens));
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

test('restoration preserves dollar syntax and literal marker names verbatim across Markdown outputs', async () => {
  const { protectMarkdown, restoreMarkdown } = await import('../src/prompts.mjs');
  const { restoreConnectedExcerpt, planConnectedBatches } = await import('../src/connectedTranslation.mjs');
  const original = [
    'Display math $$x + y = 2$$ and literals __PAPERBRIDGE_TOKEN_0__ and __PAPERBRIDGE_TOKEN_19__.',
    '~~~text', "$& $$ $` $' __PAPERBRIDGE_TOKEN_1__", '~~~',
    '![Plot](plots/plot-$&.png)'
  ].join('\n');
  const { text, tokens } = protectMarkdown(original);
  assert.equal(restoreMarkdown(text, tokens), original);
  assert.equal(restoreConnectedExcerpt(text, tokens), original);
  const long = 'Before '.repeat(900) + original;
  assert.ok(planConnectedBatches([{ id: 1, text: long }]).map(batch => batch.source).join(' ').includes(original));
});

test('both paragraph and connected translations reject altered marker sequences', async () => {
  const { protectMarkdown, restoreMarkdown } = await import('../src/prompts.mjs');
  const { restoreConnectedExcerpt } = await import('../src/connectedTranslation.mjs');
  const { tokens } = protectMarkdown('First $a$ and then $b$.');
  const [[first], [second]] = tokens;
  for (const invalid of [first, first + first + second, second + first, first + second + '__PAPERBRIDGE_TOKEN_92__']) {
    assert.throws(() => restoreMarkdown(invalid, tokens), /Retry this block/);
    assert.throws(() => restoreConnectedExcerpt(invalid, tokens), /Retry this batch/);
  }
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
    assert.match(prompt, /complete translation unit|as a complete item|complete academic (?:Markdown )?item/);
    assert.match(prompt, /(?:Do not|never) ask for more context/i);
  }
});
