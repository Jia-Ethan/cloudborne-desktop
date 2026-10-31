import type { Lang } from './i18n';

/** An announcement as the relay's user API lists it. */
export interface Announcement {
  id: number;
  title: string;
  /** Markdown; bodies start with a cover image. */
  content: string;
  /** `popup` ones open by themselves once per sign-in while unread. */
  notify_mode: 'silent' | 'popup';
  starts_at?: string;
  ends_at?: string;
  read_at?: string;
  created_at: string;
  updated_at: string;
}

/** Same as the web console: at most 20, re-read at most every 20 minutes. */
export const LIST_LIMIT = 20;
export const THROTTLE_MS = 20 * 60 * 1000;

/** Newest first by date. The relay lists unread ones first, which put an old unread tutorial above newer read ones. */
export function newestFirst<T extends Pick<Announcement, 'id' | 'created_at'>>(items: T[]): T[] {
  return [...items].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || b.id - a.id);
}

export const isUnread = (a: Pick<Announcement, 'read_at'>) => !a.read_at;

export const unreadCount = (items: Pick<Announcement, 'read_at'>[]) => items.filter(isUnread).length;

/** Unread popup announcements not shown yet this sign-in. */
export function freshPopups(items: Announcement[], shown: ReadonlySet<number>): Announcement[] {
  return items.filter((a) => a.notify_mode === 'popup' && isUnread(a) && !shown.has(a.id));
}

/** Where the dialog opens: the asked-for one, else the newest unread, else the newest. */
export function startOf<T extends Pick<Announcement, 'id' | 'read_at'>>(sorted: T[], startId: number | null): T | null {
  return sorted.find((a) => a.id === startId) ?? sorted.find(isUnread) ?? sorted[0] ?? null;
}

/** Titles typed as Markdown headings ("# Title") show without the marks. */
export const displayTitle = (title: string) => title.replace(/^\s*#+\s*/, '');

export function formatDay(value: string, lang: Lang): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}
