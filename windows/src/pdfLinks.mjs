import { externalPaperURL } from '../electron/paper-link.mjs';

const namedLinks = new Map([
  ['FirstPage', 'First PDF page'], ['LastPage', 'Last PDF page'], ['NextPage', 'Next PDF page'],
  ['PrevPage', 'Previous PDF page'], ['GoBack', 'Previous reading location'], ['GoForward', 'Next reading location']
]);

const commentKinds = new Map([
  ['Text', 'PDF note'], ['Highlight', 'PDF highlight'], ['Underline', 'PDF underline'],
  ['StrikeOut', 'PDF strikethrough'], ['Squiggly', 'PDF squiggly underline']
]);

function pageArea(rect, viewport) {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const left = Math.max(0, Math.min(x1, x2) / viewport.width), top = Math.max(0, Math.min(y1, y2) / viewport.height);
  const right = Math.min(1, Math.max(x1, x2) / viewport.width), bottom = Math.min(1, Math.max(y1, y2) / viewport.height);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function linkAreas(points, viewport) {
  const areas = [];
  if (!points?.length || points.length % 8 !== 0) return areas;
  // PDF.js supplies one normalized quadrilateral per linked fragment.
  for (let i = 0; i < points.length; i += 8) {
    const area = pageArea([points[i], points[i + 1], points[i + 6], points[i + 7]], viewport);
    if (area) areas.push(area);
  }
  return areas;
}

export function pageLinks(annotations, viewport) {
  const links = [];
  for (const item of annotations) {
    // PDF annotation flags 1, 2 and 32 suppress screen interaction.
    if ((item.annotationFlags & (1 | 2 | 32)) || !Array.isArray(item.rect) ||
        item.rect.length !== 4 || !item.rect.every(Number.isFinite)) continue;
    const bounds = pageArea(item.rect, viewport);
    if (!bounds) continue;
    const fragments = linkAreas(item.quadPoints, viewport);
    const geometry = { ...bounds, areas: fragments.length ? fragments : [bounds] };
    if (item.subtype !== 'Link') {
      const kind = commentKinds.get(item.subtype), body = item.contentsObj?.str;
      if (!kind || !body?.trim()) continue;
      const author = item.titleObj?.str?.trim();
      const label = author ? kind + ' by ' + author : kind;
      links.push({ id: item.id, label, comment: { kind, body, author }, sticky: item.subtype === 'Text' && !item.hasAppearance, ...geometry });
      continue;
    }
    const url = externalPaperURL(item.url);
    const dest = item.dest;
    const action = namedLinks.has(item.action) ? item.action : null;
    if (!url && !action && typeof dest !== 'string' && !Array.isArray(dest)) continue;
    const label = item.contentsObj?.str?.trim() || item.titleObj?.str?.trim() || url || namedLinks.get(action) || 'Go to linked PDF location';
    links.push({ id: item.id, label, url, dest, action, ...geometry });
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
