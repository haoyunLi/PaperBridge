async function selectText(page, selector, text) {
  await page.evaluate(({ selector, text }) => {
    const root = document.querySelector(selector);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`Selection fixture missing ${text}`);
  }, { selector, text });
}

module.exports = { selectText };
