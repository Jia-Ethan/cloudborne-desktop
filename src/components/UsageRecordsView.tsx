import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, errorText, type AdminUsageRecord, type UsageKey, type UsageRecord, type UsageQuery } from '../api';
import { useI18n } from '../i18n';
import { money, rangeDates, type Range } from '../usage';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

const PAGE_SIZE = 50;
/** The values the relay accepts for `request_type`; anything else is a 400. */
const REQUEST_TYPES = ['sync', 'stream', 'ws_v2', 'live', 'cyber'] as const;
const TYPE_DEBOUNCE_MS = 350;

function isRequestType(v: string | null | undefined): v is (typeof REQUEST_TYPES)[number] {
  return (REQUEST_TYPES as readonly string[]).includes(v ?? '');
}

/** `value`, a beat after it stops changing. */
function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

type RecordRow = UsageRecord | AdminUsageRecord;

function value(v: string | null | undefined, fallback = '—') {
  return v && v.trim() ? v : fallback;
}

function dateText(v: string) {
  const date = new Date(v);
  return Number.isNaN(date.valueOf()) ? v : date.toLocaleString();
}

function tokens(r: RecordRow) {
  return `${(r.input_tokens ?? 0).toLocaleString()} / ${(r.output_tokens ?? 0).toLocaleString()}`;
}

function duration(r: RecordRow) {
  return r.duration_ms == null ? '—' : `${r.duration_ms.toLocaleString()} ms`;
}

export function UsageRecordsView({ admin = false, userId, embedded = false }: { admin?: boolean; userId?: number; embedded?: boolean }) {
  const { t } = useI18n();
  const [range, setRange] = useState<Range>('week');
  const [model, setModel] = useState('');
  const [requestType, setRequestType] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [userFilter, setUserFilter] = useState(userId ? String(userId) : '');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [keys, setKeys] = useState<UsageKey[]>([]);
  const generation = useRef(0);
  // Typed filters query a beat after the last key; pickers apply at once.
  const modelQuery = useDebounced(model.trim(), TYPE_DEBOUNCE_MS);
  const apiKeyQuery = useDebounced(apiKeyId.trim(), admin ? TYPE_DEBOUNCE_MS : 0);
  const userQuery = useDebounced(userFilter.trim(), TYPE_DEBOUNCE_MS);

  // The key list is the signed-in account's own keys, so only a user picks from it.
  useEffect(() => {
    if (admin) return;
    api.usageKeys().then(setKeys, () => {});
  }, [admin]);

  useEffect(() => {
    if (userId == null) return;
    setUserFilter(String(userId));
    setPage(1);
  }, [userId]);

  const query = useMemo((): UsageQuery => {
    const { start, end } = rangeDates(range);
    return {
      start_date: start,
      end_date: end,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      page,
      page_size: PAGE_SIZE,
      sort_by: 'created_at',
      sort_order: 'desc',
      ...(modelQuery ? { model: modelQuery } : {}),
      ...(requestType ? { request_type: requestType } : {}),
      ...(apiKeyQuery ? { api_key_id: apiKeyQuery } : {}),
      ...(admin && userQuery ? { user_id: userQuery } : {}),
    };
  }, [admin, apiKeyQuery, modelQuery, page, range, requestType, userQuery]);

  const load = useCallback(async () => {
    const g = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const result = admin ? await api.adminUsage(query) : await api.usageRecords(query);
      if (g !== generation.current) return;
      setRecords(result.items);
      setTotal(result.total);
    } catch (e) {
      if (g === generation.current) setError(errorText(e, t('common.genericError')));
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }, [admin, query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={embedded ? 'usage-records-embedded' : 'main-scroll'}>
      <div className="main-column">
        <div className="usage-head rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="seg" role="tablist" aria-label={t('usage.range.week')}>
            {(['today', 'week', 'month'] as Range[]).map((r) => (
              <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'on' : ''} onClick={() => { setRange(r); setPage(1); }}>
                {t(`usage.range.${r}`)}
              </button>
            ))}
          </div>
          <button className="usage-refresh" title={t('usage.refresh')} aria-label={t('usage.refresh')} disabled={busy} onClick={() => void load()}>
            <Icon name="refresh" className={`size-[15px] ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <section className="card usage-card rise" style={{ '--i': 1 } as CSSProperties}>
          <div className="usage-record-filters">
            {admin && (
              <input className="field" inputMode="numeric" value={userFilter} placeholder={t('usage.userId')} aria-label={t('usage.userId')} onChange={(e) => { setUserFilter(e.target.value.replace(/\D/g, '')); setPage(1); }} />
            )}
            <input className="field" value={model} placeholder={t('usage.model')} aria-label={t('usage.model')} onChange={(e) => { setModel(e.target.value); setPage(1); }} />
            <select className="field" value={requestType} aria-label={t('usage.type')} onChange={(e) => { setRequestType(e.target.value); setPage(1); }}>
              <option value="">{t('usage.typeAll')}</option>
              {REQUEST_TYPES.map((type) => (
                <option key={type} value={type}>{t(`usage.type.${type}`)}</option>
              ))}
            </select>
            {admin ? (
              <input className="field" inputMode="numeric" value={apiKeyId} placeholder={t('usage.apiKey')} aria-label={t('usage.apiKey')} onChange={(e) => { setApiKeyId(e.target.value.replace(/\D/g, '')); setPage(1); }} />
            ) : (
              <select className="field" value={apiKeyId} aria-label={t('usage.apiKey')} onChange={(e) => { setApiKeyId(e.target.value); setPage(1); }}>
                <option value="">{t('usage.apiKeyAll')}</option>
                {keys.map((key) => (
                  <option key={key.id} value={String(key.id)}>{key.name || `#${key.id}`}</option>
                ))}
              </select>
            )}
            {(model || requestType || apiKeyId || (admin && userFilter && !userId)) && (
              <button className="btn btn-quiet" onClick={() => { setModel(''); setRequestType(''); setApiKeyId(''); if (!userId) setUserFilter(''); setPage(1); }}>
                {t('usage.reset')}
              </button>
            )}
          </div>
        </section>

        {error && <div className="usage-error rise">{error}</div>}

        <section className="card usage-card rise" style={{ '--i': 2 } as CSSProperties}>
          {records === null && busy ? (
            <p className="usage-empty">{t('common.wait')}</p>
          ) : records?.length === 0 ? (
            <p className="usage-empty">{t('usage.recordNone')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="usage-table usage-records">
                  <thead>
                    <tr>
                      <th>{t('usage.time')}</th>
                      {admin && <th>{t('usage.user')}</th>}
                      <th>{t('usage.model')}</th>
                      <th>{t('usage.type')}</th>
                      <th>{t('usage.tokens')}</th>
                      <th>{t('usage.cost')}</th>
                      <th>{t('usage.duration')}</th>
                      <th>{t('usage.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(records ?? []).map((record) => {
                      const adminRecord = record as AdminUsageRecord;
                      const owner = adminRecord.user?.username || adminRecord.user?.email || (record.user_id ? `#${record.user_id}` : '—');
                      return (
                        <tr key={record.id} tabIndex={0} onClick={() => setSelected(record)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(record); } }}>
                          <td>{dateText(record.created_at)}</td>
                          {admin && <td className="usage-model" title={owner}>{owner}</td>}
                          <td className="usage-model" title={record.model}>{record.model || '—'}</td>
                          <td>{isRequestType(record.request_type) ? t(`usage.type.${record.request_type}`) : value(record.request_type)}</td>
                          <td>{tokens(record)}</td>
                          <td>{money(record.actual_cost ?? record.total_cost ?? 0)}</td>
                          <td>{duration(record)}</td>
                          <td><span className="user-status on">{value(record.status, t('usage.recorded'))}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="pager">
                  <button className="icon-button" aria-label={t('usage.previous')} disabled={page <= 1 || busy} onClick={() => setPage((p) => p - 1)}>
                    <Icon name="chevronLeft" className="size-4" />
                  </button>
                  <span>{t('usage.page', { page, pages })}</span>
                  <button className="icon-button" aria-label={t('usage.next')} disabled={page >= pages || busy} onClick={() => setPage((p) => p + 1)}>
                    <Icon name="chevronRight" className="size-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {selected && <RecordDialog record={selected} admin={admin} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RecordDialog({ record, admin, onClose }: { record: RecordRow; admin: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const adminRecord = record as AdminUsageRecord;
  const owner = adminRecord.user?.username || adminRecord.user?.email || (record.user_id ? `#${record.user_id}` : '—');
  return (
    <Dialog title={t('usage.detail')} onClose={onClose} footer={<button className="btn btn-quiet" onClick={onClose}>{t('common.close')}</button>}>
      <dl className="detail-list">
        {admin && <div><dt>{t('usage.user')}</dt><dd>{owner}</dd></div>}
        <div><dt>{t('usage.time')}</dt><dd>{dateText(record.created_at)}</dd></div>
        <div><dt>{t('usage.requestId')}</dt><dd>{value(record.request_id)}</dd></div>
        <div><dt>{t('usage.model')}</dt><dd>{value(record.model)}</dd></div>
        <div><dt>{t('usage.upstreamModel')}</dt><dd>{value(record.upstream_model ?? record.upstream_response_model)}</dd></div>
        <div><dt>{t('usage.apiKey')}</dt><dd>{value(record.api_key?.name, record.api_key_id ? `#${record.api_key_id}` : '—')}</dd></div>
        <div><dt>{t('usage.tokens')}</dt><dd>{tokens(record)}</dd></div>
        <div><dt>{t('usage.cost')}</dt><dd>{money(record.actual_cost ?? record.total_cost ?? 0)}</dd></div>
        <div><dt>{t('usage.duration')}</dt><dd>{duration(record)}</dd></div>
        {admin && adminRecord.ip_address && <div><dt>{t('usage.ip')}</dt><dd>{adminRecord.ip_address}</dd></div>}
      </dl>
    </Dialog>
  );
}
