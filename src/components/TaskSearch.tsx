import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { agentApi, type SearchHit, type SessionSummary } from '../agent';
import { useI18n, type T } from '../i18n';
import { Icon } from './Icon';

/**
 * ⌘K: find a task by its title or by what was said in it, like Claude's chat
 * search. With nothing typed it lists recent tasks; arrows move, Enter opens,
 * Escape closes.
 */
export function TaskSearch({ recent, onOpen, onClose }: { recent: SessionSummary[]; onOpen: (id: string) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim();

  useEffect(() => {
    setHits(null);
    if (!q) return;
    let gone = false;
    const id = setTimeout(() => {
      agentApi
        .search(q)
        .then((h) => !gone && setHits(h))
        .catch(() => !gone && setHits([]));
    }, 120);
    return () => {
      gone = true;
      clearTimeout(id);
    };
  }, [q]);

  const rows: SearchHit[] = q ? (hits ?? []) : recent;
  useEffect(() => setActive(0), [q, hits]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (id: string) => {
    onOpen(id);
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && rows[active]) {
      e.preventDefault();
      open(rows[active].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal aria-label={t('nav.search')}>
        <label className="palette-input">
          <Icon name="search" className="size-[17px]" />
          <input
            autoFocus
            value={query}
            placeholder={t('search.placeholder')}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="task-search-results"
            aria-activedescendant={rows[active] ? `task-hit-${rows[active].id}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </label>
        <div ref={list} className="palette-list" role="listbox" id="task-search-results">
          {!q && rows.length > 0 && <b className="palette-head">{t('nav.recent')}</b>}
          {rows.map((h, i) => (
            <button
              key={h.id}
              id={`task-hit-${h.id}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              className="palette-row"
              onPointerMove={() => setActive(i)}
              onClick={() => open(h.id)}
            >
              <span className="palette-row-main">
                <span className="palette-title">
                  {h.pinned && <Icon name="pin" className="size-3.5" />}
                  <span className="truncate">
                    <Highlight text={h.title || t('agent.untitled')} q={q} />
                  </span>
                </span>
                {h.snippet && (
                  <span className="palette-snippet">
                    <Highlight text={h.snippet} q={q} />
                  </span>
                )}
              </span>
              {h.archived && <span className="palette-tag">{t('search.archived')}</span>}
              <span className="palette-when">{when(h.updated_at, lang, t)}</span>
            </button>
          ))}
          {q && hits?.length === 0 && <p className="palette-empty">{t('search.none', { q })}</p>}
        </div>
        <div className="palette-foot">{t('search.hint')}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Marks every case-insensitive occurrence of `q` in `text`. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const key = q.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(key); at >= 0; at = lower.indexOf(key, from)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + key.length)}</mark>);
    from = at + key.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** Today's tasks show the time, yesterday's say so, older ones the date. */
function when(at: number, lang: string, t: T): string {
  const d = new Date(at * 1000);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(new Date()) - day(d)) / 86_400_000);
  const locale = lang.startsWith('zh') ? 'zh-CN' : 'en-US';
  if (ago === 0) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (ago === 1) return t('search.yesterday');
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
