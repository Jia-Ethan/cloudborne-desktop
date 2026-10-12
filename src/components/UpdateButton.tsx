import { useI18n, type T } from '../i18n';
import type { UpdateState, Updater } from '../update';

/** Label for an update that is on offer or being installed. */
export function updateLabel(state: UpdateState, t: T): string | null {
  if (state.kind === 'available') return t('menu.updateTo', { version: state.version });
  if (state.kind !== 'installing') return null;
  if (state.percent === null) return t('update.downloading');
  return state.percent < 100 ? t('update.downloadingPct', { pct: state.percent }) : t('update.installing');
}

/** Pill shown only while a newer release is available or installing. */
export function UpdateButton({ updater }: { updater: Updater }) {
  const { t } = useI18n();
  const { state } = updater;
  const label = updateLabel(state, t);
  if (!label) return null;
  const installing = state.kind === 'installing';
  return (
    <button className="btn btn-primary update-pill h-8 px-3.5 text-[13px]" disabled={installing} onClick={updater.install}>
      {!installing && <span className="update-dot" />}
      {label}
    </button>
  );
}
