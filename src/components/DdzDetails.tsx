import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { byPlay, HERO_NAMES, rankLabel, seatName, type Hero, type Move, type SeatInfo, type Table } from '../ddz';
import { useI18n, type MessageKey } from '../i18n';
import { Dialog } from './Dialog';
import { PlayingCard } from './PlayingCard';

/** Inspecting a hero never sends an action or pauses the turn clock. */
export function HeroInfo({ hero, info, table, children }: { hero: Hero; info?: SeatInfo; table?: Table; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 80, left: 20 });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(300, window.innerWidth - 24);
      const x = box.left > window.innerWidth / 2 ? box.left - width - 12 : box.right + 12;
      setPosition({ left: Math.max(12, Math.min(x, window.innerWidth - width - 12)), top: Math.max(20, Math.min(box.top, window.innerHeight - 340)) });
    };
    place();panel.current?.focus();
    const close = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation();setOpen(false);trigger.current?.focus(); } };
    window.addEventListener('resize', place);document.addEventListener('pointerdown',close);window.addEventListener('keydown',key,true);
    return () => {window.removeEventListener('resize',place);document.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key,true);};
  }, [open]);
  const live = info && table && table.phase !== 'waiting';
  return <><button ref={trigger} type="button" className="ddz-avatar-button" aria-expanded={open} aria-label={t('ddz.inspectHero',{name:HERO_NAMES[hero]})} onClick={()=>setOpen(!open)}>{children}</button>{open && createPortal(
    <div ref={panel} tabIndex={-1} role="dialog" data-ddz-info className="ddz-hero-info" style={position} aria-label={HERO_NAMES[hero]}>
      <button className="ddz-info-close" aria-label={t('common.close')} onClick={()=>{setOpen(false);trigger.current?.focus();}}>×</button>
      <h3>{info ? seatName(info) : HERO_NAMES[hero]}</h3>
      <p>{HERO_NAMES[hero]} · {t(`ddz.skill.${hero}` as MessageKey)}</p>
      <p>{t(`ddz.skill.${hero}.desc` as MessageKey)}</p>
      <strong>{live ? t('ddz.skillRemaining',{n:info.skills,total:info.skill_total ?? (table.field==='overtime'?2:1)}) : t('ddz.skillDefault')}</strong>
      <p>{live ? t('ddz.skillTurn') : t('ddz.randomRole')}</p>
      {info?.effects?.map(effect=><p key={effect}>{t('ddz.effectActive')} · {t(`ddz.skill.${effect}` as MessageKey)}</p>)}
      {info?.joker && <p>★ {t(`ddz.joker.${info.joker}` as MessageKey)} — {t(`ddz.joker.${info.joker}.desc` as MessageKey)}</p>}
      {info?.bot && <small>{t('ddz.systemBot')}</small>}
    </div>,document.body)}</>;
}

export function PlayCards({ move, compact = false, expand = true }: { move: Move; compact?: boolean; expand?: boolean }) {
  const { t } = useI18n();
  const [open,setOpen]=useState(false);
  const cards=byPlay(move.cards ?? []);
  const ranks=cards.map(c=>c===52?t('ddz.smallJoker'):c===53?t('ddz.bigJoker'):rankLabel(c)).join(' ');
  const label=`${move.pattern ? t(`ddz.kind.${move.pattern.kind}` as MessageKey) : ''} · ${ranks}`;
  const rows = Array.from({length:Math.ceil(cards.length/8)},(_,i)=>cards.slice(i*8,i*8+8));
  return <><button type="button" className={`ddz-play-cards ${compact?'compact':''}`} onClick={()=>expand && setOpen(true)} aria-label={t('ddz.expandPlay',{cards:label})}>
    {!compact && rows.map((row,i)=><span className="ddz-play-row" key={i}>{row.map(c=><PlayingCard key={c} card={c} size="sm" />)}</span>)}
    <span className="ddz-play-label">{label}</span>
  </button>{open && <Dialog title={label} onClose={()=>setOpen(false)} className="ddz-sheet" wide><div className="ddz-expanded-cards">{cards.map(c=><PlayingCard key={c} card={c} size="md" />)}</div></Dialog>}</>;
}

export function PlayHistory({ table }: { table: Table }) {
  const { t }=useI18n();const [open,setOpen]=useState(false);
  return <><button className="ddz-chip ddz-chip-btn" onClick={()=>setOpen(true)}>{t('ddz.history')}</button>{open && <Dialog title={t('ddz.history')} onClose={()=>setOpen(false)} className="ddz-sheet" wide>
    {!table.history?.length ? <p>{t('ddz.historyEmpty')}</p> : <ol className="ddz-history">{[...table.history].reverse().map((m,i)=><li key={m.seq ?? i} className={m.reverted?'reverted':''}>
      <b>#{m.seq} · {table.seats[m.seat] ? seatName(table.seats[m.seat]!) : '—'}</b>
      {m.reverted && <strong>{t('ddz.reverted')}</strong>}
      {m.skill ? <span>{t(`ddz.skill.${m.skill}` as MessageKey)}</span> : m.cards?.length ? <div className="ddz-expanded-cards">{byPlay(m.cards).map(c=><PlayingCard key={c} card={c} size="sm" />)}</div> : <span>{t('ddz.pass')}</span>}
    </li>)}</ol>}
  </Dialog>}</>;
}
