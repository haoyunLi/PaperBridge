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
