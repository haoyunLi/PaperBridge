import defaults from './reading-appearance.json' with { type: 'json' };

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

// Earlier Windows workspaces stored proportional lineHeight. Keep that exact
// rendering until the user chooses extra spacing or explicitly resets appearance.
export function normalizeReadingAppearance(settings = {}) {
  const value = settings && typeof settings === 'object' ? settings : {};
  const additive = typeof value.lineSpacing === 'number' && Number.isFinite(value.lineSpacing);
  const legacy = !additive && positive(value.lineHeight);
  const oldBounds = positive(value.fontSize) && (value.fontSize < 13 || value.fontSize > 24) ||
    positive(value.readingWidth) && (value.readingWidth < 640 || value.readingWidth > 1200);
  // Preserve the old slider choices even after moving into the new range or
  // choosing additive spacing. Only an explicit Reset clears this marker.
  const legacyAppearanceRanges = value.legacyAppearanceRanges === true ||
    value.legacyAppearanceRanges !== false && (legacy || oldBounds);
  return {
    fontSize: positive(value.fontSize) ? value.fontSize : defaults.fontSize,
    lineSpacing: legacy ? null : additive ? Math.min(12, Math.max(2, value.lineSpacing)) : defaults.lineSpacing,
    lineHeight: legacy ? value.lineHeight : null,
    readingWidth: positive(value.readingWidth) ? value.readingWidth : defaults.readingWidth,
    legacyAppearanceRanges
  };
}

export function readerLineHeight(settings) {
  const appearance = normalizeReadingAppearance(settings);
  // AppKit adds spacing to its font's natural line metrics. CSS cannot add to
  // `normal`, so use an explicit 1.2em baseline plus the requested pixel gap.
  // This keeps spacing additive without claiming identical platform font metrics.
  return appearance.lineHeight ?? `calc(1.2em + ${appearance.lineSpacing}px)`;
}

export function readingAppearanceControls(settings) {
  const value = normalizeReadingAppearance(settings);
  const legacy = value.lineHeight !== null;
  return [
    { key: 'fontSize', label: 'Reader font size', min: Math.min(13, value.fontSize), max: Math.max(value.legacyAppearanceRanges ? 25 : 24, value.fontSize), step: 1, unit: 'px', value: value.fontSize },
    legacy
      ? { key: 'lineHeight', label: 'Line spacing', min: Math.min(1.3, value.lineHeight), max: Math.max(2.2, value.lineHeight), step: 0.1, unit: '×', value: value.lineHeight }
      : { key: 'lineSpacing', label: 'Line spacing', min: 2, max: 12, step: 1, unit: 'px', value: value.lineSpacing },
    { key: 'readingWidth', label: 'Reading width', min: Math.min(value.legacyAppearanceRanges ? 560 : 640, value.readingWidth), max: Math.max(1200, value.readingWidth), step: 1, unit: 'px', value: value.readingWidth }
  ];
}
