function textRows(items, left, bottom, width) {
  const rows = [];
  for (const [index, item] of items.entries()) {
    if (!item.str?.trim()) continue;
    const x = item.transform[4] - left;
    const y = item.transform[5] - bottom;
    const vertical = Math.abs(item.transform[1]) > Math.abs(item.transform[0]);
    if (vertical && /^arxiv:/i.test(item.str.trim()) && (x < width * 0.08 || x > width * 0.92)) continue;
    const height = item.height || 12;
    let row = rows.find(candidate => candidate.vertical === vertical && Math.abs(candidate.y - y) < Math.max(2, height * 0.4));
    if (!row) {
      row = { y, items: [], vertical };
      rows.push(row);
    }
    const previous = items[index - 1];
    const spaceBefore = previous?.str === ' ' && Math.abs(previous.transform[5] - item.transform[5]) < 1;
    row.items.push({ text: item.str, x, end: x + (vertical ? height : item.width), height, spaceBefore });
  }
  return rows.sort((a, b) => b.y - a.y);
}

function lineFromItems(items, y, vertical) {
  const x = items[0].x;
  let end = x;
  let text = '';
  for (const item of items) {
    if (text && (item.spaceBefore || item.x - end > Math.max(2, item.height * 0.25))) text += ' ';
    text += item.text;
    end = Math.max(end, item.end);
  }
  return { text, y, x, width: end - x, height: Math.max(...items.map(item => item.height)), independent: vertical };
}

function splitAtGutter(items, mid, tolerance) {
  let end = items[0].end;
  for (let i = 1; i < items.length; i++) {
    const { x } = items[i];
    // A typical journal gutter is narrower than the gap used to separate distant labels.
    if (end <= mid + tolerance && x >= mid - tolerance && x - end >= 8) return i;
    end = Math.max(end, items[i].end);
  }
  return 0;
}

function splitDistantItems(items, width) {
  const groups = [];
  let start = 0;
  let end = items[0].end;
  for (let i = 1; i < items.length; i++) {
    const { x } = items[i];
    if (x - end > width * 0.09 && x > width * 0.45) {
      groups.push(items.slice(start, i));
      start = i;
    }
    end = Math.max(end, items[i].end);
  }
  groups.push(items.slice(start));
  return groups;
}

function overlap(a, b) {
  return Math.min(a[0].y, b[0].y) - Math.max(a.at(-1).y, b.at(-1).y);
}

function hasProse(text) {
  return (text.match(/\p{L}{3,}/gu)?.length || 0) >= 5 ||
    (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length || 0) >= 15;
}

export function pageLines(content, [left, bottom, right]) {
  const width = right - left;
  const mid = width / 2;
  const tolerance = width * 0.015;
  const laneFor = line => {
    const end = line.x + line.width;
    if (end <= mid + tolerance && line.x + line.width / 2 < mid) return 'left';
    if (line.x >= mid - tolerance) return 'right';
    return 'spanning';
  };
  const rows = textRows(content.items, left, bottom, width).map(({ y, items, vertical }) => {
    items.sort((a, b) => a.x - b.x);
    const split = vertical ? 0 : splitAtGutter(items, mid, tolerance);
    const parts = split ? [items.slice(0, split), items.slice(split)] : [items];
    return { y, items, vertical, parts: parts.map(part => lineFromItems(part, y, vertical)) };
  });
  // Metadata, figure labels and table cells alone are weak evidence of a text column.
  const candidates = rows.flatMap(row => row.parts).filter(line =>
    !line.independent && line.width >= width * 0.22 && hasProse(line.text)
  );
  const leftLines = candidates.filter(line => laneFor(line) === 'left');
  const rightLines = candidates.filter(line => laneFor(line) === 'right');
  if (leftLines.length < 5 || rightLines.length < 5 || overlap(leftLines, rightLines) < 24) {
    return rows.flatMap(({ y, items, vertical }) => splitDistantItems(items, width).map(group => lineFromItems(group, y, vertical)));
  }

  const leftMargin = Math.min(...leftLines.map(line => line.x));
  const rightMargin = Math.min(...rightLines.map(line => line.x));
  const indentAllowance = width * 0.035;
  const heights = candidates.map(line => line.height).sort((a, b) => a - b);
  const smallText = heights[Math.floor(heights.length / 2)] * 0.85;
  return rows.flatMap(({ y, items, vertical, parts }) => {
    // Centered metadata and inset tables can have an internal gap at the same x position.
    const [first, second] = parts;
    if (second && first.x > leftMargin + indentAllowance &&
      (second.x > rightMargin + indentAllowance || Math.max(first.height, second.height) < smallText)) {
      const line = lineFromItems(items, y, vertical);
      return [{ ...line, lane: 'spanning' }];
    }
    return parts.map(line => ({ ...line, lane: laneFor(line) }));
  });
}

export function pdfReadingGroups(lines) {
  if (!lines.some(line => line.lane)) return [lines];
  const groups = [];
  let left = [];
  let right = [];
  let spanning = [];
  function flushColumns() {
    if (left.length) groups.push(left);
    if (right.length) groups.push(right);
    left = [];
    right = [];
  }
  for (const line of lines) {
    if (line.lane === 'spanning') {
      flushColumns();
      spanning.push(line);
    } else {
      if (spanning.length) groups.push(spanning);
      spanning = [];
      (line.lane === 'left' ? left : right).push(line);
    }
  }
  flushColumns();
  if (spanning.length) groups.push(spanning);
  return groups;
}
