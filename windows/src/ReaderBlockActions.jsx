import React, { useEffect, useId, useRef, useState } from 'react';
import { Bookmark, CircleEllipsis, Lightbulb, RotateCw } from 'lucide-react';
import './reader-block-actions.css';

export default function ReaderBlockActions({ block, busy, structured, isFirst, isLast, canTranslate, displayMode,
  onBookmark, onExplain, onTranslate, onEdit, onMergePrevious, onMergeNext, onReflow }) {
  const menuId = useId();
  const triggerId = `${menuId}-trigger`;
  const trigger = useRef(null);
  const menu = useRef(null);
  const focusLastItem = useRef(false);
  const typeahead = useRef({ value: '', at: 0 });
  const [open, setOpen] = useState(false);
  const heading = Boolean(block.heading);
  const menuLabel = heading ? 'Heading actions' : 'Paragraph actions';
  const structureDisabled = Boolean(busy || structured);
  const menuItems = () => [...(menu.current?.querySelectorAll('button[role="menuitem"]:not(:disabled)') || [])];

  function positionMenu() {
    const popup = menu.current, button = trigger.current;
    if (!popup?.matches(':popover-open') || !button) return;
    const margin = 8, gap = 5;
    const width = window.innerWidth, height = window.innerHeight;
    popup.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
    const anchor = button.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const left = Math.max(margin, Math.min(anchor.right - bounds.width, width - bounds.width - margin));
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - bounds.height;
    const top = below + bounds.height <= height - margin ? below
      : above >= margin ? above : Math.max(margin, Math.min(below, height - bounds.height - margin));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function closeMenu(restoreFocus = true) {
    if (menu.current?.matches(':popover-open')) menu.current.hidePopover();
    setOpen(false);
    typeahead.current = { value: '', at: 0 };
    if (restoreFocus && trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true });
  }

  function openMenu(last = false) {
    if (busy || !menu.current?.isConnected) return;
    focusLastItem.current = last;
    menu.current.showPopover();
    setOpen(true);
    positionMenu();
  }

  function choose(action) {
    // Restore the trigger before invoking an action so a newly opened editor or
    // inspector can take focus without a delayed menu callback stealing it back.
    closeMenu();
    action?.();
  }

  function handleMenuKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeMenu(); return;
    }
    if (event.key === 'Tab') {
      event.stopPropagation(); closeMenu(); return;
    }
    const items = menuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    let destination;
    if (event.key === 'ArrowDown') destination = items[(current + 1) % items.length];
    else if (event.key === 'ArrowUp') destination = items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length];
    else if (event.key === 'Home') destination = items[0];
    else if (event.key === 'End') destination = items.at(-1);
    else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const now = performance.now();
      const letter = event.key.toLocaleLowerCase();
      const previous = now - typeahead.current.at < 600 ? typeahead.current.value : '';
      const value = previous && [...previous].every(character => character === letter) ? letter : previous + letter;
      typeahead.current = { value, at: now };
      destination = [...items.slice(current + 1), ...items.slice(0, current + 1)]
        .find(item => item.textContent.trim().toLocaleLowerCase().startsWith(value));
    } else return;
    event.preventDefault(); event.stopPropagation();
    destination?.focus();
  }

  useEffect(() => {
    if (busy) closeMenu(false);
  }, [busy]);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open]);

  return <div className={`reader-block-actions ${heading ? 'heading-actions' : ''}`} onClick={event => event.stopPropagation()}>
    {heading && canTranslate && block.status !== 'ok' && displayMode !== 'source' &&
      <button type="button" className="reader-heading-translate" title={block.status === 'failed' ? 'Retry heading' : 'Translate heading'}
        disabled={Boolean(busy)} onClick={onTranslate}>{block.status === 'failed' ? 'Retry Heading' : 'Translate Heading'}</button>}
    {!heading && canTranslate && block.status === 'failed' &&
      <button type="button" className="mini-action reader-paragraph-retry" title="Retry this paragraph" aria-label="Retry this paragraph"
        disabled={Boolean(busy)} onClick={onTranslate}><RotateCw size={15} aria-hidden="true" /></button>}
    <button type="button" className={`mini-action ${block.bookmark ? 'bookmarked' : ''}`} title={heading ? 'Bookmark heading' : 'Bookmark'}
      aria-label={heading ? 'Bookmark heading' : 'Bookmark'} aria-pressed={Boolean(block.bookmark)} onClick={onBookmark}>
      <Bookmark size={15} fill={block.bookmark ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
    {!heading && <button type="button" className="mini-action" title="Explain full paragraph" aria-label="Explain full paragraph"
      disabled={Boolean(block.resource)} onClick={onExplain}><Lightbulb size={15} aria-hidden="true" /></button>}
    <button ref={trigger} id={triggerId} type="button" className="mini-action reader-actions-trigger" title={menuLabel} aria-label={menuLabel}
      aria-haspopup="menu" aria-controls={menuId} aria-expanded={open} disabled={Boolean(busy)} popoverTarget={menuId}
      onClick={() => { focusLastItem.current = false; }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation(); openMenu(event.key === 'ArrowUp');
        }
      }}><CircleEllipsis size={17} aria-hidden="true" /></button>
    <div ref={menu} id={menuId} className="reader-actions-menu" popover="auto" role="menu" aria-labelledby={triggerId} tabIndex={-1}
      onKeyDown={handleMenuKey} onToggle={event => {
        const next = event.newState === 'open';
        setOpen(next);
        if (next) {
          positionMenu();
          requestAnimationFrame(() => {
            if (!menu.current?.matches(':popover-open')) return;
            positionMenu();
            const items = menuItems();
            ((focusLastItem.current ? items.at(-1) : items[0]) || menu.current)?.focus({ preventScroll: true });
            focusLastItem.current = false;
          });
        } else {
          typeahead.current = { value: '', at: 0 };
          // Light dismissal may already have focused the clicked outside control.
          if (event.currentTarget.contains(document.activeElement) && !trigger.current?.disabled) trigger.current?.focus({ preventScroll: true });
        }
      }}>
      {heading
        ? <button type="button" role="menuitem" tabIndex={-1} disabled={Boolean(block.resource)} onClick={() => choose(onExplain)}>Explain Heading</button>
        : canTranslate && <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onTranslate)}>Translate This Paragraph</button>}
      <button type="button" role="menuitem" tabIndex={-1} disabled={structureDisabled} onClick={() => choose(onEdit)}>{heading ? 'Edit or Split' : 'Edit or Split...'}</button>
      {!heading && <div role="separator" />}
      <button type="button" role="menuitem" tabIndex={-1} disabled={Boolean(structureDisabled || isFirst)} onClick={() => choose(onMergePrevious)}>Merge with Previous</button>
      <button type="button" role="menuitem" tabIndex={-1} disabled={Boolean(structureDisabled || isLast)} onClick={() => choose(onMergeNext)}>Merge with Next</button>
      {!heading && <button type="button" role="menuitem" tabIndex={-1} disabled={structureDisabled} onClick={() => choose(onReflow)}>Reflow at Full Sentences</button>}
    </div>
  </div>;
}
