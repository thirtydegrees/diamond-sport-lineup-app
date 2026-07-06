/* ============================================
   Diamond Lineup - Season Analytics

   Pure computations over saved games and pitch history.
   Everything here is presentation-agnostic so the Stats
   view (and later, server-side reports) can share it.
   ============================================ */

import { getPositionGroup } from './constants';
import type { Assignment, Game, PitchRecord, Player } from './types';

export type PositionGroupKey = 'P' | 'C' | 'IF' | 'OF' | 'SIT';

export interface PlayerSeasonStats {
  playerId: string;
  name: string;
  gamesPlayed: number;
  /** Innings with any assignment, bench included. */
  innings: number;
  byGroup: Record<PositionGroupKey, number>;
  byPosition: Partial<Record<Assignment, number>>;
  sits: number;
  /** Share of tracked innings spent on the bench (0-1). */
  sitShare: number;
}

export interface PitcherGameLoad {
  gameId: string;
  date: string;
  opponent: string;
  pitches: number;
  inningsPitched: number;
}

export interface PitcherSeasonStats {
  playerId: string;
  name: string;
  games: number;
  totalPitches: number;
  totalInnings: number;
  avgPitches: number;
  /** Pitches thrown in the 7 calendar days ending at `today` (inclusive). */
  last7Pitches: number;
  /** Chronological, oldest first. */
  perGame: PitcherGameLoad[];
}

export interface DateRange {
  from?: string; // YYYY-MM-DD inclusive
  to?: string;   // YYYY-MM-DD inclusive
}

function inRange(date: string, range?: DateRange): boolean {
  if (!range) return true;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function groupOf(pos: Assignment): PositionGroupKey {
  if (pos === 'SIT') return 'SIT';
  if (pos === 'P') return 'P';
  if (pos === 'C') return 'C';
  return getPositionGroup(pos) === 'infield' ? 'IF' : 'OF';
}

/** Order segments render in the stacked chart. Fixed - never resorted. */
export const GROUP_ORDER: PositionGroupKey[] = ['P', 'C', 'IF', 'OF', 'SIT'];

export const GROUP_LABELS: Record<PositionGroupKey, string> = {
  P: 'Pitcher',
  C: 'Catcher',
  IF: 'Infield',
  OF: 'Outfield',
  SIT: 'Bench'
};

/**
 * Per-player position distribution across saved games.
 * Returned in roster order; players with no tracked innings included
 * (so a kid who missed every game still shows up, honestly, with zeros).
 */
export function computeSeasonStats(
  games: Game[],
  roster: Player[],
  range?: DateRange
): PlayerSeasonStats[] {
  const byPlayer = new Map<string, PlayerSeasonStats>();
  roster.forEach(p => {
    byPlayer.set(p.id, {
      playerId: p.id,
      name: p.name,
      gamesPlayed: 0,
      innings: 0,
      byGroup: { P: 0, C: 0, IF: 0, OF: 0, SIT: 0 },
      byPosition: {},
      sits: 0,
      sitShare: 0
    });
  });

  for (const game of games) {
    if (!inRange(game.date, range)) continue;
    const playedThisGame = new Set<string>();

    for (const [key, pos] of Object.entries(game.lineup || {})) {
      const playerId = key.slice(0, key.lastIndexOf('-'));
      const stats = byPlayer.get(playerId);
      if (!stats) continue; // player no longer on roster

      stats.innings++;
      stats.byGroup[groupOf(pos)]++;
      stats.byPosition[pos] = (stats.byPosition[pos] || 0) + 1;
      if (pos === 'SIT') stats.sits++;
      playedThisGame.add(playerId);
    }

    playedThisGame.forEach(id => {
      const stats = byPlayer.get(id);
      if (stats) stats.gamesPlayed++;
    });
  }

  for (const stats of byPlayer.values()) {
    stats.sitShare = stats.innings > 0 ? stats.sits / stats.innings : 0;
  }

  return roster.map(p => byPlayer.get(p.id)!);
}

/**
 * Per-pitcher workload from pitch history. Includes every roster player
 * with at least one record; sorted by total pitches, heaviest first.
 */
export function computePitchingStats(
  history: PitchRecord[],
  roster: Player[],
  games: Game[],
  today: string,
  range?: DateRange
): PitcherSeasonStats[] {
  const opponentByGame = new Map<string, string>();
  games.forEach(g => opponentByGame.set(g.id, g.opponent || ''));

  const byPlayer = new Map<string, PitcherSeasonStats>();

  for (const record of history) {
    if (!inRange(record.date, range)) continue;
    const player = roster.find(p => p.id === record.playerId);
    if (!player) continue;

    let stats = byPlayer.get(record.playerId);
    if (!stats) {
      stats = {
        playerId: record.playerId,
        name: player.name,
        games: 0,
        totalPitches: 0,
        totalInnings: 0,
        avgPitches: 0,
        last7Pitches: 0,
        perGame: []
      };
      byPlayer.set(record.playerId, stats);
    }

    const inningsPitched = record.inningsPitched ?? Object.keys(record.innings || {}).length;
    stats.games++;
    stats.totalPitches += record.pitches || 0;
    stats.totalInnings += inningsPitched;
    stats.perGame.push({
      gameId: record.gameId,
      date: record.date,
      opponent: opponentByGame.get(record.gameId) || '',
      pitches: record.pitches || 0,
      inningsPitched
    });
  }

  // last-7-days window: [today - 6, today], compared as date strings
  const sevenDaysAgo = shiftISO(today, -6);

  for (const stats of byPlayer.values()) {
    stats.perGame.sort((a, b) => a.date.localeCompare(b.date));
    stats.avgPitches = stats.games > 0 ? Math.round(stats.totalPitches / stats.games) : 0;
    stats.last7Pitches = stats.perGame
      .filter(g => g.date >= sevenDaysAgo && g.date <= today)
      .reduce((sum, g) => sum + g.pitches, 0);
  }

  return [...byPlayer.values()].sort((a, b) => b.totalPitches - a.totalPitches);
}

/** Shift a YYYY-MM-DD string by whole days (local calendar). */
export function shiftISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}
