import { joinPdfText, normalizeExtractedLine } from './text.mjs';
import { logicalTaggedLine, unfoldArabicForms } from './pdfBidi.mjs';

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

// Computer Modern's math-extension font places its inline summation above the
// text baseline. Some PDFs expose its encoded "P" without any Unicode mapping.
export async function recoverInlineSummations(page, content) {
  const { items } = content;
  const candidates = [];
  let previous;
  for (let i = 0; i < items.length; i++) {
    const glyph = items[i];
    if (!glyph.str?.trim()) continue;
    if (glyph.str === 'P' && previous?.str.trimEnd().endsWith('=') && glyph.height > 0) {
      const baseline = previous.transform[5], left = glyph.transform[4], height = glyph.height;
      const gap = left - (previous.transform[4] + previous.width);
      if (gap >= -height * 0.15 && gap <= height && glyph.transform[5] > baseline + height * 0.3 &&
          glyph.transform[5] < baseline + height) candidates.push({ i, baseline });
    }
    previous = glyph;
  }
  if (!candidates.length) return content;
  try { await page.getOperatorList(); } catch { return content; }
  const corrected = items.slice();
  for (const { i, baseline } of candidates) {
    const glyph = items[i], height = glyph.height, x = glyph.transform[4] + glyph.width;
    if (!page.commonObjs.has(glyph.fontName) || !/^(?:[A-Z]{6}\+)?CMEX(?:7|8|9|10)$/u.test(page.commonObjs.get(glyph.fontName)?.name)) continue;
    const upper = [], lower = [];
    let j = i + 1;
    for (; j < items.length; j++) {
      const item = items[j];
      if (!item.str?.trim()) continue;
      const dx = item.transform[4] - x, dy = item.transform[5] - baseline;
      if (dx < -0.2 * height || dx > 3 * height || Math.abs(dy) > height || Math.abs(dy) < 0.12 * height ||
          item.height > 0.8 * height || !/^[\p{L}\p{N}=+−-]+$/u.test(item.str)) break;
      const limit = dy > 0 ? upper : lower;
      if (!limit.length && Math.abs(dx) > height * 0.3) break;
      if (limit.length && item.transform[4] < limit.at(-1).transform[4]) break;
      limit.push(item);
    }
    if (!upper.length || !lower.length || !items[j] || Math.abs(items[j].transform[5] - baseline) > height * 0.15) continue;
    const limitText = parts => {
      let value = '', subscript = '';
      for (const item of parts) {
        if (item.height < parts[0].height * 0.9 && item.transform[5] < parts[0].transform[5] - height * 0.12) {
          subscript += item.str;
        } else {
          if (subscript) value += '_{' + subscript + '}';
          subscript = '';
          value += item.str;
        }
      }
      return value + (subscript ? '_{' + subscript + '}' : '');
    };
    const right = Math.max(...[...lower, ...upper].map(item => item.transform[4] + item.width));
    const followingGap = items[j].transform[4] - right;
    if (followingGap < -height * 0.25 || followingGap > height) continue;
    corrected[i] = { ...glyph, str: '∑_{' + limitText(lower) + '}^{' + limitText(upper) + '}',
      transform: [...glyph.transform.slice(0, 5), baseline], width: right - glyph.transform[4] };
    for (let k = i + 1; k < j; k++) if (items[k].str?.trim()) corrected[k] = { ...items[k], str: '' };
    // Preserve subscripts on an adjacent product of mathematical variables.
    // Ordinary printed letters can share the same horizontal geometry.
    for (let k = j; k + 1 < items.length; k += 2) {
      const variable = items[k], script = items[k + 1], next = items[k + 2];
      if (!/^\p{L}$/u.test(variable.str) || !/^[\p{L}\p{N}]+$/u.test(script.str) ||
          !page.commonObjs.has(variable.fontName) || !page.commonObjs.has(script.fontName) ||
          !/^(?:[A-Z]{6}\+)?CMMI\d+$/u.test(page.commonObjs.get(variable.fontName)?.name) ||
          !/^(?:[A-Z]{6}\+)?CM(?:MI|R)\d+$/u.test(page.commonObjs.get(script.fontName)?.name)) break;
      if (Math.abs(variable.transform[5] - baseline) > height * 0.15 || script.height >= variable.height * 0.85 ||
          Math.abs(script.transform[4] - variable.transform[4] - variable.width) > height * 0.25 ||
          script.transform[5] > baseline - height * 0.06 || script.transform[5] < baseline - height * 0.5) break;
      if (next?.str?.trim() && Math.abs(next.transform[5] - script.transform[5]) < height * 0.05) break;
      corrected[k] = { ...variable, str: ' ' + variable.str + '_{' + script.str + '}',
        width: script.transform[4] + script.width - variable.transform[4] };
      corrected[k + 1] = { ...script, str: '' };
    }
  }
  return { ...content, items: corrected };
}

// TeX exports these attached scripts as separate runs. Use the embedded math
// fonts and the printed offsets so they stay next to their base, even when
// a neighboring column has a text baseline at the height of the superscript.
export async function recoverMathScripts(page, content) {
  const { items } = content;
  const candidates = [];
  let previous = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = item.str?.trim();
    if (!text) continue;
    const script = items[i + 1];
    if (script?.height > 0) {
      if (text === 'R' && previous.endsWith('∈')) candidates.push({ i, kind: 'dimension' });
      else if (/(?:^|[^\p{L}\p{N}])[A-Z][A-Z0-9]{1,15}$/u.test(item.str) && /^[A-Z]{2,12}$/u.test(script.str) &&
          item.fontName === script.fontName && item.transform[1] === 0 && item.transform[2] === 0 &&
          script.transform[1] === 0 && script.transform[2] === 0) candidates.push({ i, kind: 'name' });
      else if (/^[a-z]$/u.test(text) && script.str === 'th') candidates.push({ i, kind: 'ordinal' });
      else if (/^[A-Z]$/u.test(text) && /^[a-z]$/u.test(script.str) &&
          (items[i + 2]?.str?.trim() || items[i + 3]?.str?.trim()) === '∈') candidates.push({ i, kind: 'indexedVector' });
    }
    previous = text;
  }
  if (!candidates.length) return content;
  try { await page.getOperatorList(); } catch { return content; }
  const corrected = items.slice();
  const font = item => page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName)?.name || '' : '';
  for (const { i, kind } of candidates) {
    const base = items[i], first = items[i + 1], h = base.height;
    const lift = first.transform[5] - base.transform[5], gap = first.transform[4] - base.transform[4] - base.width;
    if (first.height < h * 0.5 || first.height >= h * 0.86 || gap < -h * 0.13 || gap > h * 0.25) continue;
    if (kind === 'name') {
      // A smaller, lowered word can qualify a name at the end of a prose run.
      // Require physical contact so neighboring table cells remain independent.
      if (gap < -h * 0.06 || gap > h * 0.10 || lift > -h * 0.09 || lift < -h * 0.32) continue;
      corrected[i] = { ...base, str: base.str + '_{' + first.str + '}', width: first.transform[4] + first.width - base.transform[4] };
      corrected[i + 1] = { ...first, str: '' };
      continue;
    }
    if (kind === 'indexedVector' ? lift > -h * 0.06 || lift < -h * 0.5 : lift < h * 0.18 || lift > h * 0.7) continue;
    if (kind !== 'dimension') {
      const scriptFont = kind === 'ordinal' ? /^(?:[A-Z]{6}\+)?CMR\d+$/u : /^(?:[A-Z]{6}\+)?CMMI\d+$/u;
      if (!/^(?:[A-Z]{6}\+)?CMMI\d+$/u.test(font(base)) || !scriptFont.test(font(first))) continue;
      const suffix = kind === 'ordinal' ? '^{th}' : '_{' + first.str + '}';
      corrected[i] = { ...base, str: base.str + suffix, width: first.transform[4] + first.width - base.transform[4] };
      corrected[i + 1] = { ...first, str: '' };
      continue;
    }
    if (!/^(?:[A-Z]{6}\+)?MSBM\d+$/u.test(font(base))) continue;
    let j = i + 1, end = base.transform[4] + base.width, exponent = '';
    while (j < items.length && items[j].str?.trim() && Math.abs(items[j].transform[5] - first.transform[5]) < h * 0.1) {
      const script = items[j], gap = script.transform[4] - end;
      if (Math.abs(script.height - first.height) > h * 0.1 || gap < -h * 0.13 || gap > h * 0.25 ||
          !/^(?:[A-Z]{6}\+)?CM(?:MI|SY|R)\d+$/u.test(font(script))) { exponent = ''; break; }
      exponent += script.str;
      end = script.transform[4] + script.width;
      j++;
    }
    if (!/^[A-Z](?:×(?:[A-Z]|\d+))*$/u.test(exponent)) continue;
    corrected[i] = { ...base, str: 'ℝ^{' + exponent + '}', width: end - base.transform[4] };
    for (let k = i + 1; k < j; k++) corrected[k] = { ...items[k], str: '' };
  }
  return { ...content, items: corrected };
}

function startsFootnote(marker, body, pageHeight) {
  return marker && body && body.y < pageHeight * 0.18 && /^(?:\p{Nd}{1,3}|[*†‡])$/u.test(marker.text.trim()) &&
    /^\s*\p{L}/u.test(body.text) && marker.height < body.height * 0.9 &&
    marker.y - body.y >= body.height * 0.15 && marker.y - body.y <= body.height * 0.8 &&
    Math.abs(body.x - marker.end) <= body.height * 0.6;
}

// Right-aligned, quarter-turned plot labels have different starting baselines.
// Their far edges line up across the axis. Preserve that left-to-right order.
function alignedAxisLabels(items) {
  const anchors = new Map();
  let run = [], end = 0;
  function finish() {
    if (run.length >= 3 && run.some(item => Math.abs(item.transform[5] - run[0].transform[5]) > item.height * 0.4)) {
      for (const item of run) anchors.set(item, end);
    }
    run = [];
  }
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const t = item.transform;
    if (t[0] !== 0 || t[3] !== 0 || !t[1] || !t[2] || !(item.width > 0 && item.height > 0)) { finish(); continue; }
    const edge = t[5] + Math.sign(t[1]) * item.width;
    const prior = run.at(-1);
    if (prior && (prior.fontName !== item.fontName || prior.transform[1] !== t[1] ||
        Math.abs(edge - end) > item.height * 0.12 || t[4] - prior.transform[4] < item.height * 0.65 ||
        t[4] - prior.transform[4] > item.height * 8)) finish();
    if (!run.length) end = edge;
    run.push(item);
  }
  finish();
  return anchors;
}

function textRows(items, left, bottom, width, pageHeight, styles) {
  const axisLabels = alignedAxisLabels(items);
  const rows = [];
  let previousText;
  for (const [index, item] of items.entries()) {
    if (!item.str?.trim()) continue;
    const x = item.transform[4] - left;
    const y = (axisLabels.get(item) ?? item.transform[5]) - bottom;
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
    const raisedPrefix = adjacent && !previousText.raisedSuffix && previousText.row.items.length === 1 &&
      startsFootnote(previousText, { text: item.str, x, y, height }, pageHeight);
    let row = raisedSuffix || raisedPrefix ? previousText.row : rows.find(candidate => candidate.vertical === vertical && Math.abs(candidate.y - y) < Math.max(2, height * 0.4));
    if (!row) {
      row = { y, items: [], vertical };
      rows.push(row);
    }
    if (raisedPrefix) {
      // Another column or a hyperlink may already have created this baseline.
      const existing = rows.find(other => other !== row && !other.vertical && Math.abs(other.y - y) < height * 0.12);
      if (existing) {
        existing.items.push(...row.items);
        rows.splice(rows.indexOf(row), 1);
        row = existing;
      } else row.y = y;
    }
    const previous = items[index - 1];
    const spaceBefore = axisLabels.has(item) || previous?.str === ' ' && Math.abs(previous.transform[5] - item.transform[5]) < 1;
    const placed = { text: item.str, x, y, end: x + (vertical ? height : item.width), height, spaceBefore,
      monospace: styles?.[item.fontName]?.fontFamily === 'monospace' };
    if (item.pdfTag) { placed.pdfTag = item.pdfTag; placed.direction = item.dir; }
    if (item.selectionIndex !== undefined) placed.selectionIndex = item.selectionIndex;
    row.items.push(placed);
    previousText = { ...placed, vertical, row, raisedSuffix };
  }
  return rows.sort((a, b) => b.y - a.y);
}

function lineFromItems(items, y, vertical, pageHeight) {
  const x = items[0].x;
  let end = x;
  let text = '';
  for (const [index, item] of items.entries()) {
    // TeX can print a lowercase c inside a separate circled glyph mapped to ©.
    const outer = items[index - 1];
    if (item.text === 'c' && outer?.text === '©' && item.x > outer.x && item.end < outer.end &&
        Math.abs(item.y - outer.y) < outer.height * 0.12) continue;
    if (text && (item.spaceBefore || item.x - end > Math.max(2, item.height * 0.25))) text += ' ';
    text += item.text;
    end = Math.max(end, item.end);
  }
  const line = { text: normalizeExtractedLine(text), y, x, width: end - x, height: Math.max(...items.map(item => item.height)), independent: vertical };
  const logical = !vertical && logicalTaggedLine(items);
  if (logical) {
    const fragments = logical.map(({ index, gap }, position) => {
      const space = position && gap && (items[gap].spaceBefore || items[gap].x - items[gap - 1].end > Math.max(2, items[gap].height * 0.25));
      return (space ? ' ' : '') + unfoldArabicForms(items[index].text);
    });
    line.text = normalizeExtractedLine(fragments.join(''));
    if (items[0].selectionIndex !== undefined) {
      line.taggedSequence = logical.map(({ index, gap }) => ({ ink: items[index].selectionIndex, gap: items[gap].selectionIndex }));
    }
  }
  if (items[0].selectionIndex !== undefined) line.selectionIndices = items.map(item => item.selectionIndex);
  if (vertical && items.length >= 3) line.figureAxis = true;
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
  if (!vertical && startsFootnote(marker, body, pageHeight)) {
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

function verticalText(value) {
  const text = value.replaceAll('︒', '。').replaceAll('︑', '、');
  const pieces = text.trim().split(' ');
  // PDF.js can insert a space between every glyph of a vertically tracked CJK column.
  return pieces.length >= 3 && pieces.every(piece => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々ー。、]$/u.test(piece))
    ? pieces.join('') : text;
}

function verticalColumns(items, left, bottom) {
  const columns = [];
  const ordered = [...items].sort((a, b) => b.transform[4] - a.transform[4]);
  for (const item of ordered) {
    const x = item.transform[4] - left, y = item.transform[5] - bottom;
    const width = item.width || Math.hypot(item.transform[0], item.transform[1]) || 1;
    let column = columns.at(-1);
    if (!column || Math.abs(column.x - x) > Math.min(column.width, width) * 0.4) {
      column = { x, width, pieces: [] };
      columns.push(column);
    }
    column.pieces.push({ item, y, end: y - item.height, text: verticalText(item.str) });
  }
  const lines = [];
  for (const { x, width, pieces } of columns) {
    let line;
    for (const piece of pieces.sort((a, b) => b.y - a.y)) {
      if (!line || line.bottom - piece.y > width * 1.5) {
        line = { x, y: piece.y, bottom: piece.end, width, height: width, text: piece.text, items: [piece.item], independent: true, lane: 'spanning' };
        lines.push(line);
      } else {
        const wordGap = line.bottom - piece.y > width * 0.2 && /[A-Za-z0-9]$/.test(line.text) && /^[A-Za-z0-9]/.test(piece.text);
        line.text += (wordGap ? ' ' : '') + piece.text;
        line.bottom = Math.min(line.bottom, piece.end);
        line.items.push(piece.item);
      }
    }
  }
  return lines;
}

function insertVerticalColumns(horizontal, columns, yOf, entriesFor) {
  columns.sort((a, b) => b.y - a.y);
  const result = [];
  let horizontalAt = 0;
  for (let i = 0; i < columns.length;) {
    const top = columns[i].y;
    while (horizontalAt < horizontal.length && yOf(horizontal[horizontalAt]) > top) result.push(horizontal[horizontalAt++]);
    // Overlapping columns belong to one right-to-left band. A later band restarts on the right.
    const start = i;
    let floor = columns[i++].bottom;
    while (i < columns.length && columns[i].y > floor) floor = Math.min(floor, columns[i++].bottom);
    for (const column of columns.slice(start, i).sort((a, b) => b.x - a.x || b.y - a.y)) {
      for (const entry of entriesFor(column)) result.push(entry);
    }
  }
  return result.concat(horizontal.slice(horizontalAt));
}

// Some PDF producers store an upright sheet sideways and rely on the page's /Rotate entry.
// A reader can also rotate an otherwise ordinary page to inspect a figure. Only undo storage
// rotation when this makes more of the printed text upright than its original coordinates did.
export function usesPageRotation(items, rotation) {
  if (![90, 180, 270].includes(rotation)) return false;
  let rotated = 0, upright = 0;
  for (const item of items) {
    if (!item.transform || !item.str?.trim()) continue;
    const [a, b] = item.transform;
    const advance = rotation === 180 ? -a : rotation === 90 ? b : -b;
    const cross = rotation === 180 ? b : a;
    if (advance > Math.abs(cross)) rotated += item.str.length;
    if (a > Math.abs(b)) upright += item.str.length;
  }
  return rotated > upright;
}

export function readingPageCoordinates(content, view, rotation) {
  if (!usesPageRotation(content.items, rotation)) return { content, view };
  const [left, bottom, right, top] = view;
  const quarter = rotation !== 180;
  const items = content.items.map(item => {
    if (!item.transform) return item;
    const [a, b, c, d, x, y] = item.transform;
    const transform = rotation === 90 ? [b, -a, d, -c, y - bottom, right - x]
      : rotation === 180 ? [-a, -b, -c, -d, right - x, top - y]
      : [-b, a, -d, c, top - y, x - left];
    return { ...item, transform };
  });
  const width = right - left, height = top - bottom;
  return { content: { ...content, items }, view: [0, 0, quarter ? height : width, quarter ? width : height] };
}

function hasVerticalText(item) { return item.dir === 'ttb' && item.str?.trim(); }

export function pageLines(content, view) {
  const vertical = content.items.filter(hasVerticalText);
  if (!vertical.length) return horizontalPageLines(content, view);
  const horizontal = horizontalPageLines({ ...content, items: content.items.filter(item => !hasVerticalText(item)) }, view);
  return insertVerticalColumns(horizontal, verticalColumns(vertical, view[0], view[1]), line => line.y, column => [column]);
}

export function verticalSelectionContent(content, view) {
  const vertical = content.items.filter(hasVerticalText);
  // Leave marked-content wrappers paired if the caller explicitly requested tagged PDF text.
  if (!vertical.length || content.items.some(item => typeof item.str !== 'string')) return content;
  const horizontal = content.items.filter(item => !hasVerticalText(item));
  const items = insertVerticalColumns(horizontal, verticalColumns(vertical, view[0], view[1]),
    item => item.transform[5] - view[1], column => column.items);
  return { ...content, items };
}

export function rotatedSelectionContent(content, view, rotation, tagged = false) {
  if (content.items.some(item => typeof item.str !== 'string')) return content;
  const reading = readingPageCoordinates(content, view, rotation);
  if (reading.content === content && !tagged) return content;
  // Use the Reader's physical line and column order, but pass the original glyph matrices to PDF.js.
  // Explicit spaces stay with their run. PDF.js line breaks must follow the new printed line order.
  const runs = new Map();
  let gap = [];
  const items = reading.content.items.map((item, index) => {
    if (item.str.trim()) {
      runs.set(index, [...gap, content.items[index]]);
      gap = [];
    } else if (item.str) gap.push(content.items[index]);
    return { ...item, selectionIndex: index };
  });
  const lines = pageLines({ ...reading.content, items }, reading.view);
  const orderedLines = pdfReadingGroups(lines, { height: reading.view[3] - reading.view[1] }).flat();
  if (reading.content === content && !orderedLines.some(line => line.taggedSequence)) return content;
  const lineIndices = orderedLines.map(line => line.selectionIndices || line.items?.map(item => item.selectionIndex) || []);
  const order = lineIndices.flat();
  // Reader cleanup may omit a printed page decoration. The selectable original must keep every glyph.
  if (order.length !== runs.size || new Set(order).size !== runs.size || !order.every(index => runs.has(index))) return content;
  const ordered = lineIndices.flatMap((indices, row) => {
    const logical = tagged && orderedLines[row].taggedSequence;
    // Keep an untagged bidi line's existing PDF.js sequence when no logical order is available.
    const sequence = indices.some(index => content.items[index].dir === 'rtl') ? [...indices].sort((a, b) => a - b) : indices;
    const items = logical ? logical.flatMap(({ ink, gap }) => {
      const item = content.items[ink];
      const str = unfoldArabicForms(item.str);
      return [...runs.get(gap).slice(0, -1), str === item.str ? item : { ...item, str, sourceItem: item }];
    }) : sequence.flatMap(index => runs.get(index));
    return items.map((item, i) => {
      const hasEOL = row < lineIndices.length - 1 && i === items.length - 1;
      return hasEOL === item.hasEOL ? item : { ...item, hasEOL, sourceItem: item.sourceItem || item };
    });
  });
  return { ...content, items: ordered.concat(gap) };
}

function horizontalPageLines(content, [left, bottom, right, top]) {
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
  const physicalRows = textRows(content.items, left, bottom, width, pageHeight, content.styles);
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

// A full-width figure can precede the continuation of the previous page's
// sentence. Both body columns must restart below a separated, printed caption.
export function openingFigure(lines, height) {
  const start = lines.findIndex(line => line.lane === 'spanning' && line.y > height * 0.48 &&
    /^(?:Figure|Fig\.)\s+\d+[.:]/iu.test(line.text));
  if (start < 1) return null;
  const caption = lines[start];
  const diagram = lines.slice(0, start);
  if (diagram.some(line => line.height >= caption.height * 0.92 && hasProse(line.text))) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end], gap = lines[end - 1].y - line.y;
    if (gap <= 0 || gap > caption.height * 1.5 || Math.abs(line.height - caption.height) > caption.height * 0.08 ||
        Math.abs(line.x - caption.x) > caption.height || line.lane === 'right' ||
        lines[end + 1]?.y === line.y) break;
    end++;
  }
  const first = lines[end], other = lines[end + 1];
  if (!first || !other || first.lane !== 'left' || other.lane !== 'right' ||
      Math.abs(first.y - other.y) > first.height * 0.5 || lines[end - 1].y - first.y < first.height * 1.6 ||
      !hasProse(first.text) || !hasProse(other.text)) return null;
  const text = lines.slice(start, end).map(line => line.text).reduce(joinPdfText);
  return { figure: [...diagram, { ...caption, text, independent: true }], body: lines.slice(end) };
}

// A numerical table can occupy the top of the right column while the last
// word in the left column continues in the body printed below that table.
export function bodyAfterColumnTable(lines) {
  let start = 0;
  while (start < lines.length) {
    const captionAt = lines.findIndex((line, i) => i >= start && /^Table\s+\d+[.:]\s/iu.test(line.text));
    if (captionAt - start < 3) return 0;
    const caption = lines[captionAt], table = lines.slice(start, captionAt);
    if (table.some(line => line.x < caption.x - caption.height || line.height > caption.height * 1.05 || hasProse(line.text)) ||
        table.filter(line => /\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*$/u.test(line.text)).length < 2) return 0;
    let end = captionAt + 1;
    while (end < lines.length && Math.abs(lines[end].height - caption.height) <= caption.height * 0.08 &&
        Math.abs(lines[end].x - caption.x) <= caption.height && lines[end - 1].y - lines[end].y <= caption.height * 1.5) end++;
    const next = lines[end];
    if (!next || lines[end - 1].y - next.y < next.height * 1.6) return 0;
    if (next.height >= caption.height * 1.05) return /^\p{Ll}+[\s,.;:]/u.test(next.text) && hasProse(next.text) ? end : 0;
    // A smaller heading below the caption can begin a second table.
    if (next.height >= caption.height * 0.96) return 0;
    start = end;
  }
  return 0;
}

function bodyBelowParallelTables(lines, height, groups) {
  if (!lines.some(line => line.lane === 'right' && line.y > height * 0.6 && /^Table\s+\d+[.:]\s/iu.test(line.text))) return null;
  const left = lines.filter(line => line.lane === 'left');
  const start = bodyAfterColumnTable(left);
  if (!start) return null;
  const target = left[start], ordered = groups.flat();
  const prefix = ordered.slice(0, ordered.indexOf(target));
  return prefix.some(line => line.height >= target.height * 0.96 && hasProse(line.text)) ? null : target;
}

export function pdfReadingSegments(lines, page, previousSplitWord) {
  const segments = [];
  const opening = page.pageNumber > 1 && openingFigure(lines, page.height);
  if (opening) {
    for (const group of pdfReadingGroups(opening.figure)) segments.push({ lines: group, floating: true });
  }
  const groups = pdfReadingGroups(opening ? opening.body : lines, page);
  let target = !opening && previousSplitWord && bodyBelowParallelTables(lines, page.height, groups);
  let previous;
  for (const original of groups) {
    let group = original;
    if (target) {
      const at = group.indexOf(target);
      if (at < 0) { segments.push({ lines: group, floating: true }); continue; }
      if (at) segments.push({ lines: group.slice(0, at), floating: true });
      group = group.slice(at);
      target = null;
    }
    const first = group[0], lastLeft = previous?.at(-1);
    const turn = first?.lane === 'right' && lastLeft?.lane === 'left' &&
      Math.abs(previous[0].y - first.y) <= first.height && first.y - lastLeft.y >= 2 * first.height;
    const tableEnd = turn && /\p{Ll}[-‐]$/u.test(lastLeft.text) ? bodyAfterColumnTable(group) : 0;
    if (tableEnd) segments.push({ lines: group.slice(0, tableEnd), floating: true });
    segments.push({ lines: tableEnd ? group.slice(tableEnd) : group, columnStart: turn });
    previous = group;
  }
  return segments;
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

// Proceedings often print their venue and copyright below both columns on page one.
// Keep that notice with the byline so a sentence can continue onto the next page.
function proceedingsOpening(lines, height) {
  const noticeAt = lines.findIndex(line => line.lane === 'spanning' && line.y < height * 0.10 &&
    /^Proceedings of\b/iu.test(line.text) && /\b(?:pages?|pp\.)\s*\d+\s*[–—-]\s*\d+/iu.test(line.text));
  if (noticeAt < 0) return null;
  const notice = lines.slice(noticeAt);
  if (notice.length > 4 || !notice.every(line => line.lane === 'spanning') ||
      !notice.some(line => /©|\bcopyright\b/iu.test(line.text))) return null;
  const abstract = lines.find(line => line.lane === 'left' && /^(?:abstract|summary)$/iu.test(line.text.trim()));
  if (!abstract || lines[0]?.lane !== 'spanning') return null;
  const bodyAt = lines.findIndex(line => line.y <= abstract.y + abstract.height);
  if (bodyAt < 1 || bodyAt >= noticeAt) return null;

  const front = [];
  const title = lines[0];
  const center = line => line.x + line.width / 2;
  let previous;
  for (const line of lines.slice(0, bodyAt)) {
    const wrapsTitle = front.length === 1 && line.lane === 'spanning' &&
      Math.abs(line.height - title.height) < title.height * 0.08 && Math.abs(center(line) - center(title)) < title.height &&
      previous.y > line.y && previous.y - line.y < title.height * 1.5;
    const sharesByline = previous?.lane === 'left' && line.lane === 'right' && previous.y === line.y;
    if (wrapsTitle || sharesByline) front.at(-1).text = joinPdfText(front.at(-1).text, line.text);
    else front.push({ ...line });
    previous = line;
  }
  const imprint = { ...notice[0], text: notice.map(line => line.text).reduce(joinPdfText) };
  return [...front.map(line => [line]), [imprint], ...pdfReadingGroups(lines.slice(bodyAt, noticeAt))];
}

export function pdfReadingGroups(lines, page = {}) {
  if (page.pageNumber === 1) {
    const opening = proceedingsOpening(lines, page.height);
    if (opening) return opening;
  }
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
