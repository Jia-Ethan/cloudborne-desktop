import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; version: string }
  | { kind: 'installing'; percent: number | null }
  | { kind: 'error'; phase: 'check' | 'install'; message: string };

const RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * In-app updates from the GitHub release feed (latest.json, minisign-signed).
 * Checks quietly a few seconds after launch and every six hours; a manual
 * check also reports "already latest" and errors.
 */
export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const [current, setCurrent] = useState('');
  const pending = useRef<Update | null>(null);

  const run = useCallback(async (manual: boolean) => {
    if (manual) setState({ kind: 'checking' });
    try {
      const u = await check({ timeout: 30_000 });
      pending.current = u;
      if (u) setState({ kind: 'available', version: u.version });
      else if (manual) setState({ kind: 'latest' });
    } catch (e) {
      if (manual) setState({ kind: 'error', phase: 'check', message: String(e) });
    }
  }, []);

  const install = useCallback(async () => {
    const u = pending.current;
    if (!u) return;
    let total = 0;
    let done = 0;
    setState({ kind: 'installing', percent: null });
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          if (total > 0) setState({ kind: 'installing', percent: Math.min(100, Math.round((done / total) * 100)) });
        } else setState({ kind: 'installing', percent: 100 });
      });
      await relaunch();
    } catch (e) {
      setState({ kind: 'error', phase: 'install', message: String(e) });
    }
  }, []);

  useEffect(() => {
    getVersion().then(setCurrent, () => {});
    const first = setTimeout(() => run(false), 3000);
    const every = setInterval(() => run(false), RECHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [run]);

  // "Already latest" and errors fade back to the plain item.
  useEffect(() => {
    if (state.kind !== 'latest' && state.kind !== 'error') return;
    const t = setTimeout(() => setState(pending.current ? { kind: 'available', version: pending.current.version } : { kind: 'idle' }), 4000);
    return () => clearTimeout(t);
  }, [state]);

  return { state, current, check: () => run(true), install };
}

export type Updater = ReturnType<typeof useUpdater>;
