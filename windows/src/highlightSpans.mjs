// AppKit applies each saved annotation's background color to its exact range in
// storage order. Keep uncovered portions of earlier marks when ranges overlap.
export function visibleHighlightSpans(spans) {
  const events = [];
  for (const [order, { start, end }] of spans.entries()) {
    if (end <= start) continue;
    events.push({ at: start, order, begin: true }, { at: end, order, begin: false });
  }
  events.sort((a, b) => a.at - b.at);
  const visible = [];
  const active = new Set();
  let winner = -1;
  let previous = 0;
  for (let i = 0; i < events.length;) {
    const at = events[i].at;
    if (winner >= 0 && at > previous) {
      const color = spans[winner].color;
      const last = visible.at(-1);
      if (last?.end === previous && last.color === color) last.end = at;
      else visible.push({ start: previous, end: at, color });
    }
    while (i < events.length && events[i].at === at) {
      const { order, begin } = events[i++];
      if (begin) {
        active.add(order);
        winner = Math.max(winner, order);
      } else active.delete(order);
    }
    if (!active.has(winner)) {
      winner = -1;
      for (const order of active) winner = Math.max(winner, order);
    }
    previous = at;
  }
  return visible;
}

// Recolor in place so newer overlapping annotations retain their precedence.
export function replaceHighlight(items, matching, revised) {
  if (!matching.length) return [...items, revised];
  const duplicates = new Set(matching.slice(1));
  return items.filter(item => !duplicates.has(item)).map(item => item === matching[0] ? revised : item);
}
