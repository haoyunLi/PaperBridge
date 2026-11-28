import { externalPaperURL } from '../electron/paper-link.mjs';

export function pageLinks(annotations, viewport) {
  const links = [];
  for (const item of annotations) {
    // PDF annotation flags 1, 2 and 32 suppress screen interaction.
    if (item.subtype !== 'Link' || (item.annotationFlags & (1 | 2 | 32)) || !Array.isArray(item.rect) ||
        item.rect.length !== 4 || !item.rect.every(Number.isFinite)) continue;
    const url = externalPaperURL(item.url);
    const dest = item.dest;
    if (!url && typeof dest !== 'string' && !Array.isArray(dest)) continue;
    const [x1, y1] = viewport.convertToViewportPoint(item.rect[0], item.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(item.rect[2], item.rect[3]);
    const left = Math.max(0, Math.min(x1, x2) / viewport.width), top = Math.max(0, Math.min(y1, y2) / viewport.height);
    const right = Math.min(1, Math.max(x1, x2) / viewport.width), bottom = Math.min(1, Math.max(y1, y2) / viewport.height);
    if (right <= left || bottom <= top) continue;
    const label = item.contentsObj?.str?.trim() || item.titleObj?.str?.trim() || url || 'Go to linked PDF location';
    links.push({ id: item.id, label, url, dest, left, top, right, bottom });
  }
  return links;
}

export async function pdfLinkDestination(pdf, destination) {
  const dest = typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
  if (!Array.isArray(dest) || dest.length < 2) return null;
  const index = typeof dest[0] === 'object' && dest[0] ? await pdf.getPageIndex(dest[0]) : dest[0];
  if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) return null;
  const page = await pdf.getPage(index + 1), viewport = page.getViewport({ scale: 1 });
  const [left, bottom, right, top] = page.view;
  const fit = dest[1]?.name;
  let x = left, y = top, region = null, point;
  if (fit === 'XYZ') {
    if (Number.isFinite(dest[2])) x = dest[2];
    if (Number.isFinite(dest[3])) y = dest[3];
  } else if (fit === 'FitH' || fit === 'FitBH') {
    if (Number.isFinite(dest[2])) y = dest[2];
  } else if (fit === 'FitV' || fit === 'FitBV') {
    if (Number.isFinite(dest[2])) x = dest[2];
  } else if (fit === 'FitR' && dest.slice(2, 6).length === 4 && dest.slice(2, 6).every(Number.isFinite)) {
    const [a, b] = viewport.convertToViewportPoint(dest[2], dest[3]);
    const [c, d] = viewport.convertToViewportPoint(dest[4], dest[5]);
    region = { width: Math.abs(c - a), height: Math.abs(d - b) };
    point = [Math.min(a, c), Math.min(b, d)];
  } else if (fit === 'Fit' || fit === 'FitB') point = [0, 0];
  else return null;
  const [px, py] = point || viewport.convertToViewportPoint(Math.max(left, Math.min(right, x)), Math.max(bottom, Math.min(top, y)));
  return { page: index + 1, x: px, y: py, width: viewport.width, height: viewport.height, fit, region,
    scale: fit === 'XYZ' && Number.isFinite(dest[4]) && dest[4] > 0 ? dest[4] : null };
}
