/* ============================================
   Diamond Lineup - Solver

   Constraint-satisfaction solver for defensive lineups.

   Sit logic: maxSitsPerGame is the TOTAL sits allowed per player
   for the entire game. If everyone has hit the max, the caller is
   asked for an override to allow additional sits.

   Sport/rule configuration:
   - fieldingPositions: 9 or 10 positions (SC = 4th outfielder)
   - enforcePitcherCatcherRule / requireContiguousPitching:
     baseball safety rules, typically off for softball
   - maxPitcherInningsPerGame: per-game innings cap for pitchers
   - fairness: maxConsecutiveSits, everyoneInfield
   ============================================ */

import { POSITIONS, POSITION_GROUPS, POSITION_TIERS } from './constants';
import type { Assignment, LineupMap, Player, Position } from './types';

export interface AvoidOverride {
  playerId: string;
  position: Position;
}

export interface SolveParams {
  players: Player[];
  innings: number;
  startInning?: number;
  existingPlan?: LineupMap;
  lockedCells?: LineupMap;
  pitcherAssignments?: Record<number, string>;
  maxSitsPerGame?: number;
  sitOverrides?: string[];
  avoidOverrides?: AvoidOverride[];
  /** Positions to fill each inning (default: the 9 standard positions). */
  fieldingPositions?: Position[];
  /** No P<->C in consecutive innings (baseball safety rule). Default true. */
  enforcePitcherCatcherRule?: boolean;
  /** Pitching stints must be contiguous. Default true (off for softball). */
  requireContiguousPitching?: boolean;
  /** Cap on innings one player may pitch per game (null/undefined = no cap). */
  maxPitcherInningsPerGame?: number | null;
  /** Fairness: max innings a player may sit back-to-back (null = off). */
  maxConsecutiveSits?: number | null;
  /** Fairness: everyone plays a non-outfield position at least once. */
  everyoneInfield?: boolean;
}

export interface SolveResult {
  success: boolean;
  solution?: LineupMap;
  sitCounts?: Record<string, number>;
  warnings?: string[];
  error?: string;
  needsOverride?: boolean;
  avoidBlockers?: { position: Position; players: { id: string; name: string }[] }[];
  needsSitOverride?: boolean;
  sitOverrideNeeded?: { id: string; name: string; currentSits: number }[];
  partialSolution?: LineupMap;
  inning?: number;
  conflicts?: string[];
}

export interface SwapChange {
  player: string;
  playerId: string;
  from: Assignment | null;
  to: Assignment | null;
  type: 'manual' | 'displaced';
}

function isOutfield(pos: Assignment): boolean {
  return POSITION_GROUPS.OUTFIELD.includes(pos as Position);
}

export const Solver = {
  canPlayerPlayPosition(player: Player, position: Assignment): boolean {
    if (position === 'SIT') return true;
    if (position === 'P' && !player.canPitch) return false;
    if (position === 'C' && !player.canCatch) return false;
    const tier = player.positions?.[position];
    if (tier === POSITION_TIERS.AVOID) return false;
    return true;
  },

  checkPitcherCatcherRule(
    player: Player,
    position: Assignment,
    inning: number,
    solution: LineupMap,
    totalInnings: number
  ): boolean {
    if (position !== 'P' && position !== 'C') return true;
    if (inning > 1) {
      const prevPos = solution[`${player.id}-${inning - 1}`];
      if ((position === 'P' && prevPos === 'C') || (position === 'C' && prevPos === 'P')) {
        return false;
      }
    }
    if (inning < totalInnings) {
      const nextPos = solution[`${player.id}-${inning + 1}`];
      if (nextPos && ((position === 'P' && nextPos === 'C') || (position === 'C' && nextPos === 'P'))) {
        return false;
      }
    }
    return true;
  },

  checkPitchingContiguity(
    player: Player,
    inning: number,
    solution: LineupMap,
    totalInnings: number
  ): boolean {
    const pitchingInnings: number[] = [];
    for (let i = 1; i <= totalInnings; i++) {
      if (solution[`${player.id}-${i}`] === 'P') {
        pitchingInnings.push(i);
      }
    }
    if (pitchingInnings.length === 0) return true;
    const allInnings = [...pitchingInnings, inning].sort((a, b) => a - b);
    for (let i = 1; i < allInnings.length; i++) {
      if (allInnings[i] - allInnings[i - 1] !== 1) return false;
    }
    return true;
  },

  /** Innings this player is already pitching in the solution. */
  getPitchingInningCount(playerId: string, solution: LineupMap): number {
    let count = 0;
    for (const [key, pos] of Object.entries(solution)) {
      if (pos === 'P' && key.startsWith(`${playerId}-`)) count++;
    }
    return count;
  },

  canAssignPosition(
    player: Player,
    position: Assignment,
    inning: number,
    solution: LineupMap,
    totalInnings: number,
    avoidOverrides: Set<string> = new Set(),
    rules: {
      enforcePitcherCatcherRule?: boolean;
      requireContiguousPitching?: boolean;
      maxPitcherInningsPerGame?: number | null;
    } = {}
  ): boolean {
    if (position === 'SIT') return true;
    if (position === 'P' && !player.canPitch) return false;
    if (position === 'C' && !player.canCatch) return false;

    const tier = player.positions?.[position];
    if (tier === POSITION_TIERS.AVOID && !avoidOverrides.has(`${player.id}-${position}`)) {
      return false;
    }
    const enforcePC = rules.enforcePitcherCatcherRule !== false;
    if (enforcePC && !this.checkPitcherCatcherRule(player, position, inning, solution, totalInnings)) {
      return false;
    }
    if (position === 'P') {
      const requireContiguous = rules.requireContiguousPitching !== false;
      if (requireContiguous && !this.checkPitchingContiguity(player, inning, solution, totalInnings)) {
        return false;
      }
      const cap = rules.maxPitcherInningsPerGame;
      if (cap != null && this.getPitchingInningCount(player.id, solution) >= cap) {
        return false;
      }
    }
    return true;
  },

  getPreferenceScore(player: Player, position: Assignment): number {
    if (position === 'SIT') return 100;
    const tier = player.positions?.[position];
    const preferredOrder = player.preferredOrder || [];
    const prefIndex = preferredOrder.indexOf(position);
    if (tier === POSITION_TIERS.PREFERRED) {
      if (prefIndex === 0) return 0;
      if (prefIndex === 1) return 5;
      if (prefIndex === 2) return 10;
      return 15;
    }
    if (tier === POSITION_TIERS.AVOID) return 200;
    // canPlay, or unrated (e.g. SC for rosters created before 10-fielder support)
    return 50;
  },

  /** Count total sits for a player in the solution. */
  getTotalSits(playerId: string, solution: LineupMap): number {
    let count = 0;
    for (const [key, pos] of Object.entries(solution)) {
      if (key.startsWith(`${playerId}-`) && pos === 'SIT') {
        count++;
      }
    }
    return count;
  },

  /** Consecutive sits ending at (and including) the given inning. */
  getConsecutiveSitsEnding(playerId: string, inning: number, solution: LineupMap): number {
    let count = 0;
    for (let i = inning; i >= 1; i--) {
      if (solution[`${playerId}-${i}`] === 'SIT') count++;
      else break;
    }
    return count;
  },

  /** Has the player fielded a non-outfield position in the solution? */
  hasInfieldInning(playerId: string, solution: LineupMap): boolean {
    for (const [key, pos] of Object.entries(solution)) {
      if (key.startsWith(`${playerId}-`) && pos !== 'SIT' && !isOutfield(pos)) {
        return true;
      }
    }
    return false;
  },

  solve(params: SolveParams): SolveResult {
    const {
      players,
      innings,
      startInning = 1,
      existingPlan = {},
      lockedCells = {},
      pitcherAssignments = {},
      maxSitsPerGame = 2,
      sitOverrides = [],
      avoidOverrides = [],
      fieldingPositions = POSITIONS,
      enforcePitcherCatcherRule = true,
      requireContiguousPitching = true,
      maxPitcherInningsPerGame = null,
      maxConsecutiveSits = null,
      everyoneInfield = false
    } = params;

    const fielderCount = fieldingPositions.length;
    if (players.length < fielderCount) {
      return { success: false, error: `Need at least ${fielderCount} players` };
    }

    const solution: LineupMap = {};
    const warnings: string[] = [];
    const avoidOverrideSet = new Set(avoidOverrides.map(o => `${o.playerId}-${o.position}`));
    const sitOverrideSet = new Set(sitOverrides);
    const assignmentRules = { enforcePitcherCatcherRule, requireContiguousPitching, maxPitcherInningsPerGame };
    const infieldSlotsPerInning = fieldingPositions.filter(pos => !isOutfield(pos)).length;

    // Copy locked cells and existing assignments for innings before startInning
    for (const [key, pos] of Object.entries(lockedCells)) {
      solution[key] = pos;
    }
    for (const [key, pos] of Object.entries(existingPlan)) {
      const inn = parseInt(key.slice(key.lastIndexOf('-') + 1), 10);
      if (inn < startInning) {
        solution[key] = pos;
      }
    }

    // Apply pitcher assignments
    for (const [innStr, playerId] of Object.entries(pitcherAssignments)) {
      const inn = parseInt(innStr, 10);
      if (inn >= startInning && playerId) {
        solution[`${playerId}-${inn}`] = 'P';
      }
    }

    // Solve each inning
    for (let inning = startInning; inning <= innings; inning++) {
      const assigned = new Set<string>();
      const positionsFilled: Partial<Record<Assignment, string>> = {};

      // Check what's already assigned for this inning
      for (const player of players) {
        const key = `${player.id}-${inning}`;
        if (solution[key]) {
          assigned.add(player.id);
          positionsFilled[solution[key]] = player.id;
        }
      }

      const neededPositions = fieldingPositions.filter(pos => !positionsFilled[pos]);
      let availablePlayers = players.filter(p => !assigned.has(p.id));

      // Fairness bookkeeping for this inning
      const needsInfield = new Set<string>();
      let infieldUrgent = false;
      if (everyoneInfield) {
        players.forEach(p => {
          if (!this.hasInfieldInning(p.id, solution)) needsInfield.add(p.id);
        });
        const remainingInnings = innings - inning + 1;
        // If the remaining innings after this one can't cover everyone still
        // needing an infield turn, start placing them now.
        infieldUrgent = needsInfield.size > (remainingInnings - 1) * infieldSlotsPerInning;
      }
      const atConsecutiveLimit = (playerId: string) =>
        maxConsecutiveSits != null &&
        this.getConsecutiveSitsEnding(playerId, inning - 1, solution) >= maxConsecutiveSits;

      // Sort positions by difficulty (fewest eligible candidates first)
      neededPositions.sort((a, b) => {
        const aCandidates = availablePlayers.filter(p =>
          this.canAssignPosition(p, a, inning, solution, innings, avoidOverrideSet, assignmentRules)
        ).length;
        const bCandidates = availablePlayers.filter(p =>
          this.canAssignPosition(p, b, inning, solution, innings, avoidOverrideSet, assignmentRules)
        ).length;
        return aCandidates - bCandidates;
      });

      // Fill each position
      for (const position of neededPositions) {
        const candidates = availablePlayers.filter(p =>
          this.canAssignPosition(p, position, inning, solution, innings, avoidOverrideSet, assignmentRules)
        );

        if (candidates.length === 0) {
          const avoidBlockers = availablePlayers.filter(p => {
            const tier = p.positions?.[position];
            return tier === POSITION_TIERS.AVOID &&
                   (position !== 'P' || p.canPitch) &&
                   (position !== 'C' || p.canCatch);
          });

          if (avoidBlockers.length > 0) {
            return {
              success: false,
              error: 'Cannot create lineup without using avoided positions',
              needsOverride: true,
              avoidBlockers: [{ position, players: avoidBlockers.map(p => ({ id: p.id, name: p.name })) }],
              partialSolution: solution
            };
          }
          return { success: false, error: `Cannot fill ${position} for inning ${inning}`, partialSolution: solution };
        }

        // Sort candidates, highest priority to play first:
        // 1. at the consecutive-sit limit (must not sit again)
        // 2. urgently needs an infield turn (everyoneInfield rule)
        // 3. more total sits (sit balance)
        // 4. still needs an infield turn (mild tiebreak on infield slots)
        // 5. position preference
        const infieldPosition = !isOutfield(position);
        candidates.sort((a, b) => {
          const aMustPlay = atConsecutiveLimit(a.id) ? 1 : 0;
          const bMustPlay = atConsecutiveLimit(b.id) ? 1 : 0;
          if (aMustPlay !== bMustPlay) return bMustPlay - aMustPlay;

          if (infieldPosition && infieldUrgent) {
            const aUrgent = needsInfield.has(a.id) ? 1 : 0;
            const bUrgent = needsInfield.has(b.id) ? 1 : 0;
            if (aUrgent !== bUrgent) return bUrgent - aUrgent;
          }

          const aSits = this.getTotalSits(a.id, solution);
          const bSits = this.getTotalSits(b.id, solution);
          if (aSits !== bSits) return bSits - aSits;

          if (infieldPosition && everyoneInfield) {
            const aNeeds = needsInfield.has(a.id) ? 1 : 0;
            const bNeeds = needsInfield.has(b.id) ? 1 : 0;
            if (aNeeds !== bNeeds) return bNeeds - aNeeds;
          }

          return this.getPreferenceScore(a, position) - this.getPreferenceScore(b, position);
        });

        const chosen = candidates[0];
        solution[`${chosen.id}-${inning}`] = position;
        if (!isOutfield(position)) needsInfield.delete(chosen.id);
        availablePlayers = availablePlayers.filter(p => p.id !== chosen.id);
      }

      // Remaining players need to sit - but check max sits.
      // Sort by fewest sits first (they should sit before those at/near max);
      // players at the consecutive-sit limit sort last.
      availablePlayers.sort((a, b) => {
        const aLimit = atConsecutiveLimit(a.id) ? 1 : 0;
        const bLimit = atConsecutiveLimit(b.id) ? 1 : 0;
        if (aLimit !== bLimit) return aLimit - bLimit;
        const aSits = this.getTotalSits(a.id, solution);
        const bSits = this.getTotalSits(b.id, solution);
        return aSits - bSits;
      });

      for (const player of availablePlayers) {
        const currentSits = this.getTotalSits(player.id, solution);

        if (currentSits >= maxSitsPerGame && !sitOverrideSet.has(player.id)) {
          // This player has maxed out sits and no override.
          // Check if everyone else available to sit has also maxed out.
          const othersCanSit = availablePlayers.filter(p =>
            p.id !== player.id &&
            (this.getTotalSits(p.id, solution) < maxSitsPerGame || sitOverrideSet.has(p.id))
          );

          if (othersCanSit.length === 0) {
            const needOverride = availablePlayers.filter(p =>
              this.getTotalSits(p.id, solution) >= maxSitsPerGame && !sitOverrideSet.has(p.id)
            );

            return {
              success: false,
              error: `Cannot balance sits within ${maxSitsPerGame} max sits per player`,
              needsSitOverride: true,
              sitOverrideNeeded: needOverride.map(p => ({
                id: p.id,
                name: p.name,
                currentSits: this.getTotalSits(p.id, solution)
              })),
              partialSolution: solution,
              inning
            };
          }
        }

        solution[`${player.id}-${inning}`] = 'SIT';

        const newSitCount = this.getTotalSits(player.id, solution);
        if (newSitCount > maxSitsPerGame) {
          warnings.push(`${player.name} sits ${newSitCount} innings (target max: ${maxSitsPerGame})`);
        }
      }
    }

    // Fairness warnings over the finished solution
    if (maxConsecutiveSits != null) {
      for (const p of players) {
        let run = 0;
        let worst = 0;
        for (let i = 1; i <= innings; i++) {
          run = solution[`${p.id}-${i}`] === 'SIT' ? run + 1 : 0;
          worst = Math.max(worst, run);
        }
        if (worst > maxConsecutiveSits) {
          warnings.push(`${p.name} sits ${worst} innings in a row (target max: ${maxConsecutiveSits})`);
        }
      }
    }
    if (everyoneInfield) {
      for (const p of players) {
        if (!this.hasInfieldInning(p.id, solution)) {
          warnings.push(`${p.name} never plays the infield`);
        }
      }
    }

    // Calculate final sit counts
    const sitCounts: Record<string, number> = {};
    players.forEach(p => {
      sitCounts[p.id] = this.getTotalSits(p.id, solution);
    });

    return {
      success: true,
      solution,
      sitCounts,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  },

  calculateSwapChanges(
    currentSolution: LineupMap,
    player: Player,
    inning: number,
    newPosition: Assignment,
    players: Player[]
  ): SwapChange[] {
    const changes: SwapChange[] = [];
    const key = `${player.id}-${inning}`;
    const oldPosition = currentSolution[key] || null;

    changes.push({ player: player.name, playerId: player.id, from: oldPosition, to: newPosition, type: 'manual' });

    // If taking a position (not SIT), check if someone else has it
    if (newPosition !== 'SIT' && newPosition !== null) {
      for (const p of players) {
        if (p.id !== player.id && currentSolution[`${p.id}-${inning}`] === newPosition) {
          // Displaced player gets our old position (or null if we had none)
          changes.push({ player: p.name, playerId: p.id, from: newPosition, to: oldPosition, type: 'displaced' });
          break;
        }
      }
    }
    return changes;
  }
};
