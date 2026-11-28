const clone = value => structuredClone(value);

import { storePaperViewport } from './paperScroll.mjs';

export function normalizeSearchOrigin(value) {
  if (Number.isFinite(value) && value >= 0) return value;
  if (!value || !Number.isFinite(value.scrollTop) || value.scrollTop < 0 ||
      !Number.isInteger(value.block) || value.block < 1 || !Number.isFinite(value.offset)) return null;
  return { scrollTop: value.scrollTop, block: value.block, offset: value.offset };
}

function normalizeReaderViewport(value) {
  const origin = normalizeSearchOrigin(value);
  return origin && typeof origin === 'object' && Number.isFinite(value.width) && value.width > 0
    ? { ...origin, width: value.width } : null;
}

// History retains the filtered viewport. Disk storage retains the place to return
// to when the temporary search is dismissed or the application is reopened.
export function persistedReadingPosition(location, previous = {}) {
  const origin = location.search ? normalizeSearchOrigin(location.searchOrigin) : null;
  // Selection belongs to the paper, never to a saved viewport or search origin.
  const { selectedParagraphID: discardedSelection, ...viewport } = previous || {};
  const position = { ...viewport, block: location.block, page: location.page, tab: location.tab,
    displayMode: location.displayMode, scrollByTab: { ...location.scrollByTab },
    ...(location.tab === 'Paper' && { paperAnchor: location.paperAnchor ?? null }),
    ...(location.tab === 'Full Translation' && { fullTranslationAnchor: location.fullTranslationAnchor ?? null }) };
  if (origin !== null) {
    position.scrollByTab.Reader = typeof origin === 'number' ? origin : origin.scrollTop;
    position.readerSearchOrigin = origin;
    if (location.tab === 'Reader' && typeof origin === 'object') position.block = origin.block;
  } else if (location.tab === 'Reader') {
    delete position.readerSearchOrigin;
    const readerViewport = normalizeReaderViewport(location.readerViewport ?? position.readerViewport);
    if (readerViewport && readerViewport.block === position.block && readerViewport.scrollTop === position.scrollByTab.Reader) {
      position.readerViewport = readerViewport;
    } else delete position.readerViewport;
  }
  if (location.tab === 'Paper' && location.sourceMode && Number.isFinite(position.scrollByTab.Paper)) {
    return storePaperViewport(position, location.sourceMode, location.displayMode, position.scrollByTab.Paper, location.paperAnchor ?? null);
  }
  return position;
}

export function normalizeReadingLocation(value = {}) {
  const search = typeof value.search === 'string' ? value.search : '';
  const searchOrigin = search ? normalizeSearchOrigin(value.searchOrigin) : null;
  const readerViewport = value.tab === 'Reader' && !search ? normalizeReaderViewport(value.readerViewport) : null;
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
    // Keep missing distinct from null so old session records can still migrate
    // from block. The destination paper validates that an explicit ID exists.
    ...(Object.hasOwn(value, 'selectedParagraphID') && { selectedParagraphID:
      Number.isSafeInteger(value.selectedParagraphID) && value.selectedParagraphID > 0 ? value.selectedParagraphID : null }),
    page: Number.isInteger(value.page) && value.page > 0 ? value.page : 1,
    search,
    ...(searchOrigin !== null && { searchOrigin }),
    ...(readerViewport && { readerViewport }),
    ...(value.tab === 'Paper' && value.paperAnchor && { paperAnchor: value.paperAnchor }),
    ...(value.tab === 'Full Translation' && value.fullTranslationAnchor && { fullTranslationAnchor: value.fullTranslationAnchor }),
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

