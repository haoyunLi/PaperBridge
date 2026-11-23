import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { blocksFromLines, finishExtractedPdfText } from './text.mjs';
import { omitClippedFigureText } from './pdfFigureText.mjs';
import { filterRepeatedPageDecorations, stitchPageBlocks } from './pdfDecorations.mjs';
import { bodyAfterColumnTable, openingFigure, pageLines, pdfReadingGroups, recoverCodeAsterisks, recoverInlineSummations, recoverMathScripts } from './pdfLayout.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(bytes) {
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
  try { return await loading.promise; }
  catch (error) {
    await loading.destroy().catch(() => {});
    throw error;
  }
}

export async function renderPagePng(pdf, pageNumber, token) {
  let page;
  let canvas;
  try {
    page = await pdf.getPage(pageNumber);
    if (token.cancelled) return null;
    const base = page.getViewport({ scale: 1 });
    const scale = 1800 / Math.max(base.width, base.height);
    if (!Number.isFinite(scale) || scale <= 0 || base.width <= 0 || base.height <= 0) return null;
    const viewport = page.getViewport({ scale });
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null;
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const render = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
    token.cancelRender = () => render.cancel();
    await render.promise;
    if (token.cancelled) return null;
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return image && !token.cancelled ? new Uint8Array(await image.arrayBuffer()) : null;
  } catch {
    // A damaged page does not prevent preserving the other pages and exact PDF.
    return null;
  } finally {
    token.cancelRender = null;
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    page?.cleanup();
  }
}

export async function extractPdf(pdf, onPage, checkActive) {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    checkActive?.();
    const page = await pdf.getPage(pageNumber);
    const visible = await omitClippedFigureText(page, await page.getTextContent(), pdfjs.OPS);
    const textLayer = await recoverCodeAsterisks(page, visible);
    const sums = await recoverInlineSummations(page, textLayer);
    const content = await recoverMathScripts(page, sums);
    checkActive?.();
    const [, bottom, , top] = page.view;
    pages.push({ pageNumber, height: top - bottom, lines: pageLines(content, page.view) });
    onPage?.(pageNumber, pdf.numPages);
  }
  const cleaned = filterRepeatedPageDecorations(pages);
  const blocks = [];
  const floatingIDs = new Set();
  const columnStarts = new Set();
  function appendFloating(group, pageNumber) {
    const extracted = blocksFromLines(group, pageNumber, blocks.length + 1, true);
    for (const block of extracted) floatingIDs.add(block.id);
    blocks.push(...extracted);
  }
  for (const page of cleaned) {
    const { pageNumber, lines } = page;
    const opening = pageNumber > 1 && openingFigure(lines, page.height);
    if (opening) {
      for (const group of pdfReadingGroups(opening.figure)) appendFloating(group, pageNumber);
    }
    let previousGroup;
    for (const group of pdfReadingGroups(opening ? opening.body : lines, page)) {
      const first = group[0], lastLeft = previousGroup?.at(-1);
      const columnTurn = first?.lane === 'right' && lastLeft?.lane === 'left' &&
        Math.abs(previousGroup[0].y - first.y) <= first.height && first.y - lastLeft.y >= 2 * first.height;
      const tableEnd = columnTurn && /\p{Ll}[-‐]$/u.test(lastLeft.text) ? bodyAfterColumnTable(group) : 0;
      if (tableEnd) appendFloating(group.slice(0, tableEnd), pageNumber);
      const groupBlocks = blocksFromLines(tableEnd ? group.slice(tableEnd) : group, pageNumber, blocks.length + 1, true);
      if (columnTurn && groupBlocks.length) columnStarts.add(groupBlocks[0].id);
      blocks.push(...groupBlocks);
      previousGroup = group;
    }
  }
  // Match the final Mac postProcessParagraphs and buildPaper/cleanExtractedText
  // passes after page stitching. Each pass is non-overlapping, not a fixed point.
  // Only newly extracted text is normalized; saved blocks/annotation offsets
  // and the original PDF bytes are never sent through this import pipeline.
  return stitchPageBlocks(blocks, { floatingIDs, columnStarts }).map(block => block.sourceMarkdown ? block : {
    ...block, text: finishExtractedPdfText(block.text)
  });
}
