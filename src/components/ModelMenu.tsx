import { useEffect, useRef, useState } from 'react';
import { EFFORTS } from '../agent';
import { useI18n } from '../i18n';
import type { Agent } from '../useAgent';
import { Icon } from './Icon';

/** "GPT-5.5" style label for a model id like "gpt-5.5". */
export function modelName(id: string): string {
  return id
    .split('-')
    .map((part, i) => (i === 0 && /^gpt$/i.test(part) ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

/** Reasoning effort first, models in a submenu, like Codex's own picker. */
export function ModelMenu({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { models, model, effort } = agent;

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
        className="model-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('agent.modelMenu')}
        disabled={!models?.models.length}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bolt" className="size-[15px]" />
        <span>{model ? modelName(model).replace(/^GPT-/, '') : '—'}</span>
        <span className="text-ink-2">{t(`effort.${effort}`)}</span>
        <Icon name="chevronDown" className="size-3.5" />
      </button>
      {open && models && (
        <div className="menu model-menu" role="menu">
          <div className="menu-label">{t('agent.effort')}</div>
          {EFFORTS.map((e) => (
            <button
              key={e}
              className="menu-item"
              role="menuitemradio"
              aria-checked={e === effort}
              onClick={() => {
                agent.setEffort(e);
                setOpen(false);
              }}
            >
              <span className="flex-1">{t(`effort.${e}`)}</span>
              {e === effort && <Icon name="check" className="size-3.5" />}
            </button>
          ))}
          <div className="menu-sep" />
          <div className="submenu-wrap">
            <button className="menu-item" role="menuitem" aria-haspopup="menu">
              <span className="flex-1">{modelName(model)}</span>
              <Icon name="chevronRight" className="size-3.5 text-ink-3" />
            </button>
            <div className="menu submenu model-submenu" role="menu">
              <div className="menu-label">{t('agent.model')}</div>
              {models.models.map((m) => (
                <button
                  key={m}
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={m === model}
                  onClick={() => {
                    agent.setModel(m);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1">{modelName(m)}</span>
                  {m === model && <Icon name="check" className="size-3.5" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
