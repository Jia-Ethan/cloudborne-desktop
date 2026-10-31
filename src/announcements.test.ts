import { describe, expect, it } from 'vitest';
import { displayTitle, formatDay, freshPopups, newestFirst, startOf, unreadCount, type Announcement } from './announcements';

const ann = (o: Partial<Announcement>): Announcement => ({
  id: 1,
  title: '标题 / Title',
  content: '![封面 / Cover](https://api.cloudborne.cn/media/announcements/1-x.webp)\n\n正文',
  notify_mode: 'silent',
  created_at: '2026-10-29T12:33:22+08:00',
  updated_at: '2026-10-31T15:59:01+08:00',
  ...o,
});

// As the relay sends them: unread first, then by id.
const relayOrder = [
  ann({ id: 18, notify_mode: 'popup', created_at: '2026-10-29T12:33:22+08:00' }),
  ann({ id: 1, created_at: '2026-05-20T10:21:58+08:00' }),
  ann({ id: 13, notify_mode: 'popup', created_at: '2026-06-16T20:51:57+08:00', read_at: '2026-06-17T09:00:00+08:00' }),
  ann({ id: 12, notify_mode: 'popup', created_at: '2026-06-16T20:46:23+08:00', read_at: '2026-06-17T09:00:00+08:00' }),
];

describe('announcements', () => {
  it('lists newest first by date, not unread first', () => {
    expect(newestFirst(relayOrder).map((a) => a.id)).toEqual([18, 13, 12, 1]);
    // Same moment: the higher id first.
    expect(newestFirst([ann({ id: 2 }), ann({ id: 5 })]).map((a) => a.id)).toEqual([5, 2]);
    // Leaves the relay's list as it was.
    expect(relayOrder[0].id).toBe(18);
  });

  it('counts unread ones', () => {
    expect(unreadCount(relayOrder)).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it('pops up unread popup announcements once', () => {
    const shown = new Set<number>();
    expect(freshPopups(relayOrder, shown).map((a) => a.id)).toEqual([18]);
    shown.add(18);
    expect(freshPopups(relayOrder, shown)).toEqual([]);
    // Silent ones never pop up, read ones neither.
    expect(freshPopups([ann({ id: 1 }), ann({ id: 2, notify_mode: 'popup', read_at: 'x' })], new Set())).toEqual([]);
  });

  it('opens on the asked-for one, else the newest unread, else the newest', () => {
    const sorted = newestFirst(relayOrder);
    expect(startOf(sorted, 12)?.id).toBe(12);
    expect(startOf(sorted, null)?.id).toBe(18);
    expect(startOf(sorted, 99)?.id).toBe(18);
    const allRead = sorted.map((a) => ({ ...a, read_at: 'x' }));
    expect(startOf(allRead, null)?.id).toBe(18);
    expect(startOf(newestFirst([ann({ id: 1 }), ann({ id: 2, created_at: '2026-10-30T00:00:00Z', read_at: 'x' })]), null)?.id).toBe(1);
    expect(startOf([], null)).toBeNull();
  });

  it('drops Markdown heading marks from titles', () => {
    expect(displayTitle('# 部分模型下线与到期提醒 / Model Retirement Notice')).toBe('部分模型下线与到期提醒 / Model Retirement Notice');
    expect(displayTitle('  ## 会员等级制度说明')).toBe('会员等级制度说明');
    expect(displayTitle('C# 入门')).toBe('C# 入门');
  });

  it('formats the day in the UI language', () => {
    expect(formatDay('2026-10-29T12:33:22+08:00', 'zh-CN')).toBe('2026年10月29日');
    expect(formatDay('2026-10-29T12:33:22+08:00', 'en')).toBe('October 29, 2026');
    expect(formatDay('not a date', 'en')).toBe('');
  });
});
