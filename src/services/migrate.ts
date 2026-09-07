/* ============================================
   Diamond Lineup - v1 -> v2 data migration

   v1 stored inning-level lineups and treated planned innings as
   actual participation, with a separate pitchHistory collection.
   v2 records actual participation as defensive-out snapshots and
   derives all pitching workload from completed games.

   Migration rules (honest about what the old data can support):
   - Saved v1 games become completed v2 games. Each planned inning
     assignment expands into three ESTIMATED out snapshots, which
     preserves existing season totals without claiming out-level
     accuracy the old model never captured. They are labeled
     estimated in history and stay correctable.
   - v1 pitch totals were entered/kept by the coach and were the
     operative values all season, so they migrate as CONFIRMED
     counts. (Flagging months-old outings as "count needed" would
     block nothing and annoy everyone; any rest windows from last
     season expired long ago.)
   - The active v1 game becomes a v2 DRAFT: its lineup is a plan,
     no outs are inferred from `currentInning` (it is manually
     movable and not a completion marker). The coach starts out
     tracking when the next real game starts.
   - Orphan pitch records are retained separately by the storage/backup
     boundary for coach review. No actual participation is inferred.
   ============================================ */

import type { Assignment, DefensiveOut, Game, PitchCountEntry, PitchRecord, Player } from '../domain/types';

interface GameV1 {
  id: string;
  date: string;
  opponent: string;
  innings: number;
  fielderCount: 9 | 10;
  battingOrder: string[];
  availability: Record<string, boolean>;
  pitcherAssignments: Record<number, string>;
  lockedCells: Record<string, Assignment>;
  lineup: Record<string, Assignment>;
  score: { us: Record<number, number>; them: Record<number, number> };
  pitchLog: Record<string, Record<number, number>>;
  currentInning: number;
  exitedPlayers: Record<string, number>;
}

export function isV2Game(game: unknown): game is Game {
  return !!game && typeof game === 'object' && (game as Game).schemaVersion === 2;
}

function baseV2(v1: GameV1, roster: Player[]): Game {
  const playerNames: Record<string, string> = {};
  for (const id of v1.battingOrder || []) {
    const p = roster.find(r => r.id === id);
    if (p) playerNames[id] = p.name;
  }
  return {
    schemaVersion: 2,
    id: v1.id,
    date: v1.date,
    opponent: v1.opponent || '',
    innings: v1.innings || 6,
    fielderCount: v1.fielderCount || 9,
    battingOrder: v1.battingOrder || [],
    availability: v1.availability || {},
    pitcherAssignments: v1.pitcherAssignments || {},
    lockedCells: v1.lockedCells || {},
    lineup: v1.lineup || {},
    score: v1.score || { us: {}, them: {} },
    status: 'draft',
    live: null,
    outs: [],
    pitchCounts: {},
    playerNames,
    exitedPlayers: v1.exitedPlayers || {}
  };
}

function pitchCountsFromV1(
  v1: GameV1,
  records: PitchRecord[],
  asConfirmed: boolean
): Record<string, PitchCountEntry> {
  const counts: Record<string, PitchCountEntry> = {};
  const ids = new Set<string>([
    ...Object.keys(v1.pitchLog || {}),
    ...records.map(r => r.playerId)
  ]);
  for (const pid of ids) {
    const record = records.find(r => r.playerId === pid);
    const byInning = { ...(v1.pitchLog?.[pid] || record?.innings || {}) };
    const logTotal = Object.values(byInning).reduce((a, b) => a + b, 0);
    const total = record?.pitches ?? logTotal;
    counts[pid] = asConfirmed
      ? { live: total, byInning, confirmed: total, status: 'confirmed' }
      : { live: logTotal, byInning, confirmed: null, status: 'live' };
  }
  return counts;
}

/** Expand a v1 inning-level lineup into estimated out snapshots. */
function expandOuts(v1: GameV1): DefensiveOut[] {
  const outs: DefensiveOut[] = [];
  let seq = 1;
  for (let inning = 1; inning <= (v1.innings || 6); inning++) {
    const assignments: Record<string, Assignment> = {};
    for (const id of v1.battingOrder || []) {
      const exitedAt = v1.exitedPlayers?.[id];
      if (exitedAt && inning >= exitedAt) continue;
      const pos = v1.lineup?.[`${id}-${inning}`];
      if (pos) assignments[id] = pos;
    }
    if (Object.keys(assignments).length === 0) continue; // never-played inning
    for (let o = 1; o <= 3; o++) {
      outs.push({
        seq: seq++,
        inning,
        outInInning: o as 1 | 2 | 3,
        assignments: { ...assignments },
        estimated: true
      });
    }
  }
  return outs;
}

/** Migrate one SAVED v1 game to a completed v2 game with estimated outs. */
export function migrateSavedGameV1(raw: unknown, pitchHistory: PitchRecord[], roster: Player[]): Game {
  if (isV2Game(raw)) return raw;
  const v1 = raw as GameV1;
  const records = pitchHistory.filter(r => r.gameId === v1.id);
  return {
    ...baseV2(v1, roster),
    status: 'completed',
    outs: expandOuts(v1),
    pitchCounts: pitchCountsFromV1(v1, records, true),
    participationQuality: 'estimated',
    completedAt: undefined
  };
}

/** Migrate the ACTIVE v1 game to a v2 draft (plan only, zero outs). */
export function migrateCurrentGameV1(raw: unknown, roster: Player[]): Game {
  if (isV2Game(raw)) return raw;
  const v1 = raw as GameV1;
  return {
    ...baseV2(v1, roster),
    status: 'draft',
    pitchCounts: pitchCountsFromV1(v1, [], false)
  };
}
