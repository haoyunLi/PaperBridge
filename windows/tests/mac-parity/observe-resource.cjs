async function observeResource(article) {
  const disclosure = article.querySelector('details');
  const toggle = disclosure.querySelector('summary');
  if (!disclosure.open) toggle.click();
  const figure = disclosure.querySelector('figure');
  const table = disclosure.querySelector('table');
  const picture = disclosure.querySelector('img');
  await picture.decode();
  const result = {
    expanded: disclosure.open, summary: toggle.textContent,
    tableCaption: table.caption?.textContent ?? null,
    columns: table.querySelectorAll('colgroup > col').length,
    headerSpans: [table.tHead.rows[0].cells[0].rowSpan, table.tHead.rows[0].cells[1].colSpan],
    readings: [...table.tBodies[0].rows[0].cells].map(node => node.textContent),
    figureCaption: figure?.querySelector('figcaption')?.textContent ?? null,
    subscript: figure?.querySelector('figcaption sub')?.textContent ?? null,
    image: [picture.alt, picture.naturalWidth, picture.naturalHeight],
    sameFigure: Boolean(figure && figure.contains(table) && figure.contains(picture))
  };
  toggle.click();
  result.collapsed = !disclosure.open;
  return result;
}
if (typeof module !== 'undefined') module.exports = { observeResource };
