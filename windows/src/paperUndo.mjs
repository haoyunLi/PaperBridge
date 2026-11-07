import { anchorText } from './academicMarkdown.mjs';
import { remapSummaryEvidence } from './paper.mjs';
import { firstSelectableParagraphID, isSelectableParagraphID, resolveSelectedParagraphID } from './paragraphSelection.mjs';
import { normalizeSearchOrigin } from './readingHistory.mjs';

const blockFields = ['bookmark', 'notes', 'highlights', 'translationHighlights'];
const documentFields = ['pdfNotes', 'pdfHighlights', 'viewNotes', 'viewHighlights'];
const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sourceKey = block => JSON.stringify([block.text, block.sourceMarkdown, block.heading, block.resource, block.page]);
const sameSources = (left, right) => left.length === right.length && left.every((block, index) => sourceKey(block) === sourceKey(right[index]));
const itemKey = item => item.id || JSON.stringify([item.kind, item.scope, item.page, item.offset, item.text, item.color]);
const viewportFields = ['block', 'page', 'scrollByTab'];

function readingPositionSnapshot(position) {
  if (!position) return undefined;
  const snapshot = Object.fromEntries(viewportFields.filter(field => Object.hasOwn(position, field))
    .map(field => [field, clone(position[field])]));
  // A structural change exits filtering. Its snapshot must represent the
  // durable unfiltered location, not the temporary search-result viewport.
  const origin = normalizeSearchOrigin(position.readerSearchOrigin);
  if (origin !== null) {
    snapshot.scrollByTab = { ...snapshot.scrollByTab, Reader: typeof origin === 'number' ? origin : origin.scrollTop };
    if (typeof origin === 'object') snapshot.block = origin.block;
  }
  return snapshot;
}

function restoreReadingPosition(current, snapshot) {
  const position = { ...current };
  for (const field of [...viewportFields, 'readerSearchOrigin']) delete position[field];
  Object.assign(position, clone(snapshot));
  return Object.keys(position).length ? position : undefined;
}

// Mac keeps paper-view locations and remaps the Reader item independently of
// the newly selected edit result. Pixel offsets into the old Reader layout and
// positions in invalidated generated views cannot describe the new structure.
export function remapPositionAfterStructureChange(position, beforeBlocks, afterBlocks, range = changedRange(beforeBlocks, afterBlocks)) {
  const next = { ...position, ...readingPositionSnapshot(position) };
  const oldIndex = beforeBlocks.findIndex(block => block.id === next.block);
  const nextIndex = oldIndex < range.start ? oldIndex
    : oldIndex < range.beforeEnd ? range.start : oldIndex + range.afterEnd - range.beforeEnd;
  if (oldIndex >= 0 && Number.isSafeInteger(afterBlocks[nextIndex]?.id) && afterBlocks[nextIndex].id > 0) next.block = afterBlocks[nextIndex].id;
  else delete next.block;
  next.scrollByTab = Object.fromEntries(Object.entries(next.scrollByTab || {}).filter(([key]) =>
    key === 'Paper' || key.startsWith('Paper:') || key === 'Original' || key.startsWith('Original:') || key.startsWith('Pdf:')));
  delete next.readerSearchOrigin;
  return next;
}

function changedFields(before, after, fields) {
  return fields.filter(field => !equal(before[field], after[field]))
    .map(field => ({ field, before: clone(before[field]), after: clone(after[field]) }));
}

// Structural edits also remember their original summary so undo can restore
// citations, provided the user has not replaced the summary since the edit.
export function createUndoEntry(before, after, range) {
  if (!before || !after || before.id !== after.id || before.sourceMode !== after.sourceMode) return null;
  const base = { paperId: before.id, sourceMode: before.sourceMode };
  if (!sameSources(before.blocks, after.blocks)) {
    return { ...base, type: 'structure', beforeBlocks: clone(before.blocks), afterBlocks: clone(after.blocks), range,
      beforeSummary: clone(before.summary), afterSummary: clone(after.summary),
      beforeSelectedParagraphID: resolveSelectedParagraphID(before), beforePosition: readingPositionSnapshot(before.position) };
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

function matchItems(from, to, allowAnchorChanges = true) {
  const matches = new Map(), used = new Set();
  const sameKey = (a, b) => itemKey(a) === itemKey(b);
  const anchor = ({ body, color, ...rest }) => rest;
  function match(index, target) { matches.set(index, target); used.add(target); }
  // Record IDs are not unique in every legacy document. Match occurrences,
  // retaining their multiplicity, before considering a changed body or color.
  from.forEach((item, index) => {
    const target = to.findIndex((other, at) => !used.has(at) && sameKey(item, other) && equal(item, other));
    if (target >= 0) match(index, target);
  });
  from.forEach((item, index) => {
    if (matches.has(index)) return;
    const candidates = to.flatMap((other, at) => !used.has(at) && sameKey(item, other) && equal(anchor(item), anchor(other)) ? [at] : []);
    if (candidates.length === 1 && from.filter((other, at) => !matches.has(at) && sameKey(other, to[candidates[0]]) && equal(anchor(other), anchor(to[candidates[0]]))).length === 1) match(index, candidates[0]);
  });
  // A genuinely unique ID still supports ordinary edits to anchor fields.
  from.forEach((item, index) => {
    if (!allowAnchorChanges || matches.has(index) || from.filter(other => sameKey(item, other)).length !== 1 || to.filter(other => sameKey(item, other)).length !== 1) return;
    const target = to.findIndex((other, at) => !used.has(at) && sameKey(item, other));
    if (target >= 0) match(index, target);
  });
  return matches;
}

function undoItems(current = [], before = [], after = []) {
  if (equal(current, after)) return clone(before);
  const oldToNew = matchItems(before, after), newToCurrent = matchItems(after, current);
  const matchedNew = new Set(oldToNew.values()), matchedCurrent = new Set(newToCurrent.values());
  const result = current.map(item => ({ item }));
  const currentNodes = [...result];
  const beforeNodes = before.map((_, index) => currentNodes[newToCurrent.get(oldToNew.get(index))]);
  const deleted = before.flatMap((item, index) => oldToNew.has(index) ? [] : [{ item, index }]);
  const added = after.flatMap((item, index) => matchedNew.has(index) ? [] : [{ item, index }]);
  for (const [oldIndex, newIndex] of oldToNew) {
    const node = currentNodes[newToCurrent.get(newIndex)];
    if (node && !equal(before[oldIndex], after[newIndex])) node.item = undoObject(node.item, before[oldIndex], after[newIndex]);
  }
  for (const { item, index } of added) {
    // Unmatched changes sharing a key may be edits to ambiguous duplicates.
    if (deleted.some(old => itemKey(old.item) === itemKey(item))) continue;
    const node = currentNodes[newToCurrent.get(index)];
    if (node && equal(node.item, item)) result.splice(result.indexOf(node), 1);
  }
  for (const { item, index } of deleted) {
    if (added.some(next => itemKey(next.item) === itemKey(item))) continue;
    // Do not duplicate an occurrence already restored independently.
    const existing = current.findIndex((other, at) => !matchedCurrent.has(at) && equal(item, other));
    if (existing >= 0) {
      matchedCurrent.add(existing); beforeNodes[index] = currentNodes[existing]; continue;
    }
    const node = { item: clone(item) };
    const next = beforeNodes.slice(index + 1).find(candidate => candidate && result.includes(candidate));
    const previous = beforeNodes.slice(0, index).findLast(candidate => candidate && result.includes(candidate));
    const at = next ? result.indexOf(next) : previous ? result.indexOf(previous) + 1 : Math.min(index, result.length);
    result.splice(at, 0, node); beforeNodes[index] = node;
  }
  return result.map(node => node.item);
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
    if (equal(current.map(block => block[field] || []), after.map(block => block[field] || []))) continue;
    const records = blocks => blocks.flatMap((block, blockIndex) => (block[field] || []).map(item => ({ item, blockIndex })));
    const oldItems = records(restored), afterItems = records(after), latest = records(current);
    const invariant = ({ offset, displayOffset, renderedAnchor, needsReview, ...item }) => JSON.stringify(item);
    const anchor = ({ body, color, ...item }) => item;
    const sameAnchor = (a, b) => a.blockIndex === b.blockIndex && itemKey(a.item) === itemKey(b.item) && equal(anchor(a.item), anchor(b.item));
    const groups = items => {
      const result = new Map();
      items.forEach(({ item }, index) => {
        const key = invariant(item);
        if (!result.has(key)) result.set(key, []);
        result.get(key).push(index);
      });
      return result;
    };
    const oldGroups = groups(oldItems), afterGroups = groups(afterItems);
    const oldToAfter = new Map(), afterToLive = new Map(), consumed = new Set(), review = new Set();
    let afterStart = 0, liveStart = 0;
    after.forEach((block, blockIndex) => {
      const old = block[field] || [], live = current[blockIndex]?.[field] || [];
      // Current and after share the same source blocks. A reused ID on a new
      // anchor must not masquerade as an edit of a deleted historical record.
      for (const [a, b] of matchItems(old, live, false)) afterToLive.set(afterStart + a, liveStart + b);
      afterStart += old.length; liveStart += live.length;
    });
    const claimedLive = new Set(afterToLive.values());
    for (const [key, oldIndices] of oldGroups) {
      const nextIndices = afterGroups.get(key) || [];
      const samePlace = (items, indices) => indices.every(index => sameAnchor(items[index], items[indices[0]]));
      if (oldIndices.length === 1 && nextIndices.length === 1 ||
          nextIndices.length && samePlace(oldItems, oldIndices) && samePlace(afterItems, nextIndices)) {
        oldIndices.slice(0, nextIndices.length).forEach((index, at) => oldToAfter.set(index, nextIndices[at]));
      } else {
        // Several identical bodies on different original anchors cannot be
        // assigned a later edit safely. Keep originals and preserve changed
        // live records separately for review; consume unchanged copies only.
        for (const index of nextIndices) {
          const liveIndex = afterToLive.get(index);
          if (liveIndex === undefined) continue;
          if (equal(afterItems[index].item, latest[liveIndex].item)) consumed.add(liveIndex);
          else review.add(liveIndex);
        }
      }
    }
    let oldIndex = 0;
    for (const block of restored) {
      block[field] = (block[field] || []).flatMap(original => {
        const afterIndex = oldToAfter.get(oldIndex++);
        if (afterIndex === undefined) return [original];
        const liveIndex = afterToLive.get(afterIndex);
        if (liveIndex === undefined) {
          const possible = latest.flatMap((record, index) => !claimedLive.has(index) && sameAnchor(afterItems[afterIndex], record) ? [index] : []);
          if (possible.length) { possible.forEach(index => review.add(index)); return [original]; }
          return [];
        }
        const live = latest[liveIndex].item;
        consumed.add(liveIndex);
        // A user's later deletion remains deleted. An annotation discarded by
        // the structural edit itself is restored along with its old anchor.
        return [{ ...original, ...(Object.hasOwn(live, 'body') ? { body: live.body } : {}), ...(Object.hasOwn(live, 'color') ? { color: live.color } : {}) }];
      });
    }
    for (const [index, { item }] of latest.entries()) {
      if (consumed.has(index) || !restored.length) continue;
      const ambiguous = review.has(index) || afterItems.some(record => sameAnchor(record, latest[index]));
      const kind = field === 'translationHighlights' || item.kind === 'translation' ? 'translation' : 'source';
      const candidates = restored.flatMap((block, index) => {
        const text = anchorText(block, kind);
        const matches = [];
        if (item.text) for (let offset = text.indexOf(item.text); offset >= 0; offset = text.indexOf(item.text, offset + 1)) matches.push({ index, offset });
        return matches;
      });
      const unique = !ambiguous && candidates.length === 1 ? candidates[0] : null;
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
  const { start, beforeEnd, afterEnd } = entry.range || changedRange(entry.beforeBlocks, entry.afterBlocks);
  const restored = restoreStructuralAnnotations(clone(entry.beforeBlocks.slice(start, beforeEnd)), current.blocks.slice(start, afterEnd), entry.afterBlocks.slice(start, afterEnd));
  const blocks = [...current.blocks.slice(0, start), ...restored, ...current.blocks.slice(afterEnd)]
    .map((block, index) => ({ ...block, id: entry.beforeBlocks[index].id }));
  const summary = equal(current.summary, entry.afterSummary) ? entry.beforeSummary
    : remapSummaryEvidence(current.summary, current.blocks, blocks, { start, beforeEnd: afterEnd, afterEnd: beforeEnd });
  // Mac's structural Undo restores the old selected index, falling back to the
  // first paragraph for a nil/invalid snapshot. This differs deliberately from
  // loading an explicitly null selection, which preserves null.
  const selectedParagraphID = isSelectableParagraphID(entry.beforeSelectedParagraphID, blocks)
    ? entry.beforeSelectedParagraphID : firstSelectableParagraphID(blocks);
  const position = restoreReadingPosition(current.position, entry.beforePosition);
  return { ...current, blocks,
    selectedParagraphID,
    ...(summary !== undefined && { summary }),
    ...(current.connectedTranslation ? { connectedStale: true } : {}),
    ...((position !== undefined || Object.hasOwn(current, 'position')) && { position }) };
}
