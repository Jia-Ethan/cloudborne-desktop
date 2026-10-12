import { useEffect, useRef, useState } from 'react';
import { LANGS, useI18n } from '../i18n';
import { Icon } from './Icon';

/** Language dropdown for the login screen's top-right corner. */
export function LanguagePicker() {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={wrap} className="relative">
      <button
        className="lang-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('menu.language')}
        data-state={open ? 'open' : 'closed'}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="globe" className="size-[15px]" />
        {LANGS.find((l) => l.id === lang)?.name}
        <Icon name="chevronDown" className="lang-chevron size-3.5" />
      </button>
      {open && (
        <div className="menu lang-menu" role="menu">
          {LANGS.map((l) => (
            <button
              key={l.id}
              className="menu-item"
              role="menuitemradio"
              aria-checked={l.id === lang}
              onClick={() => {
                setLang(l.id);
                setOpen(false);
              }}
            >
              <span className="flex-1">{l.name}</span>
              {l.id === lang && <Icon name="check" className="size-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
