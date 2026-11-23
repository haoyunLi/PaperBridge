// A vector figure can contain a title outside the Form XObject's bounding box.
// PDF.js exposes that title as selectable text even though a viewer clips it.
// Only match a complete, uniquely drawn horizontal run on a page with rotated
// plot labels. Leave OCR layers, partial glyphs and ambiguous drawing state alone.
export async function omitClippedFigureText(page, content, ops) {
  const { items } = content;
  if (!items.some(item => item.str?.trim() && item.transform[0] === 0 && item.transform[1] !== 0)) return content;
  let list;
  try { list = await page.getOperatorList(); } catch { return content; }
  if (!list.fnArray.includes(ops.paintFormXObjectBegin)) return content;

  const byRun = new Map();
  for (const item of items) {
    if (!item.str?.trim() || item.transform[1] !== 0 || item.transform[2] !== 0 || item.transform[3] <= 0) continue;
    const key = item.fontName + '\n' + item.str;
    byRun.set(key, byRun.has(key) ? null : item);
  }
  const stack = [], matches = new Set(), encountered = new Set();
  const identity = [1, 0, 0, 1, 0, 0];
  let state = { matrix: identity, low: -Infinity, high: Infinity, font: '', size: 0, rise: 0 }, position = null;
  function transform(matrix) {
    const m = state.matrix;
    if (!m || !matrix) return;
    state.matrix = matrix[1] === 0 && matrix[2] === 0 && matrix[0] > 0 && matrix[3] > 0
      ? [m[0] * matrix[0], 0, 0, m[3] * matrix[3], m[0] * matrix[4] + m[4], m[3] * matrix[5] + m[5]]
      : null;
  }
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i], args = list.argsArray[i];
    switch (op) {
      case ops.save:
      case ops.beginGroup:
      case ops.paintFormXObjectBegin: {
        stack.push({ ...state });
        position = null;
        if (op === ops.beginGroup && args[0].matrix?.some((n, j) => n !== identity[j])) state.matrix = null;
        if (op !== ops.paintFormXObjectBegin) break;
        const [matrix, bounds] = args;
        transform(matrix);
        if (bounds && state.matrix) {
          const m = state.matrix;
          state.low = Math.max(state.low, m[3] * bounds[1] + m[5]);
          state.high = Math.min(state.high, m[3] * bounds[3] + m[5]);
        }
        break;
      }
      case ops.restore:
      case ops.endGroup:
      case ops.paintFormXObjectEnd:
        if (!stack.length) return content;
        state = stack.pop();
        position = null;
        break;
      case ops.transform:
        transform(args);
        position = null;
        break;
      case ops.setFont:
        [state.font, state.size] = args;
        break;
      case ops.setGState:
        if (args[0].some(([key]) => key === 'Font')) state.font = '';
        break;
      case ops.setTextRise:
        state.rise = args[0];
        break;
      case ops.setTextMatrix:
        position = args[0];
        break;
      case ops.showText: {
        const at = position, m = state.matrix;
        position = null;
        if (!Array.isArray(args[0])) break;
        const text = args[0].map(glyph => glyph.unicode || '').join('');
        const key = state.font + '\n' + text, item = byRun.get(key);
        if (!item) break;
        if (encountered.has(key)) { matches.delete(item); break; }
        encountered.add(key);
        if (!at || !m || at[1] !== 0 || at[2] !== 0 || state.rise !== 0 || state.size <= 0 ||
            (!Number.isFinite(state.low) && !Number.isFinite(state.high))) break;
        const [, , , height, x, y] = item.transform;
        if (Math.abs(m[0] * at[4] + m[4] - x) > 0.05 ||
            Math.abs(m[3] * at[5] + m[5] - y) > 0.05 ||
            Math.abs(m[3] * at[3] * state.size - height) > 0.05 || !page.commonObjs.has(state.font)) break;
        const { bbox, fontMatrix: fm } = page.commonObjs.get(state.font);
        if (!bbox || !fm || fm[1] || fm[2] || fm[5] || fm[3] <= 0 || bbox[1] >= bbox[3]) break;
        // Include the entire embedded font box, with an extra em of clearance.
        if (y + height * (bbox[3] * fm[3] + 1) < state.low ||
            y + height * (bbox[1] * fm[3] - 1) > state.high) matches.add(item);
        break;
      }
      case ops.beginText:
      case ops.endText:
      case ops.moveText:
      case ops.setLeadingMoveText:
      case ops.nextLine:
      case ops.nextLineShowText:
      case ops.nextLineSetSpacingShowText:
      case ops.showSpacedText:
        position = null;
        break;
    }
  }
  return !stack.length && matches.size ? { ...content, items: items.filter(item => !matches.has(item)) } : content;
}
