/* ============================================
   Diamond Lineup - Storage Service

   Abstraction layer for data persistence.
   Currently uses localStorage, but designed to be
   swapped for an API/sync backend (Phase 2).

   All storage operations go through this service.
   ============================================ */

import { DEFAULT_SETTINGS } from '../domain/constants';
import { compareDatesDesc, daysBetween } from '../domain/dates';
import { newId } from '../domain/ids';
import type { Game, PitchRecord, PitcherEligibility, Player, Settings } from '../domain/types';

const STORAGE_PREFIX = 'ybl_';

export interface ExportedData {
  roster: Player[];
  settings: Settings;
  currentGame: Game | null;
  games: Game[];
  pitchHistory: PitchRecord[];
  defaultBattingOrder: string[] | null;
  exportDate: string;
}

export const StorageKeys = {
  ROSTER: 'roster',
  SETTINGS: 'settings',
  CURRENT_GAME: 'currentGame',
  GAMES: 'games',
  PITCH_HISTORY: 'pitchHistory',
  DEFAULT_BATTING_ORDER: 'defaultBattingOrder'
} as const;

export const Storage = {
  // ----------------------------------------
  // Core storage operations
  // ----------------------------------------

  _get<T>(key: string, defaultValue: T): T {
    try {
      const data = localStorage.getItem(STORAGE_PREFIX + key);
      if (data === null) return defaultValue;
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`Storage read error for ${key}:`, e);
      return defaultValue;
    }
  },

  _set(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`Storage write error for ${key}:`, e);
      return false;
    }
  },

  _remove(key: string): boolean {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
      return true;
    } catch (e) {
      console.error(`Storage remove error for ${key}:`, e);
      return false;
    }
  },

  // ----------------------------------------
  // Roster operations
  // ----------------------------------------

  getRoster(): Player[] {
    return this._get<Player[]>(StorageKeys.ROSTER, []);
  },

  saveRoster(roster: Player[]): boolean {
    return this._set(StorageKeys.ROSTER, roster);
  },

  // ----------------------------------------
  // Settings operations
  // ----------------------------------------

  getSettings(): Settings {
    const saved = this._get<Partial<Settings>>(StorageKeys.SETTINGS, {});
    // Merge with defaults so fields added in later versions exist
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      fairness: {
        ...DEFAULT_SETTINGS.fairness,
        ...(saved.fairness || {})
      },
      pitchRules: {
        ...DEFAULT_SETTINGS.pitchRules,
        ...(saved.pitchRules || {})
      }
    };
  },

  saveSettings(settings: Settings): boolean {
    return this._set(StorageKeys.SETTINGS, settings);
  },

  // ----------------------------------------
  // Default batting order
  // ----------------------------------------

  getDefaultBattingOrder(): string[] | null {
    return this._get<string[] | null>(StorageKeys.DEFAULT_BATTING_ORDER, null);
  },

  saveDefaultBattingOrder(order: string[]): boolean {
    return this._set(StorageKeys.DEFAULT_BATTING_ORDER, order);
  },

  clearDefaultBattingOrder(): boolean {
    return this._remove(StorageKeys.DEFAULT_BATTING_ORDER);
  },

  // ----------------------------------------
  // Current game operations
  // ----------------------------------------

  getCurrentGame(): Game | null {
    return this._get<Game | null>(StorageKeys.CURRENT_GAME, null);
  },

  saveCurrentGame(game: Game | null): boolean {
    return this._set(StorageKeys.CURRENT_GAME, game);
  },

  clearCurrentGame(): boolean {
    return this._remove(StorageKeys.CURRENT_GAME);
  },

  // ----------------------------------------
  // Game history operations
  // ----------------------------------------

  getGames(): Game[] {
    return this._get<Game[]>(StorageKeys.GAMES, []);
  },

  saveGames(games: Game[]): boolean {
    return this._set(StorageKeys.GAMES, games);
  },

  addGame(game: Game): boolean {
    const games = this.getGames();
    const existingIndex = games.findIndex(g => g.id === game.id);
    if (existingIndex >= 0) {
      games[existingIndex] = game;
    } else {
      games.push(game);
    }
    return this.saveGames(games);
  },

  getGameById(gameId: string): Game | null {
    return this.getGames().find(g => g.id === gameId) || null;
  },

  deleteGame(gameId: string): boolean {
    // Purge the game's pitch records too - otherwise the deleted game's
    // workload would still drive rest eligibility and season stats
    this.savePitchHistory(this.getPitchHistory().filter(r => r.gameId !== gameId));
    return this.saveGames(this.getGames().filter(g => g.id !== gameId));
  },

  /** Most recent game (for "use last game's lineup"). */
  getLastGame(): Game | null {
    const games = this.getGames();
    if (games.length === 0) return null;
    const sorted = [...games].sort((a, b) => compareDatesDesc(a.date, b.date));
    return sorted[0];
  },

  // ----------------------------------------
  // Pitch history operations
  // ----------------------------------------

  getPitchHistory(): PitchRecord[] {
    return this._get<PitchRecord[]>(StorageKeys.PITCH_HISTORY, []);
  },

  savePitchHistory(history: PitchRecord[]): boolean {
    return this._set(StorageKeys.PITCH_HISTORY, history);
  },

  addPitchRecord(record: Omit<PitchRecord, 'id'> & { id?: string }): boolean {
    const history = this.getPitchHistory();
    const existingIndex = history.findIndex(
      r => r.playerId === record.playerId && r.gameId === record.gameId
    );
    if (existingIndex >= 0) {
      // Keep the existing id - `record.id` may be absent
      history[existingIndex] = { ...history[existingIndex], ...record, id: history[existingIndex].id };
    } else {
      history.push({
        ...record,
        id: record.id ?? newId()
      });
    }
    return this.savePitchHistory(history);
  },

  getPitchHistoryForPlayer(playerId: string): PitchRecord[] {
    return this.getPitchHistory().filter(r => r.playerId === playerId);
  },

  /**
   * Record pitching workload from a game's lineup. Called on game save so
   * innings-pitched is tracked even when the pitch counter was never opened
   * (softball leagues usually track innings, not pitches).
   */
  recordGamePitching(game: Game): boolean {
    const inningsByPlayer: Record<string, number> = {};
    for (const [key, pos] of Object.entries(game.lineup || {})) {
      if (pos !== 'P') continue;
      const playerId = key.slice(0, key.lastIndexOf('-'));
      inningsByPlayer[playerId] = (inningsByPlayer[playerId] || 0) + 1;
    }

    let ok = true;
    for (const [playerId, inningsPitched] of Object.entries(inningsByPlayer)) {
      const pitchLog = game.pitchLog?.[playerId] || {};
      const pitches = Object.values(pitchLog).reduce((a, b) => a + b, 0);
      ok = this.addPitchRecord({
        playerId,
        gameId: game.id,
        date: game.date,
        pitches,
        innings: pitchLog,
        inningsPitched
      }) && ok;
    }
    return ok;
  },

  /** Pitcher eligibility for a game date based on rest rules. */
  getPitcherEligibility(playerId: string, gameDate: string): PitcherEligibility {
    const history = this.getPitchHistoryForPlayer(playerId);
    const settings = this.getSettings();
    return computePitcherEligibility(history, settings.pitchRules, gameDate);
  },

  // ----------------------------------------
  // Bulk operations
  // ----------------------------------------

  clearAllData(): boolean {
    Object.values(StorageKeys).forEach(key => {
      this._remove(key);
    });
    return true;
  },

  /** Export all data (for backup or migration). */
  exportAllData(): ExportedData {
    return {
      roster: this.getRoster(),
      settings: this.getSettings(),
      currentGame: this.getCurrentGame(),
      games: this.getGames(),
      pitchHistory: this.getPitchHistory(),
      defaultBattingOrder: this.getDefaultBattingOrder(),
      exportDate: new Date().toISOString()
    };
  },

  /** Import data (for restore or migration). */
  importAllData(data: Partial<ExportedData>): boolean {
    try {
      if (data.roster) this.saveRoster(data.roster);
      if (data.settings) this.saveSettings(data.settings);
      if (data.currentGame) this.saveCurrentGame(data.currentGame);
      if (data.games) this.saveGames(data.games);
      if (data.pitchHistory) this.savePitchHistory(data.pitchHistory);
      if (data.defaultBattingOrder) this.saveDefaultBattingOrder(data.defaultBattingOrder);
      return true;
    } catch (e) {
      console.error('Import error:', e);
      return false;
    }
  }
};

/**
 * Pure eligibility calculation, separated from storage so it can be
 * unit-tested and later reused server-side.
 */
export function computePitcherEligibility(
  history: PitchRecord[],
  rules: Settings['pitchRules'],
  gameDate: string
): PitcherEligibility {
  if (rules.limitType === 'none' || history.length === 0) {
    return { eligible: true, reason: 'Eligible', daysRest: null };
  }

  const sorted = [...history].sort((a, b) => compareDatesDesc(a.date, b.date));
  const lastOuting = sorted[0];
  const lastInningsPitched = lastOuting.inningsPitched
    ?? Object.keys(lastOuting.innings || {}).length;

  const daysSince = daysBetween(lastOuting.date, gameDate);

  // Find required rest days from the breakpoint table for the active scheme
  let requiredRest = 0;
  if (rules.limitType === 'innings') {
    let matched = false;
    for (const bp of rules.inningsBreakpoints) {
      if (lastInningsPitched <= bp.maxInnings) {
        requiredRest = bp.restDays;
        matched = true;
        break;
      }
    }
    // Beyond the highest breakpoint: use the last breakpoint's rest
    if (!matched && rules.inningsBreakpoints.length > 0) {
      requiredRest = rules.inningsBreakpoints[rules.inningsBreakpoints.length - 1].restDays;
    }
  } else {
    for (const bp of rules.breakpoints) {
      if (lastOuting.pitches <= bp.maxPitches) {
        requiredRest = bp.restDays;
        break;
      }
    }
    // Check if exceeded all breakpoints
    const lastBreakpoint = rules.breakpoints[rules.breakpoints.length - 1];
    if (lastBreakpoint && lastOuting.pitches > lastBreakpoint.maxPitches) {
      requiredRest = rules.absoluteMaxRest;
    }
  }

  if (daysSince >= requiredRest) {
    return {
      eligible: true,
      reason: 'Eligible',
      daysRest: daysSince,
      lastPitched: lastOuting.pitches,
      lastInningsPitched
    };
  }

  const daysNeeded = requiredRest - daysSince;
  return {
    eligible: false,
    reason: `${daysNeeded}d rest`,
    daysRest: daysSince,
    daysNeeded,
    lastPitched: lastOuting.pitches,
    lastInningsPitched
  };
}
