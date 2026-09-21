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
