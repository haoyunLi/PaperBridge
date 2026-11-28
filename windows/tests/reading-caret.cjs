async function clickTextOffset(page, target, offset) {
  await target.scrollIntoViewIfNeeded();
  const position = await target.evaluate((element, at) => {
    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && at >= node.length) {
      at -= node.length;
      node = walker.nextNode();
    }
    if (!node) throw new Error('Expected a caret offset inside the reading passage.');
    range.setStart(node, at);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 0.5, y: rect.top + rect.height / 2 };
  }, offset);
  await page.mouse.click(position.x, position.y);
}

module.exports = { clickTextOffset };
