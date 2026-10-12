import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api, type User } from '../api';
import { LANGS, useI18n } from '../i18n';
import type { Updater } from '../update';
import { Icon } from './Icon';
import { updateLabel } from './UpdateButton';

// The relay's own home is a landing page; the account pages start at /keys.
const CONSOLE_PATH = '/keys';

function Avatar({ email }: { email: string }) {
  return (
    <span className="avatar" aria-hidden>
      {(email.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * Sidebar footer: avatar and email; clicking opens a glass menu upward with
 * console, language, updates, about and sign out.
 */
export function AccountMenu({
  user,
  updater,
  onAbout,
  onLogout,
}: {
  user: User;
  updater: Updater;
  onAbout: () => void;
  onLogout: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { state } = updater;
  const offer = updateLabel(state, t);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  const checkLabel =
    state.kind === 'checking'
      ? t('update.checking')
      : state.kind === 'latest'
        ? t('update.latest')
        : state.kind === 'error'
          ? t('update.failed')
          : t('menu.checkUpdate');

  return (
    <div ref={wrap} className="relative">
      {open && (
        <div className="menu account-menu" role="menu" aria-label={t('menu.account')}>
          <button
            className="menu-identity"
            title={t('menu.copyEmail')}
            onClick={async () => {
              await navigator.clipboard.writeText(user.email).catch(() => {});
              setCopied(true);
            }}
          >
            <b className="truncate">{user.email}</b>
            <span className={`menu-identity-copy ${copied ? 'copied' : ''}`}>
              <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
              {copied && t('common.copied')}
            </span>
          </button>

          <button
            className="menu-item"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await openUrl((await api.relayOrigin()) + CONSOLE_PATH);
            }}
          >
            <Icon name="console" />
            <span className="flex-1">{t('menu.console')}</span>
          </button>

          <div className="submenu-wrap">
            <button className="menu-item" role="menuitem" aria-haspopup="menu">
              <Icon name="globe" />
              <span className="flex-1">{t('menu.language')}</span>
              <span className="menu-meta">{LANGS.find((l) => l.id === lang)?.name}</span>
              <Icon name="chevronRight" className="size-3.5 text-ink-3" />
            </button>
            <div className="menu submenu" role="menu">
              {LANGS.map((l) => (
                <button key={l.id} className="menu-item" role="menuitemradio" aria-checked={l.id === lang} onClick={() => setLang(l.id)}>
                  <span className="flex-1">{l.name}</span>
                  {l.id === lang && <Icon name="check" className="size-3.5" />}
                </button>
              ))}
            </div>
          </div>

          {offer ? (
            <button className="menu-item" role="menuitem" disabled={state.kind === 'installing'} onClick={updater.install}>
              <Icon name="update" />
              <span className="flex-1">{offer}</span>
              <span className="update-dot" />
            </button>
          ) : (
            <button
              className="menu-item"
              role="menuitem"
              disabled={state.kind === 'checking'}
              title={state.kind === 'error' ? state.message : undefined}
              onClick={updater.check}
            >
              <Icon name="update" className={`size-4 ${state.kind === 'checking' ? 'animate-spin' : ''}`} />
              <span className="flex-1">{checkLabel}</span>
              {updater.current && <span className="menu-meta">v{updater.current}</span>}
            </button>
          )}

          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAbout();
            }}
          >
            <Icon name="info" />
            <span className="flex-1">{t('menu.about')}</span>
          </button>

          <div className="menu-sep" />
          <button className="menu-item danger" role="menuitem" onClick={onLogout}>
            <Icon name="logout" />
            <span className="flex-1">{t('menu.logout')}</span>
          </button>
        </div>
      )}

      <button className="account-button" aria-expanded={open} aria-label={t('menu.account')} onClick={() => setOpen((o) => !o)}>
        <Avatar email={user.email} />
        <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">{user.email}</span>
        {offer && <span className="update-dot" />}
      </button>
    </div>
  );
}
