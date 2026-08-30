/* ============================================
   Diamond Lineup - Game operations

   Pure functions over the v2 game model. The rules that keep
   planned and actual data separate live here:

   - The lineup grid is a PLAN. Only `outs` (recorded defensive
     outs) become participation history, and only for games
     whose status is 'completed'.
   - Every transition returns a new game object; nothing mutates.
   ============================================ */

import type {
  Assignment,
  DefensiveOut,
  FielderCount,
  Game,
  LineupMap,
  PitchCountEntry,
  Player,
  Position
} from './types';
import { getFieldingPositions } from './constants';

export const OUTS_PER_INNING = 3;

/** "7 outs" -> "2⅓" for inning-equivalent display. */
export function formatOutsAsInnings(outs: number): string {
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  const frac = rem === 1 ? '⅓' : rem === 2 ? '⅔' : '';
  if (whole === 0) return frac || '0';
  return `${whole}${frac}`;
}

/** The planned formation for one inning: playerId -> assignment. */
export function planForInning(game: Game, inning: number): Record<string, Assignment> {
  const formation: Record<string, Assignment> = {};
  for (const id of game.battingOrder) {
    const exitedAt = game.exitedPlayers?.[id];
    if (exitedAt && inning >= exitedAt) continue;
    const pos = game.lineup?.[`${id}-${inning}`];
    if (pos) formation[id] = pos;
  }
  return formation;
}

/** Players active (in the order, not exited) at a given inning. */
export function activePlayerIdsAt(game: Game, inning: number): string[] {
  return (game.battingOrder || []).filter(id => {
    const exitedAt = game.exitedPlayers?.[id];
    return !exitedAt || inning < exitedAt;
  });
}

export interface FormationIssue {
  type: 'duplicate' | 'vacant' | 'unassigned';
  message: string;
}

/** Validate a live formation before snapshotting it as an out. */
export function validateFormation(
  assignments: Record<string, Assignment>,
  activeIds: string[],
  fielderCount: FielderCount
): FormationIssue[] {
  const issues: FormationIssue[] = [];
  const positions = getFieldingPositions(fielderCount);
  const holders = new Map<Position, string[]>();
  for (const [pid, pos] of Object.entries(assignments)) {
    if (pos === 'SIT') continue;
    holders.set(pos, [...(holders.get(pos) || []), pid]);
  }
  for (const [pos, pids] of holders) {
    if (pids.length > 1) {
      issues.push({ type: 'duplicate', message: `${pids.length} players at ${pos}` });
    }
  }
  const vacant = positions.filter(pos => !holders.has(pos));
  if (vacant.length > 0) {
    issues.push({ type: 'vacant', message: `No one at ${vacant.join(', ')}` });
  }
  const unassigned = activeIds.filter(id => !assignments[id]);
  if (unassigned.length > 0) {
    issues.push({ type: 'unassigned', message: `${unassigned.length} active player(s) with no assignment (position or SIT)` });
  }
  return issues;
}

/** Start live out tracking. The inning-1 plan seeds the first formation. */
export function startLiveGame(game: Game): Game {
  if (game.status !== 'draft') return game;
  return {
    ...game,
    status: 'live',
    live: {
      inning: 1,
      outsRecorded: 0,
      assignments: planForInning(game, 1)
    }
  };
}

/**
 * Record one defensive out: snapshot the current formation, advance the
 * out/inning counters, and roll into the next inning's planned formation
 * after the third out.
 */
export function recordOut(game: Game): Game {
  if (game.status !== 'live' || !game.live) return game;
  const { inning, outsRecorded, assignments } = game.live;

  const out: DefensiveOut = {
    seq: game.outs.length + 1,
    inning,
    outInInning: (outsRecorded + 1) as 1 | 2 | 3,
    assignments: { ...assignments }
  };

  const outs = [...game.outs, out];
  let live = { ...game.live, outsRecorded: outsRecorded + 1 };
  if (live.outsRecorded >= OUTS_PER_INNING) {
    const nextInning = inning + 1;
    live = {
      inning: nextInning,
      outsRecorded: 0,
      // Next inning starts from its plan; players with no plan entry keep
      // their current spot so an unplanned extra inning still has a defense.
      assignments: nextFormation(game, nextInning, assignments)
    };
  }
  return { ...game, outs, live };
}

function nextFormation(
  game: Game,
  inning: number,
  current: Record<string, Assignment>
): Record<string, Assignment> {
  const planned = planForInning(game, inning);
  if (Object.keys(planned).length > 0) return planned;
  // No plan for this inning (e.g. extra innings): carry the formation over,
  // dropping players who have exited.
  const carried: Record<string, Assignment> = {};
  for (const id of activePlayerIdsAt(game, inning)) {
    if (current[id]) carried[id] = current[id];
  }
  return carried;
}

/** Record every remaining out of the current inning with the same defense. */
export function endInningOuts(game: Game): Game {
  if (game.status !== 'live' || !game.live) return game;
  let next = game;
  const remaining = OUTS_PER_INNING - game.live.outsRecorded;
  for (let i = 0; i < remaining; i++) next = recordOut(next);
  return next;
}

/** Undo the most recently recorded out, restoring its formation as current. */
export function undoOut(game: Game): Game {
  if (game.status !== 'live' || !game.live || game.outs.length === 0) return game;
  const outs = game.outs.slice(0, -1);
  const undone = game.outs[game.outs.length - 1];
  return {
    ...game,
    outs,
    live: {
      inning: undone.inning,
      outsRecorded: undone.outInInning - 1,
      assignments: { ...undone.assignments }
    }
  };
}

/** Change one player's spot in the live formation (mid-inning change). */
export function setLiveAssignment(game: Game, playerId: string, position: Assignment | null): Game {
  if (!game.live) return game;
  const assignments = { ...game.live.assignments };
  if (position === null) delete assignments[playerId];
  else assignments[playerId] = position;
  return { ...game, live: { ...game.live, assignments } };
}

/**
 * Swap a player into a position in the live formation. If the position is
 * held by someone else, the two players exchange spots (the displaced player
 * takes the mover's old spot, or SIT if they had none).
 */
export function applyLiveSwap(game: Game, playerId: string, position: Assignment): Game {
  if (!game.live) return game;
  const assignments = { ...game.live.assignments };
  const oldPos = assignments[playerId] ?? 'SIT';
  if (position !== 'SIT') {
    const holder = Object.keys(assignments).find(
      id => id !== playerId && assignments[id] === position
    );
    if (holder) assignments[holder] = oldPos;
  }
  assignments[playerId] = position;
  return { ...game, live: { ...game.live, assignments } };
}

/** Total pitch count entry for a player, creating a blank one if missing. */
export function getPitchCountEntry(game: Game, playerId: string): PitchCountEntry {
  return (
    game.pitchCounts?.[playerId] || { live: 0, byInning: {}, confirmed: null, status: 'live' }
  );
}

/** Set the working per-inning count from the live counter. */
export function setInningPitches(game: Game, playerId: string, inning: number, count: number): Game {
  const entry = getPitchCountEntry(game, playerId);
  const byInning = { ...entry.byInning, [inning]: count };
  const live = Object.values(byInning).reduce((a, b) => a + b, 0);
  return {
    ...game,
    pitchCounts: {
      ...game.pitchCounts,
      [playerId]: { ...entry, byInning, live }
    }
  };
}

/** Directly correct the working total (coach reconciles mid-game). */
export function setLivePitchTotal(game: Game, playerId: string, total: number): Game {
  const entry = getPitchCountEntry(game, playerId);
  return {
    ...game,
    pitchCounts: {
      ...game.pitchCounts,
      // Direct correction supersedes the per-inning tallies.
      [playerId]: { ...entry, live: total, byInning: {} }
    }
  };
}

/** Players credited with at least one pitching out in the ledger. */
export function pitchingOutsByPlayer(game: Game): Record<string, number> {
  const byPlayer: Record<string, number> = {};
  for (const out of game.outs || []) {
    for (const [pid, pos] of Object.entries(out.assignments)) {
      if (pos === 'P') byPlayer[pid] = (byPlayer[pid] || 0) + 1;
    }
  }
  return byPlayer;
}

/** Outs by player and assignment (position participation from the ledger). */
export function participationByPlayer(game: Game): Record<string, Partial<Record<Assignment, number>>> {
  const byPlayer: Record<string, Partial<Record<Assignment, number>>> = {};
  for (const out of game.outs || []) {
    for (const [pid, pos] of Object.entries(out.assignments)) {
      const p = (byPlayer[pid] ||= {});
      p[pos] = (p[pos] || 0) + 1;
    }
  }
  return byPlayer;
}

export interface PitchConfirmation {
  playerId: string;
  /** Confirmed total, or null to mark the count unknown. */
  pitches: number | null;
}

/**
 * Everyone who needs a confirmed pitch count before the game can complete:
 * players with pitching outs, plus anyone with live counter activity (the
 * counter says they pitched even if no P out was recorded).
 */
export function playersNeedingPitchConfirmation(game: Game): string[] {
  const ids = new Set<string>(Object.keys(pitchingOutsByPlayer(game)));
  for (const [pid, entry] of Object.entries(game.pitchCounts || {})) {
    if (entry.live > 0 || entry.confirmed != null) ids.add(pid);
  }
  return [...ids];
}

/**
 * Finalize a game. Only recorded outs and the supplied confirmations become
 * history; unplayed plan innings vanish. Name snapshots are taken so history
 * survives roster edits.
 */
export function completeGame(
  game: Game,
  confirmations: PitchConfirmation[],
  roster: Player[],
  now: Date = new Date()
): Game {
  const pitchCounts = { ...game.pitchCounts };
  for (const c of confirmations) {
    const entry = getPitchCountEntry(game, c.playerId);
    pitchCounts[c.playerId] =
      c.pitches === null
        ? { ...entry, confirmed: null, status: 'unknown' }
        : { ...entry, confirmed: c.pitches, status: 'confirmed' };
  }

  const playerNames = { ...game.playerNames };
  const idsToName = new Set<string>([
    ...game.battingOrder,
    ...Object.keys(pitchCounts),
    ...game.outs.flatMap(o => Object.keys(o.assignments))
  ]);
  for (const id of idsToName) {
    const p = roster.find(r => r.id === id);
    if (p) playerNames[id] = p.name;
  }

  return {
    ...game,
    status: 'completed',
    live: null,
    pitchCounts,
    playerNames,
    completedAt: now.toISOString(),
    participationQuality: game.participationQuality || 'exact'
  };
}

/** Correct a completed game's confirmed pitch count (from history). */
export function correctConfirmedPitches(game: Game, playerId: string, pitches: number | null): Game {
  const entry = getPitchCountEntry(game, playerId);
  return {
    ...game,
    pitchCounts: {
      ...game.pitchCounts,
      [playerId]:
        pitches === null
          ? { ...entry, confirmed: null, status: 'unknown' }
          : { ...entry, confirmed: pitches, status: 'confirmed' }
    }
  };
}

/* ============================================
   Plan integrity (H9, H10)
   ============================================ */

/**
 * Prune plan data that no longer applies: assignments/locks/pitchers for
 * players not in the batting order, and everything beyond the inning count.
 * Score and pitch data for out-of-range innings are trimmed too.
 */
export function normalizeGamePlan(game: Game): Game {
  const validIds = new Set(game.battingOrder);
  const maxInning = game.innings;

  const keep = (map: LineupMap): LineupMap => {
    const next: LineupMap = {};
    for (const [key, pos] of Object.entries(map || {})) {
      const sep = key.lastIndexOf('-');
      const pid = key.slice(0, sep);
      const inn = parseInt(key.slice(sep + 1), 10);
      if (validIds.has(pid) && inn >= 1 && inn <= maxInning) next[key] = pos;
    }
    return next;
  };

  const pitcherAssignments: Record<number, string> = {};
  for (const [innStr, pid] of Object.entries(game.pitcherAssignments || {})) {
    const inn = parseInt(innStr, 10);
    if (validIds.has(pid) && inn >= 1 && inn <= maxInning) pitcherAssignments[inn] = pid;
  }

  const trimScore = (side: Record<number, number>): Record<number, number> => {
    const next: Record<number, number> = {};
    for (const [innStr, runs] of Object.entries(side || {})) {
      const inn = parseInt(innStr, 10);
      if (inn >= 1 && inn <= maxInning) next[inn] = runs;
    }
    return next;
  };

  // A live formation follows the roster edit too: removed players are
  // absent (not sitting), and recorded outs stay exactly as recorded.
  let live = game.live;
  if (live) {
    const assignments: Record<string, Assignment> = {};
    for (const [pid, pos] of Object.entries(live.assignments)) {
      if (validIds.has(pid)) assignments[pid] = pos;
    }
    live = { ...live, assignments };
  }

  return {
    ...game,
    lineup: keep(game.lineup),
    lockedCells: keep(game.lockedCells),
    pitcherAssignments,
    live,
    score: { us: trimScore(game.score?.us), them: trimScore(game.score?.them) }
  };
}

export interface SwapResult {
  game: Game;
  changes: { playerId: string; playerName: string; from: Assignment | null; to: Assignment | null; type: 'manual' | 'displaced' }[];
}

/**
 * Apply a manual plan swap as one transaction: lineup, locks, and pitcher
 * assignments stay consistent (H10). If the target position is occupied, the
 * displaced player takes the mover's old spot; their stale lock is replaced,
 * and pitcher assignments follow whoever holds P afterwards.
 */
export function applyPlanSwap(
  game: Game,
  player: Player,
  inning: number,
  newPosition: Assignment,
  players: Player[]
): SwapResult {
  const key = `${player.id}-${inning}`;
  const oldPosition = game.lineup?.[key] || null;
  const lineup = { ...game.lineup };
  const locks = { ...game.lockedCells };
  const pitchers = { ...game.pitcherAssignments };
  const changes: SwapResult['changes'] = [
    { playerId: player.id, playerName: player.name, from: oldPosition, to: newPosition, type: 'manual' }
  ];

  // Displace whoever currently holds the target position
  if (newPosition !== 'SIT') {
    const holder = players.find(
      p => p.id !== player.id && lineup[`${p.id}-${inning}`] === newPosition
    );
    if (holder) {
      const hKey = `${holder.id}-${inning}`;
      if (oldPosition === null) {
        delete lineup[hKey];
        delete locks[hKey];
      } else {
        lineup[hKey] = oldPosition;
        // A displaced player's lock (if any) follows them; a lock naming a
        // position they no longer hold is the H10 corruption case.
        if (locks[hKey]) locks[hKey] = oldPosition;
      }
      changes.push({ playerId: holder.id, playerName: holder.name, from: newPosition, to: oldPosition, type: 'displaced' });
    }
  }

  lineup[key] = newPosition;
  locks[key] = newPosition; // manual choices are locked

  // Pitcher assignment follows whoever actually holds P now
  const pitcherNow = players.find(p => lineup[`${p.id}-${inning}`] === 'P');
  if (pitcherNow) pitchers[inning] = pitcherNow.id;
  else delete pitchers[inning];

  return {
    game: { ...game, lineup, lockedCells: locks, pitcherAssignments: pitchers },
    changes
  };
}

/**
 * Plan invariant check: no duplicate fielding positions in an inning, locks
 * agree with the lineup, pitcher assignments agree with the lineup.
 */
export function validateGamePlan(game: Game): string[] {
  const issues: string[] = [];
  for (let inning = 1; inning <= game.innings; inning++) {
    const seen = new Map<Assignment, string[]>();
    for (const id of activePlayerIdsAt(game, inning)) {
      const pos = game.lineup?.[`${id}-${inning}`];
      if (!pos || pos === 'SIT') continue;
      seen.set(pos, [...(seen.get(pos) || []), id]);
    }
    for (const [pos, ids] of seen) {
      if (ids.length > 1) issues.push(`Inning ${inning}: ${ids.length} players at ${pos}`);
    }
    const pid = game.pitcherAssignments?.[inning];
    if (pid && game.lineup?.[`${pid}-${inning}`] !== 'P' && seen.has('P')) {
      issues.push(`Inning ${inning}: assigned pitcher is not at P in the lineup`);
    }
  }
  for (const [key, pos] of Object.entries(game.lockedCells || {})) {
    if (game.lineup?.[key] !== undefined && game.lineup[key] !== pos) {
      issues.push(`Lock at ${key} says ${pos} but lineup says ${game.lineup[key]}`);
    }
  }
  return issues;
}
