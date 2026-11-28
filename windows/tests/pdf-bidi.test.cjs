const test = require('node:test');
const assert = require('node:assert/strict');

test('ambiguous, untagged and independent PDF runs retain their geometric order', async () => {
  const { logicalTaggedLine, unfoldArabicForms } = await import('../src/pdfBidi.mjs');
  const run = (text, direction, rank, paragraph = 'label') => ({ text, direction, pdfTag: { paragraph, rank } });
  const rtl = run('מדידה', 'rtl', 0);
  assert.equal(logicalTaggedLine([rtl, { text: '532 nm' }]), null);
  assert.equal(logicalTaggedLine([rtl, run('nm', 'ltr', 1, 'separate table cell')]), null);
  assert.equal(logicalTaggedLine([rtl, run('10', 'ltr', 0)]), null);
  assert.equal(logicalTaggedLine([rtl, run('nm', 'ltr', 2), run('12', 'ltr', 1)]), null);
  assert.equal(unfoldArabicForms('µV ㎚ ∑ ﺑﻘﻴﺖ'), 'µV ㎚ ∑ بقيت');
});

test('damaged tags or text split differently by PDF.js do not change saved text', async () => {
  const { taggedPdfText } = await import('../src/pdfBidi.mjs');
  const item = { str: 'מדידה', dir: 'rtl', transform: [1, 0, 0, 1, 10, 20] };
  const content = { items: [item] };
  const tree = { role: 'P', children: [{ type: 'content', id: 'word' }] };
  const page = { getStructTree: async () => tree, getTextContent: async () => ({ items: [
    { type: 'beginMarkedContentProps', id: 'word' }, { ...item, transform: [1, 0, 0, 1, 9, 20] }, { type: 'endMarkedContent' }
  ] }) };
  assert.equal(await taggedPdfText(page, content), content);
  assert.equal(await taggedPdfText({ getStructTree: async () => { throw Error('Incomplete object'); } }, content), content);
});
