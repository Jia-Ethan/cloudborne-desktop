import { useCallback, useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { errorText } from './api';
import { isNewerTable, type Action, type Table } from './ddz';

/** The table line as Rust reports it. */
export type DdzConn = 'idle' | 'connecting' | 'open' | 'auth' | 'unavailable';

type DdzEvent =
  | { type: 'conn'; state: Exclude<DdzConn, 'idle'> }
  | { type: 'relay'; data: { type: 'table'; table: Table | null } | { type: 'error'; message: string } };

/**
 * The 小丑斗地主 table for account `uid`. The line is open while the view is
 * showing (`wanted`) or a table is in play, so walking off to another page
 * mid-deal keeps the seat online. `onSettled` fires once per settled deal, for
 * a balance refetch.
 */
export function useDdz(uid: number | null, wanted: boolean, onError: (message: string) => void, onSettled: () => void) {
  const [table, setTable] = useState<Table | null>(null);
  const [conn, setConn] = useState<DdzConn>('idle');
  const live = !!uid && (wanted || table !== null);
  const handlers = useRef({ onError, onSettled });
  handlers.current = { onError, onSettled };
  const settled = useRef('');

  useEffect(() => {
    if (!live) return;
    let gone = false;
    let latest: Table | null = null;
    let pending: Table | null | undefined;
    let frame: number | null = null;
    const channel = new Channel<DdzEvent>();
    const flush = () => {
      frame = null;
      if (gone || pending === undefined) return;
      const next = pending;
      pending = undefined;
      setTable(next);
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : window.setTimeout(flush, 16);
    };
    channel.onmessage = (e) => {
      if (gone) return;
      if (e.type === 'conn') {
        setConn(e.state);
        return;
      }
      const m = e.data;
      if (m.type === 'error') {
        handlers.current.onError(m.message);
        return;
      }
      const t = m.table;
      if (!isNewerTable(latest,t)) return;
      latest=t;
      pending = t;
      schedule();
      if (t?.result) {
        const key = `${t.id}:${t.commit}`;
        if (key !== settled.current) {
          settled.current = key;
          handlers.current.onSettled();
        }
      }
    };
    invoke('ddz_connect', { channel }).catch((err) => handlers.current.onError(errorText(err, '')));
    return () => {
      gone = true;
      if (frame !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        else window.clearTimeout(frame);
      }
      frame = null;
      pending = undefined;
      invoke('ddz_close').catch(() => {});
      setConn('idle');
      setTable(null);
    };
  }, [live, uid]);

  const send = useCallback((a: Action) => {
    invoke('ddz_send', { action: a }).catch((err) => handlers.current.onError(errorText(err, '')));
  }, []);

  return { table, conn, send };
}
