// GTA VI trophy-rarity forecast (Node 22, standard library only).
// The model assumes trophy rates move partway toward a tier-specific mature rate over the forecast
// horizon. With at least three usable reads spanning six hours, it also assumes a shrunk, short-lived
// continuation of the trophy's historical logit trend. Its uncertainty grows with elapsed time and
// the size of the mature-rate movement; it does not model player counts or refresh timing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
const MATURE_RATE: Record<string, number> = {
  platinum: 4,
  gold: 28,
  silver: 50,
  bronze: 68,
};

interface Case {
  id: string;
  levels: number[];
  horizon_minutes: number;
  trophies: Array<{ id: number; tier: string }>;
  history: Array<{ at: string; rates: Array<number | null> }>;
}

const clampRate = (pct: number): number => Math.min(99.99, Math.max(0.01, pct));
const logit = (pct: number): number => {
  const p = clampRate(pct);
  return Math.log(p / (100 - p));
};
const fromLogit = (value: number): number => 100 / (1 + Math.exp(-value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
const RELEASE_TIME_MS = Date.parse('2026-11-19T00:00:00Z');

/** Least-squares logit slope in logits/hour, or zero without 3 reads spanning at least 6 hours. */
function trendSlope(history: Case['history'], trophyIndex: number): number {
  const points: Array<{ hours: number; value: number }> = [];
  for (const read of history) {
    const rate = read.rates[trophyIndex];
    const timestamp = Date.parse(read.at);
    if (typeof rate !== 'number' || !Number.isFinite(rate) || !Number.isFinite(timestamp)) continue;
    points.push({ hours: (timestamp - RELEASE_TIME_MS) / 3_600_000, value: logit(rate) });
  }
  if (points.length < 3) return 0;

  const xs = points.map((point) => point.hours);
  if (Math.max(...xs) - Math.min(...xs) < 6) return 0;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const dx = point.hours - meanX;
    covariance += dx * (point.value - meanY);
    variance += dx * dx;
  }
  return variance === 0 ? 0 : covariance / variance;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const file of readdirSync(INPUT_DIR).filter((name) => name.endsWith('.in')).sort()) {
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((level, i) => level !== LEVELS[i])) {
    throw new Error(`${file} has unexpected quantile levels`);
  }
  if (!Number.isFinite(c.horizon_minutes) || c.horizon_minutes < 0) {
    throw new Error(`${file} has an invalid forecast horizon`);
  }

  const days = c.horizon_minutes / 1440;
  const horizonPull = 1 - Math.exp(-days / 3.5);
  const forecasts = c.trophies.map((trophy, index) => {
    // Use the latest actual observation, not necessarily the final read if it omitted this trophy.
    let observed: number | undefined;
    for (let read = c.history.length - 1; read >= 0; read -= 1) {
      const rate = c.history[read].rates[index];
      if (typeof rate === 'number' && Number.isFinite(rate)) {
        observed = rate;
        break;
      }
    }

    // A trophy never observed is anchored at 1%; it otherwise uses its latest observed rate.
    const pNow = observed === undefined ? 1.0 : observed;
    const matureRate = MATURE_RATE[trophy.tier];
    if (matureRate === undefined) throw new Error(`unknown trophy tier: ${trophy.tier}`);

    const lNow = logit(pNow);
    const lInf = logit(matureRate);
    const movement = 0.55 * (lInf - lNow) * horizonPull;
    const slope = trendSlope(c.history, index);
    const trend = 0.35 * slope * 24 * Math.min(days, 2) * Math.exp(-days / 2);
    const targetLogit = lNow + movement + trend;
    const sigma = Math.sqrt(0.32 ** 2 * days + (0.18 * movement) ** 2);

    const q = Z.map((z) => round4(Math.min(100, Math.max(0, fromLogit(targetLogit + z * sigma)))));
    return { id: trophy.id, q };
  });

  writeFileSync(join(OUTPUT_DIR, `${c.id}.out`), `${JSON.stringify({ trophies: forecasts })}\n`);
}
