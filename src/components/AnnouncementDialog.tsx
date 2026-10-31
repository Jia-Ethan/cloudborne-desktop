import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { displayTitle, formatDay, isUnread, newestFirst, startOf, unreadCount, type Announcement } from '../announcements';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { Markdown } from './Markdown';

/** Below this width the dialog shows the list or one announcement, not both. */
const NARROW = '(max-width: 879px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * Announcements, after the web console's dialog: the selected one's Markdown
 * on the left, every announcement by date on the right; a narrow window shows
 * one column at a time. An unread announcement is reported through `onView`
 * once its text is on screen. Opened with `startId` (the sign-in popup) it
 * shows that one; opened from the bell on a narrow window it shows the list.
 */
export function AnnouncementDialog({
  open,
  items,
  startId,
  onClose,
  onView,
  onReadAll,
}: {
  open: boolean;
  items: Announcement[];
  startId: number | null;
  onClose: () => void;
  onView: (id: number) => void;
  onReadAll: () => void;
}) {
  const { t, lang } = useI18n();
  const sorted = useMemo(() => newestFirst(items), [items]);
  const narrow = useNarrow();
  // Kept on screen while the closing fade plays.
  const [phase, setPhase] = useState<'closed' | 'open' | 'leaving'>('closed');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [column, setColumn] = useState<'list' | 'detail'>('detail');
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const reported = useRef(new Set<number>());

  const showList = sorted.length > 1;
  const oneColumn = narrow && showList;
  const selected = sorted.find((a) => a.id === selectedId) ?? sorted[0] ?? null;

  // The start is picked when the dialog opens; later list refreshes keep the selection.
  useEffect(() => {
    if (open) {
      setSelectedId(startOf(sorted, startId)?.id ?? null);
      setColumn(startId != null || !showList ? 'detail' : 'list');
      returnFocus.current = document.activeElement as HTMLElement | null;
      setPhase('open');
    } else setPhase((p) => (p === 'closed' ? p : 'leaving'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'open') panel.current?.focus({ preventScroll: true });
    if (phase === 'leaving') {
      // In case the fade never reports its end (hidden window, no animation).
      const id = setTimeout(() => setPhase('closed'), 400);
      return () => clearTimeout(id);
    }
    if (phase === 'closed') {
      reported.current.clear();
      returnFocus.current?.focus?.();
      returnFocus.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open' || !selected || !isUnread(selected) || reported.current.has(selected.id)) return;
    if (oneColumn && column === 'list') return;
    reported.current.add(selected.id);
    onView(selected.id);
  }, [phase, selected, oneColumn, column, onView]);

  useEffect(() => {
    if (phase !== 'open') return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  if (phase === 'closed') return null;

  // Tab stays inside the dialog.
  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const [first, last] = [focusable[0], focusable[focusable.length - 1]];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const select = (id: number) => {
    setSelectedId(id);
    setColumn('detail');
  };

  const unread = unreadCount(sorted);

  return createPortal(
    <div
      className={`ann-backdrop ${phase === 'leaving' ? 'leaving' : ''}`}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onAnimationEnd={(e) => e.target === e.currentTarget && phase === 'leaving' && setPhase('closed')}
    >
      <div
        ref={panel}
        className={`ann-panel ${showList ? '' : 'single'} ${oneColumn ? `one-column show-${column}` : ''}`}
        role="dialog"
        aria-modal
        aria-labelledby="ann-heading"
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <header className="ann-head">
          {oneColumn && column === 'detail' && (
            <button className="ann-icon-btn ann-back" aria-label={t('ann.back')} title={t('ann.back')} onClick={() => setColumn('list')}>
              <Icon name="chevronLeft" className="size-4" />
            </button>
          )}
          <h2 id="ann-heading">{t('ann.title')}</h2>
          <button className="ann-icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" className="size-4" />
          </button>
        </header>

        {!selected ? (
          <div className="ann-empty">
            <Icon name="inbox" className="size-7" />
            <p>{t('ann.empty')}</p>
          </div>
        ) : (
          <div className="ann-body">
            <article className="ann-detail" aria-label={displayTitle(selected.title)}>
              <div key={selected.id} className="ann-scroll">
                <time dateTime={selected.created_at}>{formatDay(selected.created_at, lang)}</time>
                <h3>{displayTitle(selected.title)}</h3>
                <div className="ann-md">
                  <Markdown text={selected.content} />
                </div>
              </div>
              <footer className="ann-foot">
                <button className="btn btn-primary ann-ok" onClick={onClose}>
                  {t('ann.gotIt')}
                </button>
              </footer>
            </article>

            {showList && (
              <aside className="ann-list" aria-label={t('ann.all')}>
                <div className="ann-list-head">
                  <span>{t('ann.all')}</span>
                  {unread > 0 && <button onClick={onReadAll}>{t('ann.markAllRead')}</button>}
                </div>
                <ul>
                  {sorted.map((a) => (
                    <li key={a.id}>
                      <button
                        className={`ann-item ${a.id === selected.id ? 'active' : ''}`}
                        aria-current={a.id === selected.id ? 'true' : undefined}
                        onClick={() => select(a.id)}
                      >
                        {/* The unread dot sits by the date: a long title is clamped to two lines and would hide it. */}
                        <span className="ann-item-meta">
                          <time dateTime={a.created_at}>{formatDay(a.created_at, lang)}</time>
                          {isUnread(a) && (
                            <span className="ann-dot" title={t('ann.unread')}>
                              <span className="sr-only">{t('ann.unread')}</span>
                            </span>
                          )}
                        </span>
                        <span className="ann-item-title">{displayTitle(a.title)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
