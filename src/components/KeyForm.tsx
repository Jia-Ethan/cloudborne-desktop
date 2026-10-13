import { useState } from 'react';
import { api, errorText, type ApiKey, type Group } from '../api';
import { useI18n } from '../i18n';
import { createBody, customKeyProblem, emptyForm, formOf, updateBody, type KeyForm as Form } from '../keys';
import { BrandMark } from './BrandMark';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

const EXPIRY: Form['expiry'][] = ['never', '7', '30', '90'];

export function KeyForm({
  groups,
  editing,
  onClose,
  onSaved,
}: {
  groups: Group[];
  editing?: ApiKey;
  onClose: () => void;
  onSaved: (k: ApiKey) => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<Form>(() => (editing ? formOf(editing) : { ...emptyForm(), groupId: groups[0]?.id ?? null }));
  const [more, setMore] = useState(() => !!editing && (editing.quota > 0 || editing.rate_limit_5h + editing.rate_limit_1d + editing.rate_limit_7d > 0 || !!editing.ip_whitelist?.length || !!editing.ip_blacklist?.length));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const keyProblem = customKeyProblem(f.customKey);
  const ready = f.name.trim() && f.groupId !== null && !keyProblem;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      onSaved(editing ? await api.updateKey(editing.id, updateBody(f)) : await api.createKey(createBody(f)));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
      setBusy(false);
    }
  }

  const expiryOptions: Form['expiry'][] = editing?.expires_at ? ['keep', ...EXPIRY] : EXPIRY;

  return (
    <Dialog
      title={editing ? t('keys.edit') : t('keys.create')}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mr-auto text-[13px] text-[#c2410c]">{error}</p>}
          <button className="btn btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={save}>
            {busy ? t('common.wait') : editing ? t('keys.save') : t('keys.create')}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="form-row">
          <span>{t('keys.name')}</span>
          <input className="field" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus maxLength={100} />
        </label>

        <div className="form-row">
          <span>{t('keys.group')}</span>
          {groups.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t('keys.noGroups')}</p>
          ) : (
            <div className="group-pick" role="radiogroup">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={f.groupId === g.id}
                  className={f.groupId === g.id ? 'on' : ''}
                  onClick={() => set('groupId', g.id)}
                >
                  <BrandMark platform={g.platform} />
                  <span className="truncate">{g.name}</span>
                  {g.rate_multiplier > 0 && g.rate_multiplier !== 1 && <em>×{g.rate_multiplier}</em>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="form-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          <Icon name="chevronRight" className={`size-3.5 transition-transform ${more ? 'rotate-90' : ''}`} />
          {t('keys.advanced')}
        </button>

        {more && (
          <div className="slide-in form-grid">
            {!editing && (
              <label className="form-row">
                <span>{t('keys.customKey')}</span>
                <input
                  className="field mono"
                  value={f.customKey}
                  placeholder={t('keys.customKeyAuto')}
                  onChange={(e) => set('customKey', e.target.value)}
                  spellCheck={false}
                />
                {keyProblem && <em className="form-error">{t(keyProblem === 'short' ? 'keys.customKeyShort' : 'keys.customKeyChars')}</em>}
              </label>
            )}

            <div className="form-row">
              <span>{t('keys.expiry')}</span>
              <div className="seg seg-sm" role="radiogroup">
                {expiryOptions.map((x) => (
                  <button key={x} type="button" role="radio" aria-checked={f.expiry === x} className={f.expiry === x ? 'on' : ''} onClick={() => set('expiry', x)}>
                    {x === 'keep'
                      ? new Date(editing!.expires_at!).toLocaleDateString()
                      : x === 'never'
                        ? t('keys.never')
                        : t('keys.days', { n: x })}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-cols">
              <Money label={t('keys.quota')} value={f.quota} onChange={(v) => set('quota', v)} />
              <Money label={t('keys.limit5h')} value={f.limit5h} onChange={(v) => set('limit5h', v)} />
              <Money label={t('keys.limit1d')} value={f.limit1d} onChange={(v) => set('limit1d', v)} />
              <Money label={t('keys.limit7d')} value={f.limit7d} onChange={(v) => set('limit7d', v)} />
            </div>

            <div className="form-cols form-cols-2">
              <label className="form-row">
                <span>{t('keys.allowIps')}</span>
                <textarea className="field mono" rows={3} value={f.allow} placeholder={t('keys.anyIp')} onChange={(e) => set('allow', e.target.value)} spellCheck={false} />
              </label>
              <label className="form-row">
                <span>{t('keys.denyIps')}</span>
                <textarea className="field mono" rows={3} value={f.deny} placeholder={t('keys.noIp')} onChange={(e) => set('deny', e.target.value)} spellCheck={false} />
              </label>
            </div>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function Money({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <label className="form-row">
      <span>{label}</span>
      <div className="field-money">
        <i>$</i>
        <input className="field" inputMode="decimal" value={value} placeholder={t('keys.unlimited')} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>
    </label>
  );
}
