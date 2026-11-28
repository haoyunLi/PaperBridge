const test = require('node:test');
const assert = require('node:assert/strict');

test('link hit areas respect the rendered page orientation, crop and annotation flags', async () => {
  const { pageLinks } = await import('../src/pdfLinks.mjs');
  const rotated = { width: 800, height: 600, convertToViewportPoint: (x, y) => [y - 20, x - 10] };
  const link = { subtype: 'Link', id: 'citation', url: 'https://doi.org/10.21105/joss.01864', rect: [0, 100, 70, 180] };
  const hidden = [1, 2, 32].map(annotationFlags => ({ ...link, annotationFlags }));
  const links = pageLinks([link, ...hidden, { ...link, url: 'file:///sample.dat' }, { ...link, rect: [-40, 5, -10, 7] }], rotated);
  assert.equal(links.length, 1);
  const { left, top, right, bottom } = links[0];
  assert.deepEqual({ left, top, right, bottom }, { left: .1, top: 0, right: .2, bottom: .1 });
});

test('source comments preserve author text and ignore popup children, hidden annotations and empty markup', async () => {
  const { pageLinks } = await import('../src/pdfLinks.mjs');
  const viewport = { width: 200, height: 300, convertToViewportPoint: (x, y) => [x, 300 - y] };
  const item = { id: 'a', rect: [12, 120, 70, 200], subtype: 'Text', titleObj: { str: 'Reviewer' }, contentsObj: { str: '  77 K\n  next run.  ' } };
  const variants = [item, { ...item, id: 'popup', subtype: 'Popup' }, { ...item, id: 'hidden', annotationFlags: 32 },
    { ...item, id: 'empty', subtype: 'Highlight', contentsObj: { str: '  ' } },
    { ...item, id: 'underline', subtype: 'Underline', titleObj: null }];
  const controls = pageLinks(variants, viewport);
  assert.deepEqual(controls.map(control => control.id), ['a', 'underline']);
  assert.equal(controls[0].comment.body, item.contentsObj.str);
  assert.equal(controls[0].label, 'PDF note by Reviewer');
  assert.equal(controls[1].label, 'PDF underline');
});

test('a named PDF destination resolves once and preserves its rotation, zoom or fit rectangle', async () => {
  const { pdfLinkDestination } = await import('../src/pdfLinks.mjs');
  const ref = { num: 9, gen: 0 };
  const page = { view: [10, 20, 610, 820], getViewport: () => ({ width: 800, height: 600, convertToViewportPoint: (x,y) => [y-20,x-10] }) };
  const pdf = { numPages: 3, getPageIndex: async value => value === ref ? 1 : -1, getPage: async () => page,
    getDestination: async name => name === 'figure' ? [ref, { name: 'XYZ' }, 34, 86, 1.5] : null };
  let target = await pdfLinkDestination(pdf, 'figure');
  assert.deepEqual([target.page,target.x,target.y,target.scale], [2,66,24,1.5]);
  target = await pdfLinkDestination(pdf, [0,{name:'FitR'},34,86,94,106]);
  assert.deepEqual([target.page,target.x,target.y,target.region], [1,66,24,{width:20,height:60}]);
  target = await pdfLinkDestination(pdf, [2,{name:'Fit'}]);
  assert.deepEqual([target.page,target.x,target.y], [3,0,0]);
  assert.equal(await pdfLinkDestination(pdf, 'unlisted'), null);
  assert.equal(await pdfLinkDestination(pdf, [3, { name: 'Fit' }]), null);
});
