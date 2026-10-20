import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUp } from 'lucide-react';
import './IdeaNotebook.css';

export function IdeaNotebook({ index, count, disabled, onPageChange, children }: {
  index: number; count: number; disabled: boolean; onPageChange: (index: number) => void; children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<{ content: ReactNode; direction: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lockedUntil = useRef(0);

  function turn(next: number) {
    if (disabled || next < 0 || next >= count || next === index || Date.now() < lockedUntil.current) return;
    lockedUntil.current = Date.now() + 360;
    setLeaving({ content: children, direction: next > index ? 'forward' : 'back' });
    onPageChange(next);
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
    const canTurn = (step: number) => !disabled && index + step >= 0 && index + step < count;
    const canScrollNote = (step: number) => {
      const note = node.querySelector<HTMLElement>('.notebook-current .focus-note');
      return !!note && (step > 0 ? note.scrollTop + note.clientHeight < note.scrollHeight - 2 : note.scrollTop > 2);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const step = Math.sign(event.deltaY);
      if (!step || canScrollNote(step) || !canTurn(step)) return;
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
      if (!touch.scrolling && canTurn(Math.sign(dy)) && event.cancelable) event.preventDefault();
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
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('touchstart', touchStart, { passive: true });
    node.addEventListener('touchmove', touchMove, { passive: false });
    node.addEventListener('touchend', touchEnd);
    node.addEventListener('touchcancel', touchCancel);
    return () => {
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('touchstart', touchStart);
      node.removeEventListener('touchmove', touchMove);
      node.removeEventListener('touchend', touchEnd);
      node.removeEventListener('touchcancel', touchCancel);
    };
  });

  return <div className="idea-notebook">
    <div className="notebook-binding" aria-hidden="true">{Array.from({ length: 11 }, (_, i) => <span key={i}/>)}</div>
    <div className="notebook-viewport" ref={viewport} tabIndex={0} role="group" aria-label="Idea notebook" aria-describedby="notebook-instructions"
      onKeyDown={event => {
        if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
        const next = event.key === 'ArrowDown' || event.key === 'PageDown' ? index + 1
          : event.key === 'ArrowUp' || event.key === 'PageUp' ? index - 1 : event.key === 'Home' ? 0 : null;
        if (next !== null) { event.preventDefault(); turn(next); }
      }}>
      <div className="notebook-sheet notebook-current" key={index}>{children}</div>
      {leaving && <div className={`notebook-sheet notebook-leaving notebook-${leaving.direction}`} aria-hidden="true" inert>{leaving.content}</div>}
    </div>
    <div className="notebook-navigation">
      <button className="notebook-turn" aria-label="Previous idea" disabled={disabled || index === 0} onClick={() => turn(index - 1)}><ChevronUp size={18}/></button>
      <span aria-live="polite" aria-atomic="true">Idea {index + 1} of {count}<small>{index === 0 ? 'Highest priority' : `Priority order · ${index + 1}`}</small></span>
      <button className="notebook-turn" aria-label="Next idea" disabled={disabled || index === count - 1} onClick={() => turn(index + 1)}><ChevronDown size={18}/></button>
    </div>
    <div className="notebook-hint"><span id="notebook-instructions">Swipe or scroll up / down to flip pages</span>{index > 0 && <button disabled={disabled} onClick={() => turn(0)}><ChevronsUp size={14}/> Back to top</button>}</div>
  </div>;
}
