import { useCallback, useEffect, useRef, useState } from 'react';
import { agentApi, applyEvent, type AgentModels, type Attachment, type Effort, type Session, type SessionSummary, type Turn } from './agent';
import { errorText } from './api';

const MODEL_KEY = 'cloudborne.agent.model';
const NEW_TASK = '';
const EMPTY_DRAFT: Draft = { text: '', images: [] };

/** What the composer holds before it is sent. */
export interface Draft {
  text: string;
  images: Attachment[];
}
const EFFORT_KEY = 'cloudborne.agent.effort';

/** First line of the first prompt, as the sidebar shows it. */
export function titleOf(prompt: string): string {
  const line = prompt.trim().split('\n')[0] ?? '';
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

/**
 * Task sessions and the turn in flight. Lives above the views so a running
 * task keeps streaming while the user is on another page. Task history is kept
 * per install; the model list depends on the account's groups, so it reloads
 * when `account` (the signed-in user id) changes. A running turn keeps the key
 * it started with. Unsent drafts are kept per task (and one for the new-task
 * page) so leaving the page doesn't lose them.
 */
export function useAgent(lang: string, account: number | null) {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [open, setOpen] = useState<Record<string, Session>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [models, setModels] = useState<AgentModels | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [model, setModelState] = useState(() => localStorage.getItem(MODEL_KEY) ?? '');
  const [effort, setEffortState] = useState<Effort>(() => (localStorage.getItem(EFFORT_KEY) as Effort) || 'medium');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const running = useRef(new Set<string>());
  const [, bump] = useState(0);

  useEffect(() => {
    setModels(null);
    setModelsError('');
    setDrafts({});
    if (account === null) return;
    agentApi.sessions().then(setSummaries).catch(() => {});
    agentApi
      .models()
      .then((m) => {
        setModels(m);
        setModelState((cur) => (m.models.includes(cur) ? cur : (m.default ?? '')));
      })
      .catch((e) => setModelsError(errorText(e, '')));
  }, [account]);

  const setModel = useCallback((m: string) => {
    localStorage.setItem(MODEL_KEY, m);
    setModelState(m);
  }, []);
  const setEffort = useCallback((e: Effort) => {
    localStorage.setItem(EFFORT_KEY, e);
    setEffortState(e);
  }, []);

  const select = useCallback(
    async (id: string | null) => {
      setCurrentId(id);
      if (id && !open[id]) {
        const s = await agentApi.session(id).catch(() => null);
        if (s) setOpen((o) => ({ ...o, [id]: o[id] ?? s }));
      }
    },
    [open],
  );

  const draftKey = currentId ?? NEW_TASK;
  const setDraft = useCallback(
    (f: (d: Draft) => Draft) => setDrafts((m) => ({ ...m, [draftKey]: f(m[draftKey] ?? EMPTY_DRAFT) })),
    [draftKey],
  );

  const patchLast = (id: string, f: (t: Turn) => Turn) =>
    setOpen((o) => {
      const s = o[id];
      if (!s) return o;
      const turns = s.turns.slice();
      turns[turns.length - 1] = f(turns[turns.length - 1]);
      return { ...o, [id]: { ...s, turns } };
    });

  const send = useCallback(
    async (prompt: string, images: Attachment[]) => {
      const id = currentId ?? crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const turn: Turn = { prompt, images: images.map((a) => a.data), items: [], status: 'running' };
      setOpen((o) => {
        const s = o[id] ?? { id, title: titleOf(prompt), updated_at: now, turns: [] };
        return { ...o, [id]: { ...s, updated_at: now, turns: [...s.turns, turn] } };
      });
      setSummaries((list) => {
        const prev = list.find((x) => x.id === id);
        return [{ id, title: prev?.title ?? titleOf(prompt), updated_at: now }, ...list.filter((x) => x.id !== id)];
      });
      setCurrentId(id);
      running.current.add(id);
      bump((n) => n + 1);
      const finish = () => {
        running.current.delete(id);
        bump((n) => n + 1);
      };
      try {
        await agentApi.send({ session: id, prompt, images, model, effort, lang }, (e) => {
          patchLast(id, (t) => applyEvent(t, e));
          if (e.type === 'done' || e.type === 'stopped' || e.type === 'failed') finish();
        });
      } catch (e) {
        patchLast(id, (t) => applyEvent(t, { type: 'failed', kind: 'other', message: errorText(e, '') }));
        finish();
      }
    },
    [currentId, model, effort, lang],
  );

  const stop = useCallback(() => {
    if (currentId) agentApi.stop(currentId).catch(() => {});
  }, [currentId]);

  const remove = useCallback(
    async (id: string) => {
      await agentApi.deleteSession(id).catch(() => {});
      setSummaries((l) => l.filter((x) => x.id !== id));
      setOpen(({ [id]: _, ...rest }) => rest);
      setDrafts(({ [id]: _, ...rest }) => rest);
      if (currentId === id) setCurrentId(null);
    },
    [currentId],
  );

  return {
    summaries,
    current: currentId ? (open[currentId] ?? null) : null,
    currentId,
    isRunning: (id: string | null) => !!id && running.current.has(id),
    draft: drafts[draftKey] ?? EMPTY_DRAFT,
    setDraft,
    models,
    modelsError,
    model,
    effort,
    setModel,
    setEffort,
    select,
    send,
    stop,
    remove,
  };
}

export type Agent = ReturnType<typeof useAgent>;
