import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

/** A wide sheet for forms and longer content; Escape or the backdrop closes it. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'sheet-wide' : ''}`} role="dialog" aria-modal aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="sheet-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" className="size-4" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
