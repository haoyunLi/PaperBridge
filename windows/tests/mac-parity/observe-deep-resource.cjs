function observeDeepResource(article) {
  const summaries = [...article.querySelectorAll('summary')];
  const outer = summaries.find(item => item.textContent.trim() === 'Detailed measurements');
  const inner = summaries.find(item => item.textContent.trim() === 'Temperature series');
  const panel = outer?.parentElement, nested = inner?.parentElement;
  const inside = Boolean(panel && nested && panel.contains(nested));
  if (outer && !panel.open) outer.click();
  if (inner && !nested.open) inner.click();
  const reading = [...(nested?.querySelectorAll('td') || [])].find(cell => cell.textContent.trim() === '24 °C');
  const observation = { outer: Boolean(outer), inner: Boolean(inner), nested: inside,
    reading: reading?.textContent.trim() || '', explanation: Boolean(panel?.textContent.includes('The calibration applies to both instruments.')) };
  if (inner && nested.open) inner.click();
  if (outer && panel.open) outer.click();
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  observation.outside = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.includes('The final observation agrees with the control.')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    observation.outside ||= Boolean(range.getBoundingClientRect().height && !node.parentElement.closest('details:not([open])'));
  }
  return observation;
}
if (typeof module !== 'undefined') module.exports = { observeDeepResource };
