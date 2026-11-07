import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { blocksFromLines } from './text.mjs';
import { filterRepeatedPageDecorations, stitchPageBlocks } from './pdfDecorations.mjs';
import { pageLines, pdfReadingGroups } from './pdfLayout.mjs';

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
    const viewport = page.getViewport({ scale: Math.min(1.5, 1800 / Math.max(base.width, base.height)) });
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
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
    const content = await page.getTextContent();
    checkActive?.();
    const [, bottom, , top] = page.view;
    pages.push({ pageNumber, height: top - bottom, lines: pageLines(content, page.view) });
    onPage?.(pageNumber, pdf.numPages);
  }
  const cleaned = filterRepeatedPageDecorations(pages);
  const blocks = [];
  for (const { pageNumber, lines } of cleaned) {
    for (const group of pdfReadingGroups(lines)) {
      blocks.push(...blocksFromLines(group, pageNumber, blocks.length + 1, true));
    }
  }
  return stitchPageBlocks(blocks);
}
