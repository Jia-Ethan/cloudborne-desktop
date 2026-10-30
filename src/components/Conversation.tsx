import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api, errorText } from '../api';
import { toBlocks, type AgentItem, type Block, type Question, type Session, type Turn } from '../agent';
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
type Reasoning = Extract<AgentItem, { type: 'reasoning' }>;
type Ask = Extract<AgentItem, { type: 'question' }>;
type OnAnswer = (request: string, answers: Record<string, string[]>) => Promise<void>;

/**
 * The thinking summary. While it is being written it stays open and shows its
 * latest lines under a fade; once done it folds to "Thought for N s".
 */
function Thinking({ item, live }: { item: Reasoning; live: boolean }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const streaming = live && item.status === 'in_progress';
  // Fade the top only once older lines are actually cut off.
  useLayoutEffect(() => {
    const el = box.current;
    const inner = el?.firstElementChild as HTMLElement | null;
    setClipped(!!el && !!inner && inner.offsetHeight > el.clientHeight + 1);
  }, [item.text, streaming]);
  if (streaming) {
    return (
      <div className="thinking-live">
        <p className="shimmer text-[14px] font-semibold">{t('agent.thinking')}</p>
        {item.text.trim() && (
          <div ref={box} className={`thinking-live-text ${clipped ? 'clipped' : ''}`}>
            <Markdown text={item.text} />
          </div>
        )}
      </div>
    );
  }
  if (!item.text.trim()) return null;
  const secs = item.duration_ms ? Math.max(1, Math.round(item.duration_ms / 1000)) : 0;
  return (
    <Fold icon="sparkle" label={secs ? t('agent.thoughtFor', { s: secs }) : t('agent.thought')}>
      <Markdown text={item.text} />
    </Fold>
  );
}

const RECOMMENDED = /\s*[(（](recommended|推荐)[)）]\s*$/i;
const OTHER = '\u0000other';

/**
 * A question the agent stopped to ask. One question is answered with a single
 * click; several are picked first, then sent together. "Other" takes free text.
 */
function QuestionCard({ item, live, onAnswer }: { item: Ask; live: boolean; onAnswer: OnAnswer }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const qs = item.questions;

  if (item.status !== 'pending' || !live) {
    const answered = item.status === 'answered';
    return (
      <div className={`ask-card done ${answered ? '' : 'expired'}`}>
        <div className="ask-head">
          <Icon name={answered ? 'check' : 'alert'} className="size-3.5" />
          <b>{t(answered ? 'agent.ask.answered' : 'agent.ask.expired')}</b>
        </div>
        <ul className="ask-summary">
          {qs.map((q) => (
            <li key={q.id}>
              <span>{q.header || q.question}</span>
              {answered && <b>{(item.answers?.[q.id] ?? []).map((a) => a.replace(RECOMMENDED, '')).join('、')}</b>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const value = (q: Question) => (picked[q.id] === OTHER || !q.options?.length ? (typed[q.id] ?? '').trim() : (picked[q.id] ?? ''));
  const ready = qs.every((q) => value(q) !== '');
  const send = async (vals: Record<string, string>) => {
    setSending(true);
    setError('');
    try {
      await onAnswer(item.request, Object.fromEntries(qs.map((q) => [q.id, [vals[q.id]]])));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
      setSending(false);
    }
  };
  const all = () => Object.fromEntries(qs.map((q) => [q.id, value(q)]));
  const choose = (q: Question, label: string) => {
    if (sending) return;
    if (qs.length === 1 && label !== OTHER) void send({ [q.id]: label });
    else setPicked((p) => ({ ...p, [q.id]: label }));
  };

  return (
    <div className="ask-card" role="group" aria-label={t('agent.ask.title')}>
      <div className="ask-head">
        <Icon name="sparkle" className="size-3.5" />
        <b>{t('agent.ask.title')}</b>
      </div>
      {qs.map((q) => {
        const free = picked[q.id] === OTHER || !q.options?.length;
        return (
          <div key={q.id} className="ask-q">
            <p>
              {q.header && <span className="ask-chip">{q.header}</span>}
              {q.question}
            </p>
            {!!q.options?.length && (
              <div className="ask-options" role={qs.length > 1 ? 'radiogroup' : undefined}>
                {q.options.map((o) => {
                  const rec = RECOMMENDED.test(o.label);
                  const on = picked[q.id] === o.label;
                  return (
                    <button
                      key={o.label}
                      className={`ask-option ${on ? 'on' : ''}`}
                      role={qs.length > 1 ? 'radio' : undefined}
                      aria-checked={qs.length > 1 ? on : undefined}
                      disabled={sending}
                      onClick={() => choose(q, o.label)}
                    >
                      <span className="ask-option-label">
                        {o.label.replace(RECOMMENDED, '')}
                        {rec && <em>{t('agent.ask.recommended')}</em>}
                      </span>
                      {o.description && <small>{o.description}</small>}
                    </button>
                  );
                })}
                <button
                  className={`ask-option other ${picked[q.id] === OTHER ? 'on' : ''}`}
                  disabled={sending}
                  onClick={() => choose(q, OTHER)}
                >
                  <span className="ask-option-label">{t('agent.ask.other')}</span>
                </button>
              </div>
            )}
            {free && (
              <form
                className="ask-free"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (ready && !sending) void send(all());
                }}
              >
                <input
                  className="field"
                  type={q.isSecret ? 'password' : 'text'}
                  autoFocus
                  placeholder={t('agent.ask.placeholder')}
                  value={typed[q.id] ?? ''}
                  disabled={sending}
                  onChange={(e) => setTyped((m) => ({ ...m, [q.id]: e.target.value }))}
                />
                {qs.length === 1 && (
                  <button className="btn btn-primary h-9 px-4 text-[13px]" disabled={!ready || sending}>
                    {t('agent.ask.submit')}
                  </button>
                )}
              </form>
            )}
          </div>
        );
      })}
      {qs.length > 1 && (
        <div className="ask-actions">
          <button className="btn btn-primary h-9 px-4 text-[13px]" disabled={!ready || sending} onClick={() => void send(all())}>
            {t('agent.ask.submit')}
          </button>
        </div>
      )}
      {error && <p className="ask-error">{error}</p>}
    </div>
  );
}

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

function Item({ item, live, onAnswer }: { item: AgentItem; live: boolean; onAnswer: OnAnswer }) {
  const { t } = useI18n();
  switch (item.type) {
    case 'agent_message':
      return <Markdown text={item.text} />;
    case 'reasoning':
      return <Thinking item={item} live={live} />;
    case 'question':
      return <QuestionCard item={item} live={live} onAnswer={onAnswer} />;
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

function BlockView({ block, live, onAnswer }: { block: Block; live: boolean; onAnswer: OnAnswer }) {
  if (block.kind === 'commands') return <Commands items={block.items} />;
  if (block.kind === 'files') return <Files items={block.items} />;
  return <Item item={block.item} live={live} onAnswer={onAnswer} />;
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

function TurnView({ turn, onSignIn, onAnswer }: { turn: Turn; onSignIn: () => void; onAnswer: OnAnswer }) {
  const { t } = useI18n();
  // Models sometimes send a whitespace-only message before the real one; it would only leave a gap.
  const shown = turn.items.filter((x) => !(x.type === 'agent_message' && !x.text.trim()));
  const blocks = toBlocks(shown);
  const last = shown[shown.length - 1];
  const live = turn.status === 'running';
  // Something already shows the work under way: a running step, or a question waiting on the user.
  const busy = !!last && 'status' in last && (last.status === 'in_progress' || last.status === 'pending');
  const thinking = live && !busy;
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
          <BlockView block={b} live={live} onAnswer={onAnswer} />
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

export function Conversation({ session, onSignIn, onAnswer }: { session: Session; onSignIn: () => void; onAnswer: OnAnswer }) {
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
          <TurnView key={i} turn={turn} onSignIn={onSignIn} onAnswer={onAnswer} />
        ))}
        {last && <div className="h-2" />}
      </div>
    </div>
  );
}
