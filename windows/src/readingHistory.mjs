const clone = value => structuredClone(value);

export function normalizeSearchOrigin(value) {
  if (Number.isFinite(value) && value >= 0) return value;
  if (!value || !Number.isFinite(value.scrollTop) || value.scrollTop < 0 ||
      !Number.isInteger(value.block) || value.block < 1 || !Number.isFinite(value.offset)) return null;
  return { scrollTop: value.scrollTop, block: value.block, offset: value.offset };
}

// History retains the filtered viewport. Disk storage retains the place to return
// to when the temporary search is dismissed or the application is reopened.
export function persistedReadingPosition(location, previous = {}) {
  const origin = location.search ? normalizeSearchOrigin(location.searchOrigin) : null;
  const position = { ...previous, block: location.block, page: location.page, tab: location.tab,
    displayMode: location.displayMode, scrollByTab: { ...location.scrollByTab } };
  if (origin !== null) {
    position.scrollByTab.Reader = typeof origin === 'number' ? origin : origin.scrollTop;
    position.readerSearchOrigin = origin;
    if (location.tab === 'Reader' && typeof origin === 'object') position.block = origin.block;
  } else if (location.tab === 'Reader') delete position.readerSearchOrigin;
  return position;
}

export function normalizeReadingLocation(value = {}) {
  const search = typeof value.search === 'string' ? value.search : '';
  const searchOrigin = search ? normalizeSearchOrigin(value.searchOrigin) : null;
  const scrollByTab = Object.fromEntries(Object.entries(value.scrollByTab || {})
    .filter(([, offset]) => Number.isFinite(Number(offset)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, offset]) => [key, Number(offset)]));
  return {
    paperId: typeof value.paperId === 'string' ? value.paperId : '',
    ...(['pdf', 'mineru', 'text'].includes(value.sourceMode) && { sourceMode: value.sourceMode }),
    tab: typeof value.tab === 'string' ? value.tab : 'Paper',
    displayMode: ['source', 'translation', 'bilingual'].includes(value.displayMode) ? value.displayMode : 'bilingual',
    block: Number.isInteger(value.block) && value.block > 0 ? value.block : 1,
    page: Number.isInteger(value.page) && value.page > 0 ? value.page : 1,
    search,
    ...(searchOrigin !== null && { searchOrigin }),
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
    goBack(current, canRestore = () => true) {
      const destination = clone(back.at(-1));
      if (!destination || !canRestore(destination)) return null;
      back.pop();
      forward = append(forward, current);
      return destination;
    },
    goForward(current, canRestore = () => true) {
      const destination = clone(forward.at(-1));
      if (!destination || !canRestore(destination)) return null;
      forward.pop();
      back = append(back, current);
      return destination;
    },
    reset() { back = []; forward = []; },
    canGoBack() { return back.length > 0; },
    canGoForward() { return forward.length > 0; },
    snapshot() { return { back: clone(back), forward: clone(forward) }; }
  };
}

