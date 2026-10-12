import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { Mark } from './Mark';

export function About({ version, onClose }: { version: string; onClose: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal aria-label={t('menu.about')}>
        <div className="about-mark">
          <Mark className="h-9 text-[#141414]" />
        </div>
        <h2 className="mt-4 text-[20px] font-bold tracking-tight">Cloudborne</h2>
        <p className="text-[13px] text-ink-3">栖云</p>
        <p className="mt-3 text-[13px] text-ink-2 tabular-nums">{t('about.version', { version: version || '—' })}</p>
        <button className="btn btn-quiet mt-6 h-9 w-full" onClick={onClose} autoFocus>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
