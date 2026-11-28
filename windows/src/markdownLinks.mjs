// Match the IDs assigned by the macOS Markdown preview, including duplicate headings.
export function headingWithFragment(headings, fragment) {
  const used = new Set();
  for (const heading of headings) {
    const words = heading.textContent.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '');
    const base = words.trim().replace(/\s+/gu, '-') || 'section';
    let id = base;
    for (let suffix = 1; used.has(id); suffix++) id = `${base}-${suffix}`;
    if (id === fragment) return heading;
    used.add(id);
  }
  return null;
}

export function revealMarkdownTarget(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  for (let details = element?.closest('details:not([open])'); details; details = details.parentElement?.closest('details:not([open])')) {
    if (!details.querySelector(':scope > summary')?.contains(element)) details.open = true;
  }
}

export function documentLinkTarget(link, hash) {
  const scope = link.closest('[data-view-scope], [data-reading-list]') || link.closest('[data-markdown-host]');
  if (!scope) return null;
  let fragment;
  try { fragment = decodeURIComponent(hash.slice(1)).normalize('NFC'); } catch { return null; }
  if (!fragment) return scope;
  const side = node => node.closest('[data-paper-kind]')?.dataset.paperKind || node.closest('[data-block-id][data-kind]')?.dataset.kind;
  const headings = [...scope.querySelectorAll('[data-markdown-host] :is(h1,h2,h3,h4,h5,h6)')];
  const named = [...scope.querySelectorAll('[data-markdown-host] [id], [data-markdown-host] a[name]')];
  const kind = side(link);
  const sides = kind ? [kind, kind === 'source' ? 'translation' : 'source'] : [undefined];
  for (const current of sides) {
    const withinSide = node => !current || side(node) === current;
    const explicit = named.find(node => withinSide(node) && [node.id, node.getAttribute('name')].some(value =>
      value === fragment || value === 'user-content-' + fragment));
    const target = explicit || headingWithFragment(headings.filter(withinSide), fragment);
    if (target) return target;
  }
  return null;
}
