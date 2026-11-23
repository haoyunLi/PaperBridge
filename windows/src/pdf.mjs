import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { blocksFromLines, finishExtractedPdfText } from './text.mjs';
import { omitClippedFigureText } from './pdfFigureText.mjs';
import { filterRepeatedPageDecorations, stitchPageBlocks } from './pdfDecorations.mjs';
import { openingFigure, pageLines, pdfReadingGroups, recoverCodeAsterisks, recoverInlineSummations } from './pdfLayout.mjs';

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
    const content = await recoverInlineSummations(page, textLayer);
    checkActive?.();
    const [, bottom, , top] = page.view;
    pages.push({ pageNumber, height: top - bottom, lines: pageLines(content, page.view) });
    onPage?.(pageNumber, pdf.numPages);
  }
  const cleaned = filterRepeatedPageDecorations(pages);
  const blocks = [];
  const openingFigureIDs = new Set();
  for (const page of cleaned) {
    const { pageNumber, lines } = page;
    const opening = pageNumber > 1 && openingFigure(lines, page.height);
    if (opening) {
      for (const group of pdfReadingGroups(opening.figure)) {
        const figureBlocks = blocksFromLines(group, pageNumber, blocks.length + 1, true);
        for (const block of figureBlocks) openingFigureIDs.add(block.id);
        blocks.push(...figureBlocks);
      }
    }
    for (const group of pdfReadingGroups(opening ? opening.body : lines, page)) {
      blocks.push(...blocksFromLines(group, pageNumber, blocks.length + 1, true));
    }
  }
  // Match the final Mac postProcessParagraphs and buildPaper/cleanExtractedText
  // passes after page stitching. Each pass is non-overlapping, not a fixed point.
  // Only newly extracted text is normalized; saved blocks/annotation offsets
  // and the original PDF bytes are never sent through this import pipeline.
  return stitchPageBlocks(blocks, openingFigureIDs).map(block => block.sourceMarkdown ? block : {
    ...block, text: finishExtractedPdfText(block.text)
  });
}
