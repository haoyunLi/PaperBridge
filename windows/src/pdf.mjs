import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { blocksFromLines } from './text.mjs';
import { filterRepeatedPageDecorations, stitchPageBlocks } from './pdfDecorations.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(bytes) {
  return pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
}

function pageLines(content, pageWidth) {
  const items = content.items.filter(item => typeof item.str === 'string' && item.str.trim());
  const rows = [];
  for (const item of items) {
    const y = item.transform[5];
    let row = rows.find(candidate => Math.abs(candidate.y - y) < Math.max(2, item.height * 0.4));
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push(item);
  }
  return rows.flatMap(row => {
    row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const groups = [];
    let group = [];
    let end = -Infinity;
    for (const item of row.items) {
      const x = item.transform[4];
      if (group.length && x - end > pageWidth * 0.09 && x > pageWidth * 0.45) { groups.push(group); group = []; }
      group.push(item);
      end = x + item.width;
    }
    if (group.length) groups.push(group);
    return groups.map(items => {
      let value = ''; let previousEnd = -Infinity;
      for (const item of items) {
        if (value && item.transform[4] - previousEnd > Math.max(2, item.height * 0.25)) value += ' ';
        value += item.str;
        previousEnd = item.transform[4] + item.width;
      }
      return { text: value, y: row.y, x: items[0].transform[4], width: previousEnd - items[0].transform[4], height: Math.max(...items.map(item => item.height || 12)) };
    });
  });
}

export async function extractPdf(pdf, onPage) {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ pageNumber, width: viewport.width, height: viewport.height, lines: pageLines(content, viewport.width) });
    onPage?.(pageNumber, pdf.numPages);
  }
  const cleaned = filterRepeatedPageDecorations(pages);
  const blocks = [];
  for (const { pageNumber, width, lines } of cleaned) {
    const mid = width / 2;
    const left = lines.filter(line => line.x + line.width < mid + 12);
    const right = lines.filter(line => line.x > mid - 12);
    const twoColumns = left.length > 10 && right.length > 10 && (left.length + right.length) / Math.max(lines.length, 1) > 0.75;
    const ordered = twoColumns ? [...left, ...right, ...lines.filter(line => !left.includes(line) && !right.includes(line))] : lines;
    // Preserve the page index even when an image-only page has no selectable text.
    blocks.push(...blocksFromLines(ordered, pageNumber, blocks.length + 1, twoColumns));
  }
  return stitchPageBlocks(blocks);
}
