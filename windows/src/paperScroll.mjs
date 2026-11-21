const passageSelector = '[data-paper-block-id] [data-paper-kind]';

export function capturePaperAnchor(host) {
  const article = host?.querySelector('[data-view-scope="paperArticle"]');
  if (!article || host.scrollTop <= 0) return null;
  const viewport = host.getBoundingClientRect();
  for (const passage of article.querySelectorAll(passageSelector)) {
    const bounds = passage.getBoundingClientRect();
    if (bounds.bottom <= viewport.top + 1) continue;
    if (bounds.top >= viewport.bottom || !passage.textContent) return null;
    return { blockId: passage.closest('[data-paper-block-id]').dataset.paperBlockId,
      side: passage.dataset.paperKind, text: passage.textContent, offset: bounds.top - viewport.top,
      source: article.dataset.sourceMode, display: article.dataset.displayMode, scrollTop: host.scrollTop };
  }
  return null;
}

export function restorePaperAnchor(host, anchor, saved) {
  if (!host || !anchor || !Number.isFinite(anchor.offset) || anchor.scrollTop !== saved) return false;
  const article = host.querySelector('[data-view-scope="paperArticle"]');
  if (!article || article.dataset.sourceMode !== anchor.source || article.dataset.displayMode !== anchor.display) return false;
  const matching = [...article.querySelectorAll(passageSelector)].filter(passage =>
    passage.dataset.paperKind === anchor.side && passage.textContent === anchor.text);
  const passage = matching.find(node => node.closest('[data-paper-block-id]').dataset.paperBlockId === anchor.blockId)
    || (matching.length === 1 ? matching[0] : null);
  if (!passage) return false;
  const bounds = passage.getBoundingClientRect();
  const offset = Math.max(anchor.offset, 1 - bounds.height);
  host.scrollTop += bounds.top - host.getBoundingClientRect().top - offset;
  return true;
}
