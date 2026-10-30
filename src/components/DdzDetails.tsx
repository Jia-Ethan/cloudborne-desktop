import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, errorText, type DdzVersus, type DdzVersusTally } from '../api';
import { byPlayAs, HERO_NAMES, rankLabel, rankOf, seatName, type Card, type Hero, type Move, type Seat, type SeatInfo, type Table } from '../ddz';
import { useI18n, type MessageKey } from '../i18n';
import { dollars } from '../lottery';
import { Dialog } from './Dialog';
import { PlayingCard } from './PlayingCard';

/** Inspecting a hero never sends an action or pauses the turn clock. */
export function HeroInfo({ hero, info, table, versusSeat, children }: { hero: Hero; info?: SeatInfo; table?: Table; versusSeat?: Seat; children: ReactNode }) {
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
      {table?.mode === 'laizi' ? <p>{t('ddz.laizi.noSkill')}</p> : <>
      <p>{HERO_NAMES[hero]} · {t(`ddz.skill.${hero}` as MessageKey)}</p>
      <p>{t(`ddz.skill.${hero}.desc` as MessageKey)}</p>
      <strong>{live ? t('ddz.skillRemaining',{n:info.skills,total:info.skill_total ?? (table.field==='overtime'?2:1)}) : t('ddz.skillDefault')}</strong>
      <p>{live ? t('ddz.skillTurn') : t('ddz.randomRole')}</p>
      </>}
      {info?.effects?.map(effect=><p key={effect}>{t('ddz.effectActive')} · {t(`ddz.skill.${effect}` as MessageKey)}</p>)}
      {info?.joker && <p>★ {t(`ddz.joker.${info.joker}` as MessageKey)} — {t(`ddz.joker.${info.joker}.desc` as MessageKey)}</p>}
      {info?.bot && <small>{t('ddz.systemBot')}</small>}
      {table && versusSeat !== undefined && versusSeat !== table.me && <VersusRecord seat={versusSeat} />}
    </div>,document.body)}</>;
}

/** What this seat has won from me (or lost to me) across every deal we shared; fetched each time the card opens. */
function VersusRecord({ seat }: { seat: Seat }) {
  const { t } = useI18n();
  const [data, setData] = useState<DdzVersus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.ddzVersus(seat).then(v => live && setData(v)).catch(e => live && setError(errorText(e, t('ddz.versus.error'))));
    return () => { live = false; };
  }, [seat, t]);
  return <section className="ddz-versus">
    <h4>{t('ddz.versus.title')}</h4>
    {error ? <small>{error}</small> : !data ? <small>{t('ddz.versus.loading')}</small> : <>
      <VersusLine tally={data} />
      {data.all_bots && <small>{t('ddz.versus.allBots')} · {versusHeadline(t, data.all_bots)}</small>}
    </>}
  </section>;
}

function versusHeadline(t: ReturnType<typeof useI18n>['t'], v: DdzVersusTally) {
  if (v.opponent_games === 0) return t('ddz.versus.none');
  if (v.net > 0) return t('ddz.versus.lostToMe', { amount: dollars(v.net) });
  if (v.net < 0) return t('ddz.versus.wonFromMe', { amount: dollars(-v.net) });
  return t('ddz.versus.even');
}

function VersusLine({ tally }: { tally: DdzVersusTally }) {
  const { t } = useI18n();
  const tone = tally.opponent_games === 0 ? '' : tally.net > 0 ? 'up' : tally.net < 0 ? 'down' : '';
  return <>
    <p className={tone}>{versusHeadline(t, tally)}</p>
    {tally.opponent_games > 0 && <small>{t('ddz.versus.counts', { games: tally.opponent_games, won: tally.won, lost: tally.lost })}</small>}
  </>;
}

/**
 * How a played card is marked: the rank a 混合专家 or 赖子 card stood for, or
 * which wild rank (天/地) a 赖子 counting as itself belongs to.
 */
function useWildMarks(move: Move, laizi?: number[] | null) {
  const { t } = useI18n();
  return (c: Card): { wildAs?: string; wildTag?: string } => {
    if (move.wild?.card === c) return { wildAs: rankLabel(move.wild.as * 4) };
    const tag = laizi?.includes(rankOf(c)) ? t(rankOf(c) === laizi[0] ? 'ddz.laizi.tian' : 'ddz.laizi.di') : undefined;
    const w = move.wilds?.find((x) => x.card === c);
    return { wildAs: w ? rankLabel(w.as * 4) : undefined, wildTag: tag };
  };
}

export function PlayCards({ move, compact = false, expand = true, laizi }: { move: Move; compact?: boolean; expand?: boolean; laizi?: number[] | null }) {
  const { t } = useI18n();
  const [open,setOpen]=useState(false);
  const cards=byPlayAs(move.cards ?? [], move.wilds);
  const ranks=cards.map(c=>c===52?t('ddz.smallJoker'):c===53?t('ddz.bigJoker'):rankLabel(c)).join(' ');
  const wild=move.wild ? ` · ${t('ddz.skill.minimax')} ${rankLabel(move.wild.card)}→${rankLabel(move.wild.as*4)}` : '';
  const wilds=move.wilds?.length ? ` · ${t('ddz.laizi.label')} ${move.wilds.map(w=>`${rankLabel(w.card)}→${rankLabel(w.as*4)}`).join(' ')}` : '';
  const label=`${move.pattern ? t(`ddz.kind.${move.pattern.kind}` as MessageKey) : ''} · ${ranks}${wild}${wilds}`;
  const mark=useWildMarks(move, laizi);
  const rows = Array.from({length:Math.ceil(cards.length/8)},(_,i)=>cards.slice(i*8,i*8+8));
  return <><button type="button" className={`ddz-play-cards ${compact?'compact':''}`} onClick={()=>expand && setOpen(true)} aria-label={t('ddz.expandPlay',{cards:label})}>
    {!compact && rows.map((row,i)=><span className="ddz-play-row" key={i}>{row.map((c,j)=><PlayingCard key={c} card={c} size="sm" {...mark(c)} style={{'--i':move.pattern?.kind==='pair_straight'?Math.floor((i*8+j)/2):i*8+j} as CSSProperties} />)}</span>)}
    <span className="ddz-play-label">{label}</span>
  </button>{open && <Dialog title={label} onClose={()=>setOpen(false)} className="ddz-sheet" wide><div className="ddz-expanded-cards">{cards.map(c=><PlayingCard key={c} card={c} size="md" {...mark(c)} />)}</div></Dialog>}</>;
}

export function PlayHistory({ table }: { table: Table }) {
  const { t }=useI18n();const [open,setOpen]=useState(false);
  return <><button className="ddz-chip ddz-chip-btn" onClick={()=>setOpen(true)}>{t('ddz.history')}</button>{open && <Dialog title={t('ddz.history')} onClose={()=>setOpen(false)} className="ddz-sheet" wide>
    {!table.history?.length ? <p>{t('ddz.historyEmpty')}</p> : <ol className="ddz-history">{[...table.history].reverse().map((m,i)=><li key={m.seq ?? i} className={m.reverted?'reverted':''}>
      <b>#{m.seq} · {table.seats[m.seat] ? seatName(table.seats[m.seat]!) : '—'}</b>
      {m.reverted && <strong>{t('ddz.reverted')}</strong>}
      {m.skill ? <span>{t(`ddz.skill.${m.skill}` as MessageKey)}</span> : m.cards?.length ? <HistoryCards move={m} laizi={table.laizi} /> : <span>{t('ddz.pass')}</span>}
    </li>)}</ol>}
  </Dialog>}</>;
}

function HistoryCards({ move, laizi }: { move: Move; laizi?: number[] | null }) {
  const mark = useWildMarks(move, laizi);
  return <div className="ddz-expanded-cards">{byPlayAs(move.cards ?? [], move.wilds).map(c=><PlayingCard key={c} card={c} size="sm" {...mark(c)} />)}</div>;
}
