import React, { useEffect, useRef, useState } from 'react';
import { pageLinks } from './pdfLinks.mjs';
import './pdf-links.css';

export function PdfPageLinks({ pdf, number, onFollow }) {
  const overlay = useRef(null);
  const follow = useRef(onFollow);
  follow.current = onFollow;
  const [links, setLinks] = useState([]);
  useEffect(() => {
    let active = true;
    setLinks([]);
    (async () => {
      const page = await pdf.getPage(number);
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (active) setLinks(pageLinks(annotations, page.getViewport({ scale: 1 })));
    })().catch(() => { /* Reading and selecting text remain available when an annotation is malformed. */ });
    return () => { active = false; };
  }, [pdf, number]);

  useEffect(() => {
    const layer = overlay.current;
    if (!layer || !links.length) return;
    const sheet = layer.parentElement;
    let pressed, over;
    function hit(event) {
      const box = layer.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
      return links.find(link => link.areas.some(area => x >= area.left && x <= area.right && y >= area.top && y <= area.bottom));
    }
    function show(link) {
      if (link === over) return;
      if (over) layer.children[links.indexOf(over)]?.classList.remove('hovered');
      over = link;
      sheet.classList.toggle('over-pdf-link', Boolean(link));
      if (link) layer.children[links.indexOf(link)]?.classList.add('hovered');
    }
    function move(event) { show(event.buttons ? null : hit(event)); }
    function leave() { show(null); }
    function down(event) { pressed = { link: hit(event), x: event.clientX, y: event.clientY }; }
    function click(event) {
      if (event.detail === 0 || event.button > 1 || event.defaultPrevented) return;
      const link = hit(event);
      if (!link || pressed?.link !== link || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5 ||
          !window.getSelection()?.isCollapsed) return;
      event.preventDefault();
      follow.current(link, number);
    }
    sheet.addEventListener('pointermove', move); sheet.addEventListener('pointerleave', leave);
    sheet.addEventListener('pointerdown', down); sheet.addEventListener('click', click); sheet.addEventListener('auxclick', click);
    return () => {
      show(null);
      sheet.removeEventListener('pointermove', move); sheet.removeEventListener('pointerleave', leave);
      sheet.removeEventListener('pointerdown', down); sheet.removeEventListener('click', click); sheet.removeEventListener('auxclick', click);
    };
  }, [links, number]);
  if (!links.length) return null;
  return <div ref={overlay} className="pdf-page-links">
    {links.map(link => <a key={link.id} href={link.url || '#pdf-destination'} aria-label={link.label} title={link.label}
      onClick={event => { event.preventDefault(); follow.current(link, number); }}
      style={{ left: link.left * 100 + '%', top: link.top * 100 + '%',
        width: (link.right - link.left) * 100 + '%', height: (link.bottom - link.top) * 100 + '%' }}>
      {link.areas.map((area, i) => <span key={i} style={{
        left: (area.left - link.left) / (link.right - link.left) * 100 + '%', top: (area.top - link.top) / (link.bottom - link.top) * 100 + '%',
        width: (area.right - area.left) / (link.right - link.left) * 100 + '%', height: (area.bottom - area.top) / (link.bottom - link.top) * 100 + '%'
      }} />)}
    </a>)}
  </div>;
}
