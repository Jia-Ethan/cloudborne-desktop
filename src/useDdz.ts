import { useCallback, useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { errorText } from './api';
import type { Action, Table } from './ddz';

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
    const channel = new Channel<DdzEvent>();
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
      setTable(t);
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
