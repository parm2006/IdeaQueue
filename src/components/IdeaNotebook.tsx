import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronsUp } from 'lucide-react';
import type { BucketColor } from '../lib/queue';
import './IdeaNotebook.css';

export function IdeaNotebook({ index, count, nextColors, disabled, onPageChange, children }: {
  index: number; count: number; nextColors: BucketColor[]; disabled: boolean; onPageChange: (index: number) => void; children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<{ content: ReactNode; direction: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lockedUntil = useRef(0);

  function turn(next: number) {
    const page = (next + count) % count;
    if (disabled || count < 2 || page === index || Date.now() < lockedUntil.current) return;
    lockedUntil.current = Date.now() + 360;
    setLeaving({ content: children, direction: next > index ? 'forward' : 'back' });
    onPageChange(page);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLeaving(null), 340);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let wheelDistance = 0;
    let lastWheel = 0;
    let touch: { x: number; y: number; scrolling: boolean } | null = null;
    const canTurn = () => !disabled && count > 1;
    const canScrollNote = (step: number) => {
      const note = node.querySelector<HTMLElement>('.notebook-current .focus-note');
      return !!note && (step > 0 ? note.scrollTop + note.clientHeight < note.scrollHeight - 2 : note.scrollTop > 2);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const step = Math.sign(event.deltaY);
      if (!step || canScrollNote(step) || !canTurn()) return;
      event.preventDefault();
      if (Date.now() < lockedUntil.current) return;
      if (Date.now() - lastWheel > 180 || Math.sign(wheelDistance) !== step) wheelDistance = 0;
      lastWheel = Date.now();
      wheelDistance += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      if (Math.abs(wheelDistance) >= 45) { wheelDistance = 0; turn(index + step); }
    };
    const touchStart = (event: TouchEvent) => {
      touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY, scrolling: false } : null;
    };
    const touchMove = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) { touch = null; return; }
      const dy = touch.y - event.touches[0].clientY;
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(touch.x - event.touches[0].clientX)) return;
      if (canScrollNote(Math.sign(dy))) touch.scrolling = true;
      if (!touch.scrolling && canTurn() && event.cancelable) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      if (touch && !touch.scrolling && event.changedTouches.length) {
        const dy = touch.y - event.changedTouches[0].clientY;
        const dx = touch.x - event.changedTouches[0].clientX;
        if (Math.abs(dy) >= 45 && Math.abs(dy) > Math.abs(dx) * 1.3) turn(index + Math.sign(dy));
      }
      touch = null;
    };
    const touchCancel = () => { touch = null; };
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [role="menu"], [contenteditable]:not([contenteditable="false"])')) return;
      const next = event.key === 'ArrowDown' || event.key === 'PageDown' ? index + 1
        : event.key === 'ArrowUp' || event.key === 'PageUp' ? index - 1 : event.key === 'Home' ? 0 : null;
      if (next !== null && canTurn()) { event.preventDefault(); turn(next); }
    };
    window.addEventListener('keydown', keyDown);
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('touchstart', touchStart, { passive: true });
    node.addEventListener('touchmove', touchMove, { passive: false });
    node.addEventListener('touchend', touchEnd);
    node.addEventListener('touchcancel', touchCancel);
    return () => {
      window.removeEventListener('keydown', keyDown);
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('touchstart', touchStart);
      node.removeEventListener('touchmove', touchMove);
      node.removeEventListener('touchend', touchEnd);
      node.removeEventListener('touchcancel', touchCancel);
    };
  });

  return <div className="idea-notebook">
    <div className="notebook-binding" aria-hidden="true">{Array.from({ length: 11 }, (_, i) => <svg key={i} viewBox="0 0 28 54">
      <defs><linearGradient id={`wire-${i}`} x1="0" x2="1" y1="0" y2="0"><stop stopColor="#514b35"/><stop offset=".3" stopColor="#efead4"/><stop offset=".55" stopColor="#b9ac79"/><stop offset=".8" stopColor="#fcf8e8"/><stop offset="1" stopColor="#746b49"/></linearGradient></defs>
      <rect x="4" y="37" width="20" height="10" rx="3" fill="#5e563d" opacity=".6"/>
      <path d="M8 43C2 42 3 7 7 4C14-2 16 13 15 25L14 42M17 43C11 42 12 7 16 4C23-2 25 13 24 25L23 42" fill="none" stroke="#655d41" strokeWidth="4.2" strokeLinecap="round"/>
      <path d="M8 43C2 42 3 7 7 4C14-2 16 13 15 25L14 42M17 43C11 42 12 7 16 4C23-2 25 13 24 25L23 42" fill="none" stroke={`url(#wire-${i})`} strokeWidth="2.7" strokeLinecap="round"/>
    </svg>)}</div>
    <div className="notebook-viewport" ref={viewport} tabIndex={0} role="group" aria-label="Idea notebook">
      <div className="notebook-preview-pages" aria-hidden="true">{nextColors.map((color, i) => <div key={i} className={`notebook-preview note-${color}`}/>)}</div>
      <div className="notebook-sheet notebook-current" key={index}>{children}</div>
      {leaving && <div className={`notebook-sheet notebook-leaving notebook-${leaving.direction}`} aria-hidden="true" inert>{leaving.content}</div>}
    </div>
    <div className="notebook-return">{index > 0 && <button disabled={disabled} onClick={() => turn(0)}><ChevronsUp size={14}/> Back to top</button>}</div>
  </div>;
}
