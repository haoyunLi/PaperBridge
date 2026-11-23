import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { documentLinkTarget, revealMarkdownTarget } from './markdownLinks.mjs';

export function usePaperAttachment(paperRef, modal, setModal, setError) {
  const [entry, setEntry] = useState(null);
  const [error, setAttachmentError] = useState('');
  const trigger = useRef(null);
  const history = useRef([]);
  const request = useRef(0);
  const owner = paperRef.current?.id;

  useEffect(() => {
    if (modal === 'attachment' && entry?.owner !== owner) setModal('');
  }, [modal, entry?.owner, owner, setModal]);

  useEffect(() => {
    if (modal === 'attachment') return;
    request.current++;
    history.current = [];
    setEntry(null);
    setAttachmentError('');
  }, [modal]);

  async function visit(link, href, from, previous) {
    const owner = paperRef.current?.id;
    const token = ++request.current;
    setAttachmentError('');
    try {
      const next = await window.paperBridge.openPaperAttachment(owner, href, from);
      if (request.current !== token || paperRef.current?.id !== owner || !link.isConnected || link.closest('[inert]')) return;
      if (next.kind === 'pdf') return;
      if (!from && !previous) trigger.current = link;
      if (previous) history.current.pop();
      else if (from && entry) history.current.push({ path: entry.path, y: link.closest('.modal-body')?.scrollTop || 0, link: href });
      setEntry({ ...next, previous, owner });
      setModal('attachment');
    } catch (cause) {
      if (request.current !== token || paperRef.current?.id !== owner || !link.isConnected || link.closest('[inert]')) return;
      const message = cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
      if (from || previous) setAttachmentError(message);
      else setError(message);
    }
  }

  function click(event) {
    if (event.defaultPrevented || event.button > 1) return;
    const link = event.target.closest?.('[data-markdown-host] a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (!href || /^(?:[\\/#?]|[a-z][a-z0-9+.-]*:)/i.test(href)) return;
    const panel = link.closest('[data-attachment-path]');
    if (!panel && !link.closest('[data-reading-paper-id]')?.dataset.readingPaperId) return;
    const selection = window.getSelection();
    if (event.detail > 0 && !selection?.isCollapsed && selection?.containsNode(link, true)) return;
    void visit(link, href, panel?.dataset.attachmentPath || '');
  }

  function back(event) {
    const previous = history.current.at(-1);
    if (previous) void visit(event.currentTarget, previous.path.split('/').map(encodeURIComponent).join('/'), '', previous);
  }

  return { entry, error, click, back, trigger, canGoBack: history.current.length > 0 };
}

export function PaperAttachment({ attachment, Markdown }) {
  const content = useRef(null);
  const { entry, error, back, canGoBack } = attachment;
  useLayoutEffect(() => {
    const panel = content.current;
    if (!panel || !entry) return;
    const frame = requestAnimationFrame(() => {
      const scroll = panel.closest('.modal-body');
      if (entry.previous) {
        scroll.scrollTop = entry.previous.y;
        const link = [...panel.querySelectorAll('a[href]')].find(node => node.getAttribute('href') === entry.previous.link);
        link?.focus({ preventScroll: true });
      } else {
        scroll.scrollTop = 0;
        const host = panel.querySelector('[data-markdown-host]');
        const target = host && entry.fragment && documentLinkTarget(host, entry.fragment);
        if (target) {
          revealMarkdownTarget(target);
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: 'start' });
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [entry]);
  if (!entry) return null;
  return <section ref={content} className="paper-attachment" data-attachment-path={entry.path}>
    {canGoBack && <button type="button" className="button outline" onClick={back}>Back</button>}
    {error && <p role="alert">{error}</p>}
    {entry.kind === 'image' ? <img src={entry.content} alt={entry.name} />
      : entry.kind === 'markdown' ? <Markdown>{entry.content}</Markdown> : <pre>{entry.content}</pre>}
  </section>;
}
