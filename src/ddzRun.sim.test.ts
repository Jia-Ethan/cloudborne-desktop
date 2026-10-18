// DDZ_RUN_SIM=2000 npx vitest run src/ddzRun.sim.test.ts — plays whole runs
// with the hint bot on my seat and a greedy shopper, to tune the targets.
import { describe, expect, it, vi } from 'vitest';
import { SimTable } from './ddzSim';
import { buy, clear, dealSeed, dealSetup, fail, newRun, runTarget, scoreDeal, stage, type Run } from './ddzRun';
import { HEROES, type Table } from './ddz';

// Vitest runs on node; the app's tsconfig has no node types.
const env = (globalThis as { process?: { env: Record<string, string | undefined>; stderr: { write: (s: string) => void } } }).process!;
const N = Number(env.env.DDZ_RUN_SIM ?? 0);
// Replay lost deals: stands in for a player who wins more than the hint bot,
// so the targets are tuned on the score and not on how well the bot plays.
const RETRY = Number(env.env.DDZ_RUN_RETRY ?? 0);

function deal(run: Run, seed: number) {
  let last: Table | null = null;
  const sim = new SimTable((t) => (last = t), { delay: 0, base: 1, turnMs: 0, autoMe: true, hero: run.hero, run: dealSetup(run, seed) });
  sim.seat();
  sim.send({ type: 'ready' });
  vi.runAllTimers();
  const t = last as unknown as Table;
  const won = t.result?.winner === t.me;
  return { won, score: scoreDeal(run, sim.log, t.me, true).score, log: sim.log, me: t.me };
}

function shop(run: Run): Run {
  for (let pass = 0; pass < 6; pass++) {
    const order = run.shop!.map((it, i) => ({ it, i })).filter(({ it }) => !it.sold).sort((a, b) => (a.it.kind === 'joker' ? 0 : a.it.kind === 'level' ? 1 : 2) - (b.it.kind === 'joker' ? 0 : b.it.kind === 'level' ? 1 : 2));
    const next = order.map(({ i }) => buy(run, i)).find((r) => r);
    if (!next) break;
    run = next;
  }
  return run;
}

describe.runIf(N > 0)('run balance', () => {
  it('plays runs', { timeout: 600_000 }, () => {
    vi.useFakeTimers();
    const reached = new Array(10).fill(0);
    const ratio: number[][] = Array.from({ length: 9 }, () => []);
    const abs: number[][] = Array.from({ length: 9 }, () => []);
    let wins = 0, deals = 0;
    for (let k = 0; k < N; k++) {
      let run: Run | null = newRun(k + 1, HEROES[k % HEROES.length]);
      for (let d = 0; run; d++) {
        const st = stage(run);
        let r = deal(run, dealSeed(run) + d);
        for (let t = 1; !r.won && t <= RETRY; t++) r = deal(run, dealSeed(run) + d + 1000 * t);
        deals++;
        if (r.won) wins++;
        if (r.won) ratio[st].push(r.score / runTarget(run));
        if (r.won) abs[st].push(r.score);
        if (!r.won || r.score < runTarget(run)) {
          run = fail(run);
          if (!run) reached[st]++;
          continue;
        }
        run = clear(run, r.score, r.log, r.me);
        if (!run) { reached[9]++; break; }
        run = shop(run);
      }
    }
    const q = (xs: number[], p: number) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))].toFixed(2) : '-';
    const out = [
      `deal win rate ${(wins / deals).toFixed(3)}`,
      `runs ending at stage (0..8, 9=cleared): ${reached.join(' ')}`,
      ...ratio.map((xs, i) => `stage ${i}: wins ${xs.length}, score/target p25 ${q(xs, 0.25)} p50 ${q(xs, 0.5)} p75 ${q(xs, 0.75)}, score p50 ${q(abs[i], 0.5)}`),
    ];
    env.stderr.write(out.join('\n') + '\n');
    expect(deals).toBeGreaterThan(0);
  });
});
