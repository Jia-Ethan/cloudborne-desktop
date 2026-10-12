import type { useUpdater } from '../update';

type Updater = ReturnType<typeof useUpdater>;

/**
 * Header control: the current version doubles as "check for updates"; once a
 * newer release is found it turns into the update-and-restart button.
 */
export function UpdateButton({ updater, onlyWhenAvailable = false }: { updater: Updater; onlyWhenAvailable?: boolean }) {
  const { state, current } = updater;

  if (state.kind === 'available' || state.kind === 'installing') {
    const installing = state.kind === 'installing';
    return (
      <button className="btn btn-primary update-pill h-8 px-3.5 text-[13px]" disabled={installing} onClick={updater.install}>
        {!installing && <span className="update-dot" />}
        {installing
          ? state.percent === null
            ? '正在下载…'
            : state.percent < 100
              ? `正在下载 ${state.percent}%`
              : '正在安装…'
          : `更新到 v${state.version}`}
      </button>
    );
  }

  if (onlyWhenAvailable) return null;

  const label =
    state.kind === 'checking'
      ? '正在检查…'
      : state.kind === 'latest'
        ? '已是最新版本'
        : state.kind === 'error'
          ? '检查失败'
          : current
            ? `v${current}`
            : '检查更新';

  return (
    <button
      className="btn btn-quiet h-8 px-3 text-[13px] font-medium text-ink-2"
      title={state.kind === 'error' ? state.message : '检查更新'}
      disabled={state.kind === 'checking'}
      onClick={updater.check}
    >
      {label}
    </button>
  );
}
