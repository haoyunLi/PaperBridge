const clone = value => structuredClone(value);

export function normalizeReadingLocation(value = {}) {
  const scrollByTab = Object.fromEntries(Object.entries(value.scrollByTab || {})
    .filter(([, offset]) => Number.isFinite(Number(offset)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, offset]) => [key, Number(offset)]));
  return {
    paperId: typeof value.paperId === 'string' ? value.paperId : '',
    tab: typeof value.tab === 'string' ? value.tab : 'Paper',
    displayMode: ['source', 'translation', 'bilingual'].includes(value.displayMode) ? value.displayMode : 'bilingual',
    block: Number.isInteger(value.block) && value.block > 0 ? value.block : 1,
    page: Number.isInteger(value.page) && value.page > 0 ? value.page : 1,
    search: typeof value.search === 'string' ? value.search : '',
    scrollByTab
  };
}

export function sameReadingLocation(left, right) {
  return JSON.stringify(normalizeReadingLocation(left)) === JSON.stringify(normalizeReadingLocation(right));
}

export function createReadingHistory(limit = 50) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Reading history limit must be a positive integer.');
  let back = [];
  let forward = [];
  const append = (items, location) => {
    const normalized = normalizeReadingLocation(location);
    if (!normalized.paperId || items.length && sameReadingLocation(items.at(-1), normalized)) return items;
    return [...items, normalized].slice(-limit);
  };
  return {
    record(location) {
      const before = back.length;
      back = append(back, location);
      forward = [];
      return back.length !== before;
    },
    goBack(current) {
      const destination = back.pop();
      if (!destination) return null;
      forward = append(forward, current);
      return clone(destination);
    },
    goForward(current) {
      const destination = forward.pop();
      if (!destination) return null;
      back = append(back, current);
      return clone(destination);
    },
    reset() { back = []; forward = []; },
    canGoBack() { return back.length > 0; },
    canGoForward() { return forward.length > 0; },
    snapshot() { return { back: clone(back), forward: clone(forward) }; }
  };
}

