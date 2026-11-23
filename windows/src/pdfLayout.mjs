import { joinPdfText, normalizeExtractedLine } from './text.mjs';

// Some journals draw the ASCII asterisk in code using a raised TeX math
// glyph with no Unicode mapping. Use its font and neighboring code baseline
// to distinguish it from an arbitrary control byte or a mathematical operator.
export async function recoverCodeAsterisks(page, content) {
  const { items, styles } = content;
  const candidates = [];
  for (let i = 0; i < items.length; i++) {
    const glyph = items[i];
    if (glyph.str !== '\u0003') continue;
    const nextIndex = items[i + 1]?.str === ' ' ? i + 2 : i + 1;
    const next = items[nextIndex];
    if (!next?.str || styles[next.fontName]?.fontFamily !== 'monospace') continue;
    const lift = glyph.transform[5] - next.transform[5];
    const gap = next.transform[4] - (glyph.transform[4] + glyph.width);
    if (glyph.height < next.height && lift > 0 && lift <= next.height * 0.6 &&
        gap >= -1 && gap <= next.height) candidates.push({ i, nextIndex, baseline: next.transform[5] });
  }
  if (!candidates.length) return content;
  // PDF.js loads the embedded font name with the drawing operators. Text
  // extraction alone supplies only the generated font ID and generic family.
  try { await page.getOperatorList(); } catch { return content; }
  const corrected = items.slice();
  for (const { i, nextIndex, baseline } of candidates) {
    const id = items[i].fontName;
    if (!page.commonObjs.has(id) || !/^(?:[A-Z]{6}\+)?TeX_CM_Maths_Symbols$/.test(page.commonObjs.get(id)?.name)) continue;
    for (let j = i; j < nextIndex; j++) {
      const item = items[j];
      corrected[j] = { ...item, str: j === i ? '*' : item.str, transform: [...item.transform.slice(0, 5), baseline] };
    }
  }
  return { ...content, items: corrected };
}

function textRows(items, left, bottom, width, styles) {
  const rows = [];
  let previousText;
  for (const [index, item] of items.entries()) {
    if (!item.str?.trim()) continue;
    const x = item.transform[4] - left;
    const y = item.transform[5] - bottom;
    const vertical = Math.abs(item.transform[1]) > Math.abs(item.transform[0]);
    if (vertical && /^arxiv:/i.test(item.str.trim()) && (x < width * 0.08 || x > width * 0.92)) continue;
    const height = item.height || 12;
    // Superscript numbers often have their own baseline and are emitted
    // directly after the name, word or formula they qualify. Keep that row.
    const adjacent = !vertical && previousText && !previousText.vertical && Math.abs(x - previousText.end) <= height * 0.5;
    const raisedNumber = adjacent &&
      /^[\p{Nd}]+(?:\s*[,–-]\s*\p{Nd}+)*$/u.test(item.str.trim()) && /\p{L}/u.test(previousText.text) &&
      height < previousText.height * 0.88 && y > previousText.y + height * 0.18 && y < previousText.y + previousText.height * 0.75;
    // A publisher may draw the numeric affiliation and its contribution symbol in separate fonts.
    const raisedSuffix = raisedNumber || (adjacent && previousText.raisedSuffix &&
      /^[*†‡§¶☯]{1,3}$/u.test(item.str.trim()) && Math.abs(y - previousText.y) <= height * 0.2 &&
      Math.abs(height - previousText.height) <= height * 0.2);
    let row = raisedSuffix ? previousText.row : rows.find(candidate => candidate.vertical === vertical && Math.abs(candidate.y - y) < Math.max(2, height * 0.4));
    if (!row) {
      row = { y, items: [], vertical };
      rows.push(row);
    }
    const previous = items[index - 1];
    const spaceBefore = previous?.str === ' ' && Math.abs(previous.transform[5] - item.transform[5]) < 1;
    const placed = { text: item.str, x, y, end: x + (vertical ? height : item.width), height, spaceBefore,
      monospace: styles?.[item.fontName]?.fontFamily === 'monospace' };
    row.items.push(placed);
    previousText = { ...placed, vertical, row, raisedSuffix };
  }
  return rows.sort((a, b) => b.y - a.y);
}

function lineFromItems(items, y, vertical, pageHeight) {
  const x = items[0].x;
  let end = x;
  let text = '';
  for (const item of items) {
    if (text && (item.spaceBefore || item.x - end > Math.max(2, item.height * 0.25))) text += ' ';
    text += item.text;
    end = Math.max(end, item.end);
  }
  const line = { text: normalizeExtractedLine(text), y, x, width: end - x, height: Math.max(...items.map(item => item.height)), independent: vertical };
  const fixed = items.filter(item => item.monospace);
  if (!vertical && fixed.length && items.every(item => item.monospace || !/[\p{L}\p{N}]/u.test(item.text))) {
    // A few publishers draw punctuation from a separate mathematical font.
    // Estimate a character cell only from glyphs actually set in fixed pitch.
    const cells = fixed.reduce((count, item) => count + Array.from(item.text).length, 0);
    line.codeCellWidth = fixed.reduce((size, item) => size + item.end - item.x, 0) / cells;
    let previousEnd = x;
    line.codeText = items.map(item => {
      const gap = Math.round((item.x - previousEnd) / line.codeCellWidth);
      const spaces = Math.max(Number(item.spaceBefore), Math.min(80, gap));
      previousEnd = item.end;
      return ' '.repeat(spaces) + item.text;
    }).join('').trim();
  }
  const [marker, body] = items;
  if (!vertical && body && y < pageHeight * 0.18 && /^(?:\p{Nd}{1,3}|[*†‡])$/u.test(marker.text.trim()) &&
      /^\s*\p{L}/u.test(body.text) && marker.height < body.height * 0.9 &&
      marker.y - body.y >= body.height * 0.15 && marker.y - body.y <= body.height * 0.8 &&
      Math.abs(body.x - marker.end) <= body.height * 0.6) {
    line.raisedNoteMarker = marker.text.trim();
    line.y = body.y;
  }
  return line;
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

// An editorial rail may sit well to the left of the page midpoint. Require
// distinct publication labels plus a repeatedly aligned wide prose column.
function journalSidebarBoundary(rows, width) {
  const labels = new Set();
  let top = -Infinity, bottom = Infinity;
  for (const { items, vertical, y } of rows) {
    if (vertical) continue;
    for (const item of items) {
      if (item.x > width * 0.15) break;
      const label = /^(doi|citation|editors?|reviewers?|received|submitted|accepted|published|copyright|funding|competing interests|licen[cs]e)\s*(?::|$)/i.exec(item.text.trim());
      if (label) {
        labels.add(label[1].toLowerCase());
        top = Math.max(top, y);
        bottom = Math.min(bottom, y);
      }
    }
  }
  if (labels.size < 3) return null;
  const sharedBand = rows.filter(row => !row.vertical && row.y >= bottom && row.y <= top);
  const mainStarts = new Map();
  for (const { items } of sharedBand) {
    const first = items.findIndex(item => item.x >= width * 0.2);
    if (first < 0 || items[first].x > width * 0.4 || items.at(-1).end - items[first].x < width * 0.42 ||
        !hasProse(items.slice(first).map(item => item.text).join(' '))) continue;
    const x = Math.round(items[first].x);
    mainStarts.set(x, (mainStarts.get(x) || 0) + 1);
  }
  const best = [...mainStarts].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 5) return null;
  // Place the cut in empty space, allowing a few points of body indentation.
  const boundary = best[0] - 4;
  if (sharedBand.some(row => row.items.some(item => item.x < boundary && item.end > boundary))) return null;
  const leftRows = sharedBand.filter(row => row.items[0].end <= boundary);
  const mainRows = sharedBand.filter(row => row.items.some(item => Math.abs(item.x - best[0]) <= 2));
  return leftRows.length >= 5 && mainRows.length >= 5 ? boundary : null;
}

export function pageLines(content, [left, bottom, right, top]) {
  const pageHeight = top - bottom;
  const width = right - left;
  const mid = width / 2;
  const tolerance = width * 0.015;
  const laneFor = line => {
    const end = line.x + line.width;
    if (end <= mid + tolerance && line.x + line.width / 2 < mid) return 'left';
    if (line.x >= mid - tolerance) return 'right';
    return 'spanning';
  };
  const physicalRows = textRows(content.items, left, bottom, width, content.styles);
  for (const row of physicalRows) row.items.sort((a, b) => a.x - b.x);
  const sidebar = journalSidebarBoundary(physicalRows, width);
  if (sidebar !== null) {
    // PLOS draws this white text underneath its first-page logo. Limit removal to
    // the known repeated placeholder in the publisher's editorial margin.
    const hasPlosLogo = physicalRows.some(row => row.items.some(item => /10\.1371\/journal\./i.test(item.text))) &&
      physicalRows.filter(row => row.items.some(item => item.x < sidebar && item.text === 'a1111111111')).length >= 3;
    return physicalRows.flatMap(({ y, items, vertical }) => {
      if (vertical) return [lineFromItems(items, y, true, pageHeight)];
      if (items.some(item => item.x < sidebar && item.end > sidebar)) {
        return splitDistantItems(items, width).map(group => lineFromItems(group, y, false, pageHeight));
      }
      const article = items.filter(item => item.x >= sidebar);
      const margin = items.filter(item => item.x < sidebar && !(hasPlosLogo && item.text === 'a1111111111'));
      const lines = [];
      if (margin.length) lines.push({ ...lineFromItems(margin, y, false, pageHeight), journalMetadata: true });
      if (article.length) lines.push(lineFromItems(article, y, false, pageHeight));
      return lines;
    });
  }
  const rows = physicalRows.map(({ y, items, vertical }) => {
    const split = vertical ? 0 : splitAtGutter(items, mid, tolerance);
    const parts = split ? [items.slice(0, split), items.slice(split)] : [items];
    return { y, items, vertical, parts: parts.map(part => lineFromItems(part, y, vertical, pageHeight)) };
  });
  // Metadata, figure labels and table cells alone are weak evidence of a text column.
  const candidates = rows.flatMap(row => row.parts).filter(line =>
    !line.independent && line.width >= width * 0.22 && hasProse(line.text)
  );
  const leftLines = candidates.filter(line => laneFor(line) === 'left');
  const rightLines = candidates.filter(line => laneFor(line) === 'right');
  if (leftLines.length < 5 || rightLines.length < 5 || overlap(leftLines, rightLines) < 24) {
    return rows.flatMap(({ y, items, vertical }) => splitDistantItems(items, width).map(group => lineFromItems(group, y, vertical, pageHeight)));
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
      const line = lineFromItems(items, y, vertical, pageHeight);
      return [{ ...line, lane: 'spanning' }];
    }
    return parts.map(line => ({ ...line, lane: laneFor(line) }));
  });
}

function publicationFrontMatter(lines) {
  const groups = [];
  let previous;
  for (const line of lines) {
    const gap = previous ? previous.y - line.y : 0;
    const wraps = previous && !line.independent && !previous.independent &&
      Math.abs(line.height - previous.height) < previous.height * 0.08 &&
      Math.abs(line.x - previous.x) <= previous.height * 0.4 && gap > 0 && gap <= previous.height * 1.45;
    if (wraps) {
      const paragraph = groups.at(-1)[0];
      paragraph.text = joinPdfText(paragraph.text, line.text);
    } else groups.push([{ ...line }]);
    previous = line;
  }
  return groups;
}

export function pdfReadingGroups(lines) {
  if (lines.some(line => line.journalMetadata)) {
    const metadata = lines.filter(line => line.journalMetadata).map(line => /^\s*•/u.test(line.text) ? { ...line, independent: true } : line);
    const article = lines.filter(line => !line.journalMetadata);
    const section = article.findIndex(line => /^(?:\d+\.?\s+)?(?:abstract|summary|overview|introduction)\s*$/i.test(line.text));
    return section >= 0 ? [...publicationFrontMatter(article.slice(0, section)), metadata, article.slice(section)] : [article, metadata];
  }
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
  let previous;
  for (const line of lines) {
    // A wide blank band across both columns separates the text regions above
    // and below it (for example, a caption and an isolated page-bottom note).
    if (previous && previous.y - line.y > 6 * Math.max(10, previous.height, line.height)) flushColumns();
    previous = line;
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
