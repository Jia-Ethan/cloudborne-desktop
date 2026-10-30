import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionSummary } from '../agent';
import { errorText } from '../api';
import { useI18n } from '../i18n';
import type { Agent } from '../useAgent';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

/** Where a task's menu opens: at the pointer (right-click) or under its ⋯ button. */
type MenuAt = { id: string; x: number; y: number };
type Action = 'pin' | 'rename' | 'archive' | 'delete';

/**
 * The sidebar's task list, after Claude's: pinned tasks on top, then recent
 * ones; archived tasks fold into a row at the bottom. Each task has a ⋯
 * button on hover and the same menu on right-click (pin, rename, archive,
 * delete). Delete asks first; double-clicking a title renames it in place.
 */
export function TaskList({
  agent,
  active,
  onOpen,
  onToast,
}: {
  agent: Agent;
  /** The task on screen, if the task page is showing. */
  active: string | null;
  onOpen: (id: string) => void;
  onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (agent.summaries.length === 0) return null;
  const listed = agent.summaries.filter((s) => !s.archived);
  const pinned = listed.filter((s) => s.pinned);
  const recent = listed.filter((s) => !s.pinned);
  const archived = agent.summaries.filter((s) => s.archived);
  const fail = (e: unknown) => onToast(errorText(e, t('common.genericError')));
  const label = (s: SessionSummary) => s.title || t('agent.untitled');

  const act = (s: SessionSummary, what: Action) => {
    setMenu(null);
    if (what === 'pin') agent.update(s.id, { pinned: !s.pinned }).catch(fail);
    else if (what === 'rename') setRenaming(s.id);
    else if (what === 'delete') setDeleting(s);
    else if (s.archived) agent.update(s.id, { archived: false }).catch(fail);
    else {
      agent.update(s.id, { archived: true }).then(() => onToast(t('agent.archivedToast', { title: label(s) })), fail);
      if (active === s.id) agent.select(null);
    }
  };

  const row = (s: SessionSummary) => (
    <div
      key={s.id}
      className={`recent-item ${active === s.id ? 'selected' : ''} ${s.archived ? 'archived' : ''} ${menu?.id === s.id ? 'menu-open' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ id: s.id, x: e.clientX, y: e.clientY });
      }}
    >
      {renaming === s.id ? (
        <RenameField
          title={label(s)}
          onDone={(title) => {
            setRenaming(null);
            if (title !== null && title.trim() && title.trim() !== s.title) agent.update(s.id, { title: title.trim() }).catch(fail);
          }}
        />
      ) : (
        <>
          <button className="recent-open" onClick={() => onOpen(s.id)} onDoubleClick={() => setRenaming(s.id)}>
            {agent.isRunning(s.id) ? <span className="recent-live" /> : agent.isUnread(s.id) && <span className="recent-unread" title={t('agent.unread')} />}
            <span className="truncate">{label(s)}</span>
          </button>
          <button
            className="recent-more"
            data-task-more={s.id}
            aria-label={t('agent.more')}
            title={t('agent.more')}
            aria-haspopup="menu"
            aria-expanded={menu?.id === s.id}
            onClick={(e) => {
              if (menu?.id === s.id) return setMenu(null);
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ id: s.id, x: r.left, y: r.bottom + 4 });
            }}
          >
            <Icon name="more" className="size-4" />
          </button>
        </>
      )}
    </div>
  );

  const target = menu && agent.summaries.find((s) => s.id === menu.id);
  return (
    <div className="recent">
      {pinned.length > 0 && (
        <>
          <b>{t('nav.pinned')}</b>
          {pinned.map(row)}
        </>
      )}
      {recent.length > 0 && (
        <>
          <b className={pinned.length ? 'recent-gap' : ''}>{t('nav.recent')}</b>
          {recent.map(row)}
        </>
      )}
      {archived.length > 0 && (
        <>
          <button className="recent-archived" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <Icon name="archive" className="size-3.5" />
            <span className="flex-1">{t('agent.archivedCount', { n: archived.length })}</span>
            <Icon name="chevronDown" className="recent-archived-chevron size-3" />
          </button>
          {showArchived && archived.map(row)}
        </>
      )}
      {menu && target && <TaskMenu at={menu} task={target} onClose={() => setMenu(null)} onPick={(a) => act(target, a)} />}
      {deleting && (
        <Dialog
          title={t('agent.deleteTitle')}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setDeleting(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-danger"
                autoFocus
                onClick={() => {
                  agent.remove(deleting.id);
                  setDeleting(null);
                }}
              >
                {t('agent.delete')}
              </button>
            </>
          }
        >
          <p className="task-delete-note">{t('agent.deleteBody', { title: label(deleting) })}</p>
        </Dialog>
      )}
    </div>
  );
}

function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => input.current?.select(), []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(keep ? value : null);
  };
  return (
    <input
      ref={input}
      className="recent-rename"
      value={value}
      maxLength={80}
      autoFocus
      aria-label={t('agent.rename')}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

/** A glass menu at a fixed point, kept inside the window; arrows move between items. */
function TaskMenu({ at, task, onClose, onPick }: { at: MenuAt; task: SessionSummary; onClose: () => void; onPick: (a: Action) => void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8));
    const top = at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y;
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>('.menu-item')?.focus();
  }, [at]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element;
      // Its own ⋯ button toggles the menu in its click handler.
      if (box.current?.contains(el) || el.closest?.(`[data-task-more="${at.id}"]`)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    const onLeave = () => close.current();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', onLeave);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', onLeave);
    };
  }, [at.id]);

  return createPortal(
    <div ref={box} className="menu task-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {!task.archived && (
        <button className="menu-item" role="menuitem" onClick={() => onPick('pin')}>
          <Icon name="pin" className="size-4" />
          {t(task.pinned ? 'agent.unpin' : 'agent.pin')}
        </button>
      )}
      <button className="menu-item" role="menuitem" onClick={() => onPick('rename')}>
        <Icon name="edit" className="size-4" />
        {t('agent.rename')}
      </button>
      <button className="menu-item" role="menuitem" onClick={() => onPick('archive')}>
        <Icon name={task.archived ? 'unarchive' : 'archive'} className="size-4" />
        {t(task.archived ? 'agent.unarchive' : 'agent.archive')}
      </button>
      <div className="menu-sep" />
      <button className="menu-item danger" role="menuitem" onClick={() => onPick('delete')}>
        <Icon name="trash" className="size-4" />
        {t('agent.delete')}
      </button>
    </div>,
    document.body,
  );
}
