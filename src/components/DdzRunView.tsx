import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { rankLabel, type Action, type Hero, type Table } from '../ddz';
import {
  ACTS,
  GROUPS,
  LEVELS,
  LEVEL_CHIPS,
  MAX_SLOTS,
  REROLL_PRICE,
  RUN_JOKERS,
  bossOf,
  buy,
  clear,
  dealSeed,
  dealSetup,
  fail,
  heroOffer,
  moveJoker,
  newRun,
  readBest,
  reroll,
  reward,
  runTarget,
  saveBest,
  scoreDeal,
  sell,
  sellPrice,
  stage,
  type Best,
  type Run,
  type RunJokerId,
  type Score,
  type ScoreLine,
  type ShopItem,
} from '../ddzRun';
import { SimTable } from '../ddzSim';
import { useI18n, type MessageKey, type T } from '../i18n';
import { climbTick, cue } from '../ddzSound';
import { Icon } from './Icon';
import { HeroBadge, TableScene } from './DdzView';

const NAME_OF: Record<Hero, string> = { gpt: 'GPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', deepseek: 'DeepSeek', kimi: 'Kimi', glm: 'GLM', minimax: 'MiniMax', qwen: 'Qwen' };

/** 闯关 in the lobby: what it is, the best run so far, and the way in. */
export function RunCard({ onStart }: { onStart: () => void }) {
  const { t } = useI18n();
  const best = useMemo(readBest, []);
  return (
    <section className="card ddz-run-card rise" style={{ '--i': 1 } as CSSProperties}>
      <div className="ddz-run-card-text">
        <h2>
          {t('ddz.run.title')}
          <span className="ddz-tag">{t('ddz.run.proto')}</span>
        </h2>
        <p>{t('ddz.run.tagline')}</p>
        {best && <small>{t('ddz.run.best', { stage: stageName(best.stage, t), total: best.total })}</small>}
      </div>
      <button className="btn btn-primary ddz-go" onClick={onStart}>
        <Icon name="sparkle" className="size-4" />
        {t('ddz.run.start')}
      </button>
    </section>
  );
}

const stageName = (st: number, t: T) =>
  st >= ACTS * LEVELS ? t('ddz.run.cleared') : t('ddz.run.stage', { act: Math.floor(st / LEVELS) + 1, level: (st % LEVELS) + 1 });

type Phase = 'hero' | 'deal' | 'shop' | 'end';

/**
 * The run, all local: the hero pick, each deal on a simulated table, the
 * shop between deals and the end. Leaves through onExit.
 */
export function DdzRunView({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  const seed = useMemo(() => (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0, []);
  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<Phase>('hero');
  const [table, setTable] = useState<Table | null>(null);
  const [ended, setEnded] = useState<{ won: boolean; best: Best } | null>(null);
  const sim = useRef<SimTable | null>(null);
  useEffect(() => () => sim.current?.stop(), []);

  const deal = (r: Run) => {
    sim.current?.stop();
    const s = new SimTable(setTable, { delay: 650, base: 1, turnMs: 0, hero: r.hero, run: dealSetup(r, dealSeed(r)) });
    sim.current = s;
    s.seat();
    s.send({ type: 'ready' });
    setRun(r);
    setPhase('deal');
  };
  const finish = (r: Run, won: boolean) => {
    sim.current?.stop();
    const total = r.scores.reduce((a, b) => a + b, 0);
    setEnded({ won, best: saveBest({ stage: won ? ACTS * LEVELS : stage(r), total }) });
    setRun(r);
    setPhase('end');
  };

  if (phase === 'hero' || !run) return <HeroPick seed={seed} onPick={(h) => deal(newRun(seed, h))} onExit={onExit} />;
  if (phase === 'end') return <RunEnd run={run} won={ended?.won ?? false} best={ended?.best ?? null} onAgain={() => { setRun(null); setPhase('hero'); }} onExit={onExit} />;
  if (phase === 'shop') return <Shop run={run} onRun={setRun} onNext={() => deal({ ...run, shop: null })} />;
  if (!table) return null;

  const send = (a: Action) => sim.current?.send(a);
  const log = sim.current?.log ?? [];
  const done = table.phase === 'over';
  const score = scoreDeal(run, log, table.me, done);
  const won = done && table.result?.winner === table.me;
  return (
    <TableScene
      key={`${stage(run)}:${run.tries}`}
      table={table}
      conn="open"
      send={send}
      run={{
        hud: <RunHud run={run} score={score} table={table} />,
        leaveBody: t('ddz.run.leaveBody'),
        onLeave: () => finish(run, false),
        over: (
          <DealEnd
            run={run}
            score={score}
            won={won}
            onNext={() => {
              if (won && score.score >= runTarget(run)) {
                const next = clear(run, score.score, log, table.me);
                if (!next) return finish({ ...run, scores: [...run.scores, score.score] }, true);
                setRun(next);
                setPhase('shop');
                return;
              }
              const again = fail(run);
              if (again) deal(again);
              else finish(run, false);
            }}
          />
        ),
      }}
    />
  );
}

function HeroPick({ seed, onPick, onExit }: { seed: number; onPick: (h: Hero) => void; onExit: () => void }) {
  const { t } = useI18n();
  const offer = useMemo(() => heroOffer(seed), [seed]);
  return (
    <div className="main-scroll">
      <div className="main-column ddz-run-page">
        <header className="ddz-run-head">
          <button className="ddz-chip ddz-chip-btn" onClick={onExit} aria-label={t('ddz.leave')}>
            <Icon name="chevronLeft" className="size-4" />
          </button>
          <h1>{t('ddz.run.title')}</h1>
        </header>
        <p className="ddz-run-lede">{t('ddz.run.rules')}</p>
        <h2 className="ddz-run-sub">{t('ddz.run.pickHero')}</h2>
        <div className="ddz-run-heroes">
          {offer.map((h) => (
            <button key={h} className="card ddz-run-hero" onClick={() => onPick(h)}>
              <HeroBadge hero={h} size="lg" />
              <b>{NAME_OF[h]}</b>
              <strong>{t(`ddz.skill.${h}` as MessageKey)}</strong>
              <span>{t(`ddz.skill.${h}.desc` as MessageKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The run's bar over the table: where I am, the target, and the score as it builds. */
function RunHud({ run, score, table }: { run: Run; score: Score; table: Table }) {
  const { t } = useI18n();
  const boss = bossOf(run);
  const goal = runTarget(run);
  const pct = Math.min(100, (score.score / goal) * 100);
  const last = [...score.lines].reverse().find((l) => l.chips !== undefined && l.source !== 'base');
  return (
    <div className="ddz-run-hud">
      <span className="ddz-chip">
        <b>{t('ddz.run.stage', { act: run.act + 1, level: run.level + 1 })}</b>
        <small>{'♥'.repeat(run.lives)}</small>
      </span>
      {boss && (
        <span className="ddz-chip ddz-run-boss" title={t(`ddz.run.boss.${boss}.desc` as MessageKey)}>
          {t(`ddz.run.boss.${boss}` as MessageKey)}
        </span>
      )}
      <div className={`ddz-run-meter ${score.score >= goal ? 'met' : ''}`} title={t('ddz.run.meterHint')}>
        <span className="ddz-run-calc">
          <b key={score.chips}>{score.chips}</b>×<b key={score.mult}>{fmt(score.mult)}</b>=<strong>{score.score}</strong>
          <small>/ {goal}</small>
        </span>
        <span className="ddz-run-bar"><i style={{ width: `${pct}%` }} /></span>
        {last && table.phase === 'play' && <span key={last.seq} className="ddz-run-pop">+{last.chips}</span>}
      </div>
      <RunJokers run={run} />
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function RunJokers({ run, onSell, onMove }: { run: Run; onSell?: (k: number) => void; onMove?: (k: number, by: -1 | 1) => void }) {
  const { t } = useI18n();
  const asleep = bossOf(run) === 'offline' && !onSell ? 0 : -1;
  return (
    <div className="ddz-run-jokers" aria-label={t('ddz.run.jokers')}>
      {Array.from({ length: run.slots }, (_, k) => {
        const j = run.jokers[k];
        if (!j) return <span key={k} className="ddz-run-joker empty" />;
        return (
          <span key={k} className={`ddz-run-joker r-${RUN_JOKERS[j.id]} ${k === asleep ? 'asleep' : ''}`} title={jokerText(j.id, j.grow, t)} tabIndex={0}>
            <b>{t(`ddz.run.j.${j.id}` as MessageKey)}</b>
            {j.grow > 0 && <i>+{j.grow}</i>}
            {onSell && (
              <span className="ddz-run-joker-tools">
                <button onClick={() => onMove?.(k, -1)} disabled={k === 0} aria-label={t('ddz.run.moveLeft')}>‹</button>
                <button onClick={() => onSell(k)}>{t('ddz.run.sell', { gold: sellPrice(j.id) })}</button>
                <button onClick={() => onMove?.(k, 1)} disabled={k === run.jokers.length - 1} aria-label={t('ddz.run.moveRight')}>›</button>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

const jokerText = (id: RunJokerId, grow: number, t: T) =>
  `${t(`ddz.run.j.${id}` as MessageKey)}：${t(`ddz.run.j.${id}.desc` as MessageKey)}${grow ? ` ${t('ddz.run.grown', { n: grow })}` : ''}`;

function lineLabel(l: ScoreLine, t: T): string {
  if (l.source === 'base') return t('ddz.run.base');
  if (l.source.startsWith('kind.')) return t(`ddz.${l.source}` as MessageKey);
  if (l.source.startsWith('j.')) return t(`ddz.run.${l.source}` as MessageKey);
  return t(`ddz.step.${l.source}` as MessageKey);
}

/** After a deal: the score climbing to its total against the target, and what comes next. */
function DealEnd({ run, score, won, onNext }: { run: Run; score: Score; won: boolean; onNext: () => void }) {
  const { t } = useI18n();
  const goal = runTarget(run);
  const passed = won && score.score >= goal;
  const lastStage = stage(run) === ACTS * LEVELS - 1;
  const g = reward(run, score.score);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    cue(passed ? 'win' : 'lose');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(i);
      if (i <= 12) climbTick(i, false);
      if (i >= 20) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, []);
  const value = Math.round((score.score * shown) / 20);
  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; chips: number; add: number; times: number; n: number }>();
    for (const l of score.lines) {
      const label = lineLabel(l, t);
      const cur = m.get(label) ?? { label, chips: 0, add: 0, times: 1, n: 0 };
      cur.chips += l.chips ?? 0;
      cur.add += l.add ?? 0;
      cur.times *= l.times ?? 1;
      cur.n++;
      m.set(label, cur);
    }
    return [...m.values()];
  }, [score, t]);
  const verdict = passed ? t('ddz.run.passed') : won ? t('ddz.run.short') : t('ddz.run.lost');
  const lives = run.lives - (passed ? 0 : 1);
  return (
    <div className="ddz-result-wrap">
      <div className={`ddz-result ddz-run-result ${passed ? 'won' : 'lost'}`} role="dialog" aria-modal="true" aria-label={verdict}>
        <div className="ddz-result-body">
          <div className="ddz-result-head">
            <span className="ddz-result-badge">{t('ddz.run.stage', { act: run.act + 1, level: run.level + 1 })}</span>
            <b className="ddz-result-amount">{value}</b>
            <span className="ddz-result-caption">{t('ddz.run.vsTarget', { target: goal })} · {verdict}</span>
            <div className="ddz-climb">
              <span className="ddz-climb-base">{score.chips}</span>
              <span className="ddz-climb-x">×</span>
              <b className="ddz-climb-mult">{fmt(score.mult)}</b>
            </div>
          </div>
          <ul className="ddz-steps ddz-run-lines">
            {grouped.map((l) => (
              <li key={l.label} className={l.chips ? 'add' : 'times'}>
                <span>{l.label}{l.n > 1 ? ` ×${l.n}` : ''}</span>
                <b>{l.chips ? `+${l.chips}` : l.add ? `+${fmt(l.add)}` : `×${fmt(l.times)}`}</b>
              </li>
            ))}
          </ul>
          {passed && !lastStage && (
            <p className="ddz-run-gold">{t('ddz.run.goldGot', { base: g.base, over: g.over, interest: g.interest })}</p>
          )}
          {!passed && <p className="ddz-run-gold">{lives > 0 ? t('ddz.run.livesLeft', { n: lives }) : t('ddz.run.noLives')}</p>}
        </div>
        <div className="ddz-result-actions">
          <button className="btn btn-primary" autoFocus onClick={onNext}>
            {passed ? (lastStage ? t('ddz.run.finish') : t('ddz.run.toShop')) : lives > 0 ? t('ddz.run.retry') : t('ddz.run.finish')}
          </button>
        </div>
      </div>
    </div>
  );
}

function itemName(it: ShopItem, t: T): string {
  switch (it.kind) {
    case 'joker': return t(`ddz.run.j.${it.id}` as MessageKey);
    case 'level': return t('ddz.run.item.level', { kind: t(`ddz.run.group.${it.group}` as MessageKey) });
    case 'add': return t('ddz.run.item.add', { rank: it.rank >= 13 ? t(it.rank === 14 ? 'ddz.bigJoker' : 'ddz.smallJoker') : rankLabel(it.rank * 4) });
    case 'cut': return t('ddz.run.item.cut');
    case 'skill': return t('ddz.run.item.skill');
    case 'slot': return t('ddz.run.item.slot');
  }
}

function itemDesc(it: ShopItem, run: Run, t: T): string {
  switch (it.kind) {
    case 'joker': return t(`ddz.run.j.${it.id}.desc` as MessageKey);
    case 'level': return t('ddz.run.item.level.desc', { n: LEVEL_CHIPS[it.group], lv: run.levels[it.group] + 1 });
    case 'add': return t('ddz.run.item.add.desc');
    case 'cut': return t('ddz.run.item.cut.desc');
    case 'skill': return t('ddz.run.item.skill.desc', { hero: t(`ddz.skill.${run.hero}` as MessageKey), n: run.skills + 1 });
    case 'slot': return t('ddz.run.item.slot.desc', { n: Math.min(MAX_SLOTS, run.slots + 1) });
  }
}

function Shop({ run, onRun, onNext }: { run: Run; onRun: (r: Run) => void; onNext: () => void }) {
  const { t } = useI18n();
  const boss = bossOf(run);
  const levels = GROUPS.filter((g) => run.levels[g] > 0);
  return (
    <div className="main-scroll">
      <div className="main-column ddz-run-page">
        <header className="ddz-run-head">
          <h1>{t('ddz.run.shop')}</h1>
          <span className="ddz-run-gold-chip">{t('ddz.run.gold', { n: run.gold })}</span>
        </header>
        <p className="ddz-run-lede">
          {t('ddz.run.next', { stage: stageName(stage(run), t), target: runTarget(run) })}
          {boss && <> · <b>{t(`ddz.run.boss.${boss}` as MessageKey)}</b>：{t(`ddz.run.boss.${boss}.desc` as MessageKey)}</>}
        </p>

        <h2 className="ddz-run-sub">{t('ddz.run.jokers')} <small>{run.jokers.length}/{run.slots}</small></h2>
        <RunJokers run={run} onSell={(k) => onRun(sell(run, k))} onMove={(k, by) => onRun(moveJoker(run, k, by))} />

        <h2 className="ddz-run-sub">{t('ddz.run.shelf')}</h2>
        <div className="ddz-run-shelf">
          {run.shop?.map((it, i) => {
            const full = it.kind === 'joker' && run.jokers.length >= run.slots;
            const can = !it.sold && run.gold >= it.price && !full;
            return (
              <button
                key={i}
                className={`card ddz-run-item k-${it.kind} ${it.kind === 'joker' ? `r-${RUN_JOKERS[it.id]}` : ''} ${it.sold ? 'sold' : ''}`}
                disabled={!can}
                onClick={() => {
                  const next = buy(run, i);
                  if (next) {
                    cue('skill');
                    onRun(next);
                  }
                }}
              >
                <span className="ddz-run-item-kind">{t(`ddz.run.kind.${it.kind}` as MessageKey)}</span>
                <b>{itemName(it, t)}</b>
                <span>{itemDesc(it, run, t)}</span>
                <strong>{it.sold ? t('ddz.run.sold') : full ? t('ddz.run.full') : t('ddz.run.gold', { n: it.price })}</strong>
              </button>
            );
          })}
        </div>

        {levels.length > 0 && (
          <p className="ddz-run-levels">
            {levels.map((g) => `${t(`ddz.run.group.${g}` as MessageKey)} Lv${run.levels[g] + 1}`).join(' · ')}
          </p>
        )}
        {run.deck.length > 0 && (
          <p className="ddz-run-levels">
            {t('ddz.run.deck')}：
            {run.deck.map((m) => (m.kind === 'cut' ? t('ddz.run.item.cut') : t('ddz.run.item.add', { rank: m.rank >= 13 ? t(m.rank === 14 ? 'ddz.bigJoker' : 'ddz.smallJoker') : rankLabel(m.rank * 4) }))).join(' · ')}
          </p>
        )}

        <div className="ddz-run-actions">
          <button className="btn btn-quiet" disabled={run.gold < REROLL_PRICE} onClick={() => { const r = reroll(run); if (r) onRun(r); }}>
            {t('ddz.run.reroll', { gold: REROLL_PRICE })}
          </button>
          <button className="btn btn-primary" onClick={onNext}>
            {t('ddz.run.go')}
            <Icon name="chevronRight" className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function RunEnd({ run, won, best, onAgain, onExit }: { run: Run; won: boolean; best: Best | null; onAgain: () => void; onExit: () => void }) {
  const { t } = useI18n();
  const total = run.scores.reduce((a, b) => a + b, 0);
  return (
    <div className="main-scroll">
      <div className="main-column ddz-run-page">
        <section className={`card ddz-run-end ${won ? 'won' : ''}`}>
          <HeroBadge hero={run.hero} size="lg" />
          <h1>{won ? t('ddz.run.victory') : t('ddz.run.over')}</h1>
          <p>{t('ddz.run.reached', { stage: stageName(won ? ACTS * LEVELS : stage(run), t), total })}</p>
          {best && <small>{t('ddz.run.best', { stage: stageName(best.stage, t), total: best.total })}</small>}
          {run.jokers.length > 0 && (
            <div className="ddz-run-jokers-end">
              <RunJokers run={{ ...run, slots: run.jokers.length }} />
            </div>
          )}
          <div className="ddz-run-actions">
            <button className="btn btn-quiet" onClick={onExit}>{t('ddz.run.exit')}</button>
            <button className="btn btn-primary" autoFocus onClick={onAgain}>{t('ddz.run.again')}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
