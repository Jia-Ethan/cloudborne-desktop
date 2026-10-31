import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { freshPopups, isUnread, LIST_LIMIT, THROTTLE_MS, unreadCount, type Announcement } from './announcements';

/** The first read waits a moment after sign-in, as on the web console. */
const FIRST_READ_MS = 3000;

/**
 * Announcements for account `uid`, after the web console's store: read a few
 * seconds after sign-in, then again (at most every 20 minutes) when the user
 * moves between pages or comes back to the window. Unread popup ones collect
 * in `popup` once per sign-in; dismissing it marks that batch read.
 */
export function useAnnouncements(uid: number | null) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [popup, setPopup] = useState<Announcement[]>([]);
  // One per account; a reply for an earlier account finds it replaced and is dropped.
  const acct = useRef({ uid, started: false, at: 0, shown: new Set<number>() });
  const latest = useRef({ items, popup });
  latest.current = { items, popup };

  const load = useCallback(async (force = false) => {
    const a = acct.current;
    if (a.uid == null) return;
    const now = Date.now();
    if (!force && (!a.started || now - a.at < THROTTLE_MS)) return;
    a.started = true;
    a.at = now;
    try {
      const all = ((await api.announcements()) ?? []).slice(0, LIST_LIMIT);
      if (acct.current !== a) return;
      setItems(all);
      const fresh = freshPopups(all, a.shown);
      if (!fresh.length) return;
      fresh.forEach((p) => a.shown.add(p.id));
      setPopup((batch) => [...batch, ...fresh.filter((p) => !batch.some((q) => q.id === p.id))]);
    } catch {
      // The next page change or window focus tries again.
      if (acct.current === a) a.at = 0;
    }
  }, []);

  useEffect(() => {
    acct.current = { uid, started: false, at: 0, shown: new Set() };
    setItems([]);
    setPopup([]);
    if (uid == null) return;
    const first = setTimeout(() => load(true), FIRST_READ_MS);
    const again = () => document.visibilityState === 'visible' && load();
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      clearTimeout(first);
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [uid, load]);

  const markRead = useCallback(async (id: number) => {
    const a = acct.current;
    await api.announcementRead(id);
    if (acct.current !== a) return;
    const at = new Date().toISOString();
    setItems((list) => list.map((x) => (x.id === id && !x.read_at ? { ...x, read_at: at } : x)));
  }, []);

  /** Rejects when the relay refuses one; the ones it accepted stay read. */
  const markAllRead = useCallback(async () => {
    const ids = latest.current.items.filter(isUnread).map((x) => x.id);
    await Promise.all(ids.map(markRead));
  }, [markRead]);

  /** Closes the popup and marks every announcement it was opened for as read. */
  const dismissPopup = useCallback(() => {
    const ids = latest.current.popup.map((x) => x.id);
    setPopup([]);
    // The dialog is already closing; a failed mark leaves it unread for next time.
    ids.forEach((id) => markRead(id).catch(() => {}));
  }, [markRead]);

  return { items, unread: unreadCount(items), popup, load, markRead, markAllRead, dismissPopup };
}
