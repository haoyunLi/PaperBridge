import { anchorText } from './academicMarkdown.mjs';

const blockFields = ['bookmark', 'notes', 'highlights', 'translationHighlights'];
const documentFields = ['pdfNotes', 'pdfHighlights', 'viewNotes', 'viewHighlights'];
const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sourceKey = block => JSON.stringify([block.text, block.sourceMarkdown, block.heading, block.resource, block.page]);
const sameSources = (left, right) => left.length === right.length && left.every((block, index) => sourceKey(block) === sourceKey(right[index]));
const itemKey = item => item.id || JSON.stringify([item.kind, item.scope, item.page, item.offset, item.text, item.color]);

function changedFields(before, after, fields) {
  return fields.filter(field => !equal(before[field], after[field]))
    .map(field => ({ field, before: clone(before[field]), after: clone(after[field]) }));
}

// Only user-editable fields enter the undo history. AI results and settings are
// intentionally read from the live paper when an entry is applied.
export function createUndoEntry(before, after) {
  if (!before || !after || before.id !== after.id || before.sourceMode !== after.sourceMode) return null;
  const base = { paperId: before.id, sourceMode: before.sourceMode };
  if (!sameSources(before.blocks, after.blocks)) {
    return { ...base, type: 'structure', beforeBlocks: clone(before.blocks), afterBlocks: clone(after.blocks) };
  }
  const blocks = before.blocks.flatMap((block, index) => {
    const changes = changedFields(block, after.blocks[index], blockFields);
    return changes.length ? [{ id: after.blocks[index].id, source: sourceKey(block), changes }] : [];
  });
  const changes = changedFields(before, after, documentFields);
  return blocks.length || changes.length ? { ...base, type: 'annotations', blocks, changes } : null;
}

// Undo only fields that still have this action's value. A later change to a note
// body, highlight color, or unrelated annotation survives the undo.
function undoObject(current, before, after) {
  const result = { ...current };
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!equal(before[field], after[field]) && equal(current[field], after[field])) {
      if (Object.hasOwn(before, field)) result[field] = clone(before[field]);
      else delete result[field];
    }
  }
  return result;
}

function undoItems(current = [], before = [], after = []) {
  const oldItems = new Map(before.map(item => [itemKey(item), item]));
  const newItems = new Map(after.map(item => [itemKey(item), item]));
  let result = [...current];
  for (const key of new Set([...oldItems.keys(), ...newItems.keys()])) {
    const oldItem = oldItems.get(key);
    const newItem = newItems.get(key);
    if (equal(oldItem, newItem)) continue;
    const index = result.findIndex(item => itemKey(item) === key);
    if (!oldItem) {
      if (index >= 0 && equal(result[index], newItem)) result.splice(index, 1);
    } else if (!newItem) {
      if (index < 0) result.push(clone(oldItem));
    } else if (index >= 0) result[index] = undoObject(result[index], oldItem, newItem);
  }
  return result;
}

function undoFields(current, changes) {
  const result = { ...current };
  for (const { field, before, after } of changes) {
    if (Array.isArray(before) || Array.isArray(after)) result[field] = undoItems(current[field], before, after);
    else if (equal(current[field], after)) {
      if (before === undefined) delete result[field];
      else result[field] = clone(before);
    }
  }
  return result;
}

function changedRange(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && sourceKey(before[start]) === sourceKey(after[start])) start++;
  let suffix = 0;
  while (suffix < before.length - start && suffix < after.length - start && sourceKey(before[before.length - suffix - 1]) === sourceKey(after[after.length - suffix - 1])) suffix++;
  return { start, beforeEnd: before.length - suffix, afterEnd: after.length - suffix };
}

function restoreStructuralAnnotations(restored, current, after) {
  for (const field of ['notes', 'highlights', 'translationHighlights']) {
    const oldItems = restored.flatMap(block => block[field] || []);
    const afterItems = after.flatMap(block => block[field] || []);
    const oldKeys = new Set(oldItems.map(itemKey));
    const afterKeys = new Set(afterItems.map(itemKey));
    const latest = new Map(current.flatMap(block => (block[field] || []).map(item => [itemKey(item), item])));
    const matchedKeys = new Set();
    const quoteKey = item => JSON.stringify([item.kind, item.text]);
    for (const block of restored) {
      block[field] = (block[field] || []).flatMap(original => {
        const key = itemKey(original);
        const legacyMatches = !original.id && oldItems.filter(item => quoteKey(item) === quoteKey(original)).length === 1
          ? afterItems.filter(item => quoteKey(item) === quoteKey(original)) : [];
        const mappedKey = afterKeys.has(key) ? key : legacyMatches.length === 1 ? itemKey(legacyMatches[0]) : key;
        const live = latest.get(mappedKey);
        if (live) matchedKeys.add(mappedKey);
        // A user's later deletion remains deleted. An annotation discarded by
        // the structural edit itself is restored along with its old anchor.
        if (!live && afterKeys.has(mappedKey)) return [];
        return [{ ...original, ...(live && Object.hasOwn(live, 'body') ? { body: live.body } : {}), ...(live && Object.hasOwn(live, 'color') ? { color: live.color } : {}) }];
      });
    }
    for (const [key, item] of latest) {
      if (oldKeys.has(key) || matchedKeys.has(key) || !restored.length) continue;
      const kind = field === 'translationHighlights' || item.kind === 'translation' ? 'translation' : 'source';
      const candidates = restored.flatMap((block, index) => {
        const text = anchorText(block, kind);
        const matches = [];
        if (item.text) for (let offset = text.indexOf(item.text); offset >= 0; offset = text.indexOf(item.text, offset + 1)) matches.push({ index, offset });
        return matches;
      });
      const unique = candidates.length === 1 ? candidates[0] : null;
      const target = restored[unique?.index ?? 0];
      const mapped = { ...item, ...(unique ? { offset: unique.offset, needsReview: false } : { needsReview: true }) };
      delete mapped.displayOffset;
      target[field].push(mapped);
    }
  }
  // Bookmarks created after an edit stay attached to an exact source match,
  // or to the restored edited passage when the split/merge cannot map exactly.
  for (const block of current.filter(block => block.bookmark)) {
    const target = restored.find(candidate => sourceKey(candidate) === sourceKey(block)) || restored[0];
    if (target) target.bookmark = true;
  }
  return restored;
}

export function applyUndoEntry(current, entry) {
  if (!current || !entry || current.id !== entry.paperId || current.sourceMode !== entry.sourceMode) return current;
  if (entry.type === 'annotations') {
    const byId = new Map(entry.blocks.map(block => [block.id, block]));
    return { ...undoFields(current, entry.changes), blocks: current.blocks.map(block => {
      const patch = byId.get(block.id);
      return patch && patch.source === sourceKey(block) ? undoFields(block, patch.changes) : block;
    }) };
  }
  if (entry.type !== 'structure' || !sameSources(current.blocks, entry.afterBlocks)) return current;
  const { start, beforeEnd, afterEnd } = changedRange(entry.beforeBlocks, entry.afterBlocks);
  const restored = restoreStructuralAnnotations(clone(entry.beforeBlocks.slice(start, beforeEnd)), current.blocks.slice(start, afterEnd), entry.afterBlocks.slice(start, afterEnd));
  const blocks = [...current.blocks.slice(0, start), ...restored, ...current.blocks.slice(afterEnd)]
    .map((block, index) => ({ ...block, id: entry.beforeBlocks[index].id }));
  const currentIndex = current.blocks.findIndex(block => block.id === current.position?.block);
  const targetIndex = currentIndex < start ? currentIndex : currentIndex < afterEnd ? start : currentIndex + beforeEnd - afterEnd;
  return { ...current, blocks,
    ...(current.summary ? { summary: { ...current.summary, stale: true } } : {}),
    ...(current.connectedTranslation ? { connectedStale: true } : {}),
    ...(currentIndex >= 0 && blocks[targetIndex] ? { position: { ...current.position, block: blocks[targetIndex].id } } : {}) };
}
