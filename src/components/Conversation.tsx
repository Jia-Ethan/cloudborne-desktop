import { useEffect, useRef, useState, type ReactNode } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '../api';
import { toBlocks, type AgentItem, type Block, type Session, type Turn } from '../agent';
import { useI18n, type MessageKey } from '../i18n';
import { Icon, type IconName } from './Icon';
import { Markdown } from './Markdown';

/** Collapsible row: a quiet one-line summary that opens to the details. */
function Fold({
  icon,
  label,
  running,
  failed,
  children,
}: {
  icon: IconName;
  label: string;
  running?: boolean;
  failed?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fold ${open ? 'open' : ''} ${failed ? 'failed' : ''}`}>
      <button className="fold-head" disabled={!children} onClick={() => setOpen((o) => !o)}>
        <Icon name={icon} className="size-[15px]" />
        <b className={running ? 'shimmer' : ''}>{label}</b>
        {children && <Icon name="chevronDown" className="fold-chevron size-3.5" />}
      </button>
      {open && children && <div className="fold-body">{children}</div>}
    </div>
  );
}

type Cmd = Extract<AgentItem, { type: 'command_execution' }>;
type FileChange = Extract<AgentItem, { type: 'file_change' }>;

function Commands({ items }: { items: Cmd[] }) {
  const { t } = useI18n();
  const running = items.some((c) => c.status === 'in_progress');
  const failed = !running && items.some((c) => c.status === 'failed' || (c.exit_code ?? 0) !== 0);
  const label = running ? t('agent.cmdRunning') : items.length === 1 && failed ? t('agent.cmdFailed') : t('agent.cmdsDone', { n: items.length });
  return (
    <Fold icon="terminal" label={label} running={running} failed={failed}>
      {items.map((c) => (
        <div key={c.id} className="cmd">
          <code className="cmd-line">{c.command}</code>
          {c.aggregated_output.trim() && <pre className="cmd-output">{c.aggregated_output.trim()}</pre>}
        </div>
      ))}
    </Fold>
  );
}

function Files({ items }: { items: FileChange[] }) {
  const { t } = useI18n();
  const running = items.some((f) => f.status === 'in_progress');
  const changes = items.flatMap((f) => f.changes);
  const paths = new Set(changes.map((c) => c.path));
  return (
    <Fold
      icon="file"
      label={running ? t('agent.filesRunning') : t('agent.filesDone', { n: paths.size })}
      running={running}
      failed={items.some((f) => f.status === 'failed')}
    >
      <ul className="file-list">
        {changes.map((c, i) => (
          <li key={i}>
            <span className={`change-kind ${c.kind}`}>{t(`change.${c.kind}` as MessageKey)}</span>
            <code>{c.path}</code>
          </li>
        ))}
      </ul>
    </Fold>
  );
}

function Item({ item }: { item: AgentItem }) {
  const { t } = useI18n();
  switch (item.type) {
    case 'agent_message':
      return <Markdown text={item.text} />;
    case 'reasoning':
      return item.text.trim() ? (
        <Fold icon="sparkle" label={t('agent.thought')}>
          <Markdown text={item.text} />
        </Fold>
      ) : null;
    case 'web_search':
      return <Fold icon="search" label={`${t('agent.searched')} · ${item.query}`} />;
    case 'mcp_tool_call':
      return <Fold icon="tool" label={t('agent.called', { name: item.tool })} running={item.status === 'in_progress'} failed={item.status === 'failed'} />;
    case 'todo_list':
      return (
        <div className="todo">
          <b>{t('agent.plan')}</b>
          <ul>
            {item.items.map((x, i) => (
              <li key={i} className={x.completed ? 'done' : ''}>
                <span className="todo-box">{x.completed && <Icon name="check" className="size-3" />}</span>
                {x.text}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'error':
      return <p className="text-[13px] text-[var(--danger)]">{item.message}</p>;
    default:
      return null;
  }
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'commands') return <Commands items={block.items} />;
  if (block.kind === 'files') return <Files items={block.items} />;
  return <Item item={block.item} />;
}

function Failure({ turn, onSignIn }: { turn: Turn; onSignIn: () => void }) {
  const { t } = useI18n();
  const [details, setDetails] = useState(false);
  const f = turn.failure!;
  return (
    <div className="fail-card">
      <div className="flex items-center gap-2.5">
        <Icon name="alert" className="size-[18px]" />
        <b className="flex-1">{t(`fail.${f.kind}` as MessageKey)}</b>
        {f.kind === 'balance' && (
          <button className="btn btn-quiet h-8 px-3 text-[13px]" onClick={async () => openUrl((await api.relayOrigin()) + '/keys')}>
            {t('menu.console')}
          </button>
        )}
        {f.kind === 'auth' && (
          <button className="btn btn-quiet h-8 px-3 text-[13px]" onClick={onSignIn}>
            {t('fail.signIn')}
          </button>
        )}
        {f.message && (
          <button className="fail-more" onClick={() => setDetails((d) => !d)}>
            {t('agent.details')}
          </button>
        )}
      </div>
      {details && <pre className="cmd-output mt-3">{f.message}</pre>}
    </div>
  );
}

function TurnView({ turn, onSignIn }: { turn: Turn; onSignIn: () => void }) {
  const { t } = useI18n();
  const blocks = toBlocks(turn.items);
  const last = turn.items[turn.items.length - 1];
  const busy = !!last && 'status' in last && last.status === 'in_progress';
  const thinking = turn.status === 'running' && !busy;
  return (
    <div className="turn">
      <div className="user-msg">
        {turn.images.length > 0 && (
          <div className="user-images">
            {turn.images.map((src, i) => (
              <img key={i} src={src} alt="" />
            ))}
          </div>
        )}
        {turn.prompt && <p>{turn.prompt}</p>}
      </div>
      {blocks.map((b, i) => (
        <div key={i} className="turn-block">
          <BlockView block={b} />
        </div>
      ))}
      {turn.runtime !== undefined && (
        <p className="shimmer text-[14px] font-semibold">
          {turn.runtime === null ? t('agent.preparing') : t('agent.preparingPct', { pct: turn.runtime })}
        </p>
      )}
      {thinking && turn.runtime === undefined && <p className="shimmer text-[14px] font-semibold">{t('agent.thinking')}</p>}
      {turn.status === 'stopped' && <p className="text-[13px] text-ink-3">{t('agent.stopped')}</p>}
      {turn.status === 'failed' && turn.failure && <Failure turn={turn} onSignIn={onSignIn} />}
    </div>
  );
}

export function Conversation({ session, onSignIn }: { session: Session; onSignIn: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = session.turns[session.turns.length - 1];

  // Follow the output while the reader is at the bottom; leave them be if they scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    pinned.current = true;
  }, [session.id, session.turns.length]);

  return (
    <div
      ref={scroller}
      className="conversation"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      <div className="conversation-column">
        {session.turns.map((turn, i) => (
          <TurnView key={i} turn={turn} onSignIn={onSignIn} />
        ))}
        {last && <div className="h-2" />}
      </div>
    </div>
  );
}
