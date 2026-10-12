import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, errorText, type Group, type ToolStatus } from '../api';
import { useI18n } from '../i18n';
import { ToolGlyph } from './ToolGlyph';

type Phase = 'idle' | 'picking' | 'working' | 'confirm-disconnect';

export function ToolCard({
  tool,
  index,
  onChanged,
}: {
  tool: ToolStatus;
  index: number;
  onChanged: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState('');

  async function run(fn: () => Promise<string>) {
    setPhase('working');
    setError('');
    try {
      onChanged(await fn());
      setPhase('idle');
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
      setPhase('idle');
    }
  }

  async function startConnect() {
    setError('');
    setPhase('working');
    try {
      const gs = await api.groupsFor(tool.id);
      if (gs.length === 0) {
        setError(t('tool.noGroups'));
        setPhase('idle');
      } else if (gs.length === 1) {
        await connect(gs[0]);
      } else {
        setGroups(gs);
        setPhase('picking');
      }
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
      setPhase('idle');
    }
  }

  function connect(g: Group) {
    return run(async () => {
      await api.connect(tool.id, g.id);
      return t('toast.connected', { tool: tool.name, group: g.name });
    });
  }

  function install() {
    return run(async () => {
      const r = await api.install(tool.id);
      if (r.kind === 'needs_node') return t('toast.needsNode');
      if (r.kind === 'package') return t('toast.package', { path: r.path });
      return t('toast.terminal', { tool: tool.name });
    });
  }

  const status = tool.error
    ? { text: t('tool.badConfig'), dot: 'bg-warn' }
    : tool.connected
      ? { text: t('tool.connected'), dot: 'bg-ok' }
      : tool.installed
        ? { text: t('tool.installed'), dot: 'bg-ink-3' }
        : { text: t('tool.notInstalled'), dot: 'bg-ink-3/40' };

  const busy = phase === 'working';

  // Pop the status dot only when the tool turns connected while on screen.
  const wasConnected = useRef(tool.connected);
  const [justConnected, setJustConnected] = useState(false);
  useEffect(() => {
    if (tool.connected && !wasConnected.current) setJustConnected(true);
    wasConnected.current = tool.connected;
  }, [tool.connected]);

  return (
    <div className="card tool-card rise lift" style={{ '--i': index } as CSSProperties}>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <ToolGlyph id={tool.id} />
          {busy && (
            <svg className="logo-ring" viewBox="0 0 56 56" aria-hidden>
              <rect className="track" x="1.25" y="1.25" width="53.5" height="53.5" rx="16" pathLength="100" />
              <rect className="arc" x="1.25" y="1.25" width="53.5" height="53.5" rx="16" pathLength="100" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[17px] font-semibold tracking-tight">{tool.name}</h3>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span
                className={`size-1.5 rounded-full ${status.dot} ${justConnected ? 'dot-pop' : ''}`}
                onAnimationEnd={() => setJustConnected(false)}
              />
              {status.text}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          {tool.connected ? (
            <>
              <button className="btn btn-quiet" disabled={busy} onClick={startConnect}>
                {t('tool.update')}
              </button>
              <button className="btn btn-quiet" disabled={busy} onClick={() => setPhase('confirm-disconnect')}>
                {t('tool.disconnect')}
              </button>
            </>
          ) : tool.installed || tool.id === 'codex' ? (
            <>
              {!tool.installed && (
                <button className="btn btn-quiet" disabled={busy} onClick={install}>
                  {t('tool.installCli')}
                </button>
              )}
              <button className="btn btn-primary" disabled={busy || !!tool.error} onClick={startConnect}>
                {busy ? t('tool.working') : t('tool.connectCta')}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={install}>
              {busy ? t('tool.working') : t('tool.install')}
            </button>
          )}
        </div>
      </div>

      {phase === 'picking' && (
        <div className="slide-in mt-4 border-t border-line pt-4">
          <p className="mb-2.5 text-[13px] text-ink-2">{t('tool.pickGroup')}</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button key={g.id} className="btn btn-quiet" onClick={() => connect(g)}>
                {g.name}
                {g.rate_multiplier > 0 && g.rate_multiplier !== 1 && (
                  <span className="text-xs font-normal text-ink-3">×{g.rate_multiplier}</span>
                )}
              </button>
            ))}
            <button className="btn text-ink-3" onClick={() => setPhase('idle')}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {phase === 'confirm-disconnect' && (
        <div className="slide-in mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <p className="mr-auto text-[13px] text-ink-2">{t('tool.disconnectAsk')}</p>
          <button
            className="btn btn-quiet"
            onClick={() => run(async () => (await api.disconnect(tool.id, false), t('toast.disconnected', { tool: tool.name })))}
          >
            {t('tool.disconnectOnly')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => run(async () => (await api.disconnect(tool.id, true), t('toast.disconnectedDeleted', { tool: tool.name })))}
          >
            {t('tool.disconnectAndDelete')}
          </button>
          <button className="btn text-ink-3" onClick={() => setPhase('idle')}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {(error || tool.error) && <p className="mt-3 text-[13px] text-[#c2410c]">{error || tool.error}</p>}
    </div>
  );
}
