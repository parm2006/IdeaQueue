import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { Category } from '../lib/queue';

export function BucketMenu({ category, x, y, disabled, onDelete, onClose }: {
  category: Category; x: number; y: number; disabled: boolean; onDelete: () => void; onClose: () => void;
}) {
  const item = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    item.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('click', onClose);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('click', onClose);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  return <div className="bucket-menu" role="menu" aria-label={`${category} bucket options`}
    style={{ left: Math.max(8, Math.min(x, window.innerWidth - 208)), top: Math.max(8, Math.min(y, window.innerHeight - 60)) }}>
    <button ref={item} role="menuitem" disabled={disabled || category === 'General'} onClick={onDelete}><Trash2 size={15}/>{category === 'General' ? 'General is required' : 'Delete bucket…'}</button>
  </div>;
}
