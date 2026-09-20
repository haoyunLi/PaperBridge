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
