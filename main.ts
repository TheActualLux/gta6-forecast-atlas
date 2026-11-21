// GTA VI trophy-rarity forecast (Node 22, standard library only).
// When the last 24 hours contain enough changing player-count observations, the model assumes
// log tracked players and log trophy earners each follow a local linear trend, extrapolated to the
// target with slope damping. Otherwise it assumes the latest observed rate persists. Both paths
// use the kit baseline's horizon-scaled logit spread; the model does not forecast refresh timing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

interface Case {
  id: string;
  levels: number[];
  horizon_minutes: number;
  trophies: Array<{ id: number }>;
  history: Array<{
    at: string;
    players_tracked: number;
    rates: Array<number | null>;
  }>;
}

const clampRate = (pct: number): number => Math.min(99.99, Math.max(0.01, pct));
const logit = (pct: number): number => {
  const p = clampRate(pct);
  return Math.log(p / (100 - p));
};
const fromLogit = (value: number): number => 100 / (1 + Math.exp(-value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
const RELEASE_TIME_MS = Date.parse('2026-11-19T00:00:00Z');
const HOUR_MS = 3_600_000;

interface TrendPoint {
  hours: number;
  players: number;
  earners: number;
}

/** Fit a least-squares line and evaluate it at x. */
function fitAt(points: Array<{ x: number; y: number }>, x: number): { value: number; slope: number } {
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    covariance += dx * (point.y - meanY);
    variance += dx * dx;
  }
  const slope = variance === 0 ? 0 : covariance / variance;
  return { value: meanY + slope * (x - meanX), slope };
}

/** Project a rate from separate log-player and log-earner trends, or return undefined if ineligible. */
function projectFromCounts(
  c: Case,
  trophyIndex: number,
  checkpointMs: number,
  horizonHours: number,
): number | undefined {
  const windowStart = checkpointMs - 24 * HOUR_MS;
  const points: TrendPoint[] = [];
  const distinctPlayers = new Set<number>();
  for (const read of c.history) {
    const timestamp = Date.parse(read.at);
    const rate = read.rates[trophyIndex];
    const players = read.players_tracked;
    if (
      !Number.isFinite(timestamp) || timestamp < windowStart || timestamp > checkpointMs ||
      typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 100 ||
      !Number.isFinite(players) || players <= 0
    ) continue;
    const earners = (rate / 100) * players;
    if (!Number.isFinite(earners) || earners <= 0) continue;
    points.push({
      hours: (timestamp - RELEASE_TIME_MS) / HOUR_MS,
      players: Math.log(players),
      earners: Math.log(earners),
    });
    distinctPlayers.add(players);
  }
  if (points.length < 3) return undefined;
  const hours = points.map((point) => point.hours);
  if (Math.max(...hours) - Math.min(...hours) < 6) return undefined;
  if (distinctPlayers.size < 2) return undefined;

  const checkpointHours = (checkpointMs - RELEASE_TIME_MS) / HOUR_MS;
  const playerFit = fitAt(points.map(({ hours: x, players: y }) => ({ x, y })), checkpointHours);
  const earnerFit = fitAt(points.map(({ hours: x, earners: y }) => ({ x, y })), checkpointHours);
  const damping = Math.exp(-horizonHours / 96);
  const logPlayersTarget = playerFit.value + playerFit.slope * horizonHours * damping;
  const logEarnersTarget = earnerFit.value + earnerFit.slope * horizonHours * damping;
  return Math.min(99.99, Math.max(0.01, 100 * Math.exp(logEarnersTarget - logPlayersTarget)));
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
  const checkpointMs = Date.parse(c.at);
  if (!Number.isFinite(checkpointMs)) throw new Error(`${file} has an invalid checkpoint time`);
  const lastRead = c.history[c.history.length - 1];
  if (lastRead === undefined) throw new Error(`${file} has no history`);

  const days = c.horizon_minutes / 1440;
  const horizonHours = days * 24;
  const spread = 0.5 * Math.sqrt(days);
  const forecasts = c.trophies.map((trophy, index) => {
    // Persistence means the case's final read; a missing final observation uses the baseline's 0% anchor.
    const persistedRate = lastRead.rates[index] ?? 0;
    const projectedRate = projectFromCounts(c, index, checkpointMs, horizonHours);
    const targetLogit = logit(projectedRate ?? persistedRate);
    const q = Z.map((z) => round4(Math.min(100, Math.max(0, fromLogit(targetLogit + z * spread)))));
    return { id: trophy.id, q };
  });

  writeFileSync(join(OUTPUT_DIR, `${c.id}.out`), `${JSON.stringify({ trophies: forecasts })}\n`);
}
