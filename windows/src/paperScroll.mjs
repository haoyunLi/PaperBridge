export function paperModeViewport(position, source, mode) {
  const viewports = position?.paperViewports;
  if (viewports && Object.keys(viewports).length) return viewports[source + ':' + mode] || { scrollTop: 0, anchor: null };
  return { scrollTop: position?.scrollByTab?.Paper || 0, anchor: position?.paperAnchor || null };
}

export function storePaperViewport(position, source, mode, scrollTop, anchor) {
  return { ...position, paperAnchor: anchor, scrollByTab: { ...position?.scrollByTab, Paper: scrollTop },
    paperViewports: { ...position?.paperViewports, [source + ':' + mode]: { scrollTop, anchor } } };
}

const passageSelector = '[data-paper-block-id] [data-paper-kind]';

function visibleTableCell(passage, viewport) {
  const tables = passage.querySelectorAll('table');
  for (const [index, table] of tables.entries()) {
    const bounds = table.getBoundingClientRect();
    if (bounds.top > viewport.top + 1 || bounds.bottom <= viewport.top + 1) continue;
    const left = Math.max(bounds.left, viewport.left), right = Math.min(bounds.right, viewport.right);
    for (const row of table.rows) {
      const rowBounds = row.getBoundingClientRect();
      if (rowBounds.bottom <= viewport.top + 1 || rowBounds.top >= viewport.bottom) continue;
      for (const cell of row.cells) {
        const box = cell.getBoundingClientRect();
        if (box.width <= 0 || box.right <= left + 1 || box.left >= right) continue;
        return { index, row: row.rowIndex, column: cell.cellIndex, text: cell.textContent,
          top: box.top - viewport.top, left: box.left - bounds.left, scrolled: table.scrollLeft !== 0 };
      }
    }
  }
  return null;
}

export function capturePaperAnchor(host) {
  const article = host?.querySelector('[data-view-scope="paperArticle"]');
  if (!article || host.scrollTop <= 0) return null;
  const viewport = host.getBoundingClientRect();
  for (const passage of article.querySelectorAll(passageSelector)) {
    const bounds = passage.getBoundingClientRect();
    if (bounds.bottom <= viewport.top + 1) continue;
    if (bounds.top >= viewport.bottom || !passage.textContent) return null;
    const cell = visibleTableCell(passage, viewport);
    return { ...(cell && { cell }), blockId: passage.closest('[data-paper-block-id]').dataset.paperBlockId,
      side: passage.dataset.paperKind, text: passage.textContent, offset: bounds.top - viewport.top,
      source: article.dataset.sourceMode, display: article.dataset.displayMode, scrollTop: host.scrollTop };
  }
  return null;
}

export function restorePaperAnchor(host, anchor, saved) {
  if (!host || !anchor || !Number.isFinite(anchor.offset) || anchor.scrollTop !== saved) return false;
  const article = host.querySelector('[data-view-scope="paperArticle"]');
  if (!article || article.dataset.sourceMode !== anchor.source || article.dataset.displayMode !== anchor.display) return false;
  const sameSide = [...article.querySelectorAll(passageSelector)].filter(node => node.dataset.paperKind === anchor.side);
  let passage = sameSide.find(node => node.closest('[data-paper-block-id]').dataset.paperBlockId === anchor.blockId);
  if (!passage || passage.textContent !== anchor.text) {
    const matching = sameSide.filter(node => node.textContent === anchor.text);
    passage = matching.length === 1 ? matching[0] : null;
  }
  if (!passage) return false;
  let target = passage, savedOffset = anchor.offset;
  const cell = anchor.cell;
  if (cell && [cell.index, cell.row, cell.column].every(value => Number.isSafeInteger(value) && value >= 0) &&
      Number.isFinite(cell.top) && Number.isFinite(cell.left)) {
    const table = passage.querySelectorAll('table')[cell.index];
    const node = table?.rows[cell.row]?.cells[cell.column];
    if (node && node.textContent === cell.text) {
      target = node;
      savedOffset = cell.top;
      if (cell.scrolled) table.scrollLeft += node.getBoundingClientRect().left - table.getBoundingClientRect().left - cell.left;
      else table.scrollLeft = 0;
    }
  }
  const bounds = target.getBoundingClientRect();
  const offset = Math.max(savedOffset, 1 - bounds.height);
  host.scrollTop += bounds.top - host.getBoundingClientRect().top - offset;
  return true;
}
