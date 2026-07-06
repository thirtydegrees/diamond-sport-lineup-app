/* ============================================
   Diamond Lineup - Storage Service

   Abstraction layer for data persistence.
   Currently uses localStorage, but designed to be
   swapped for an API/sync backend (Phase 2).

   All storage operations go through this service.
   ============================================ */

import { DEFAULT_SETTINGS } from '../domain/constants';
import { compareDatesDesc, daysBetween } from '../domain/dates';
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
    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
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
      history[existingIndex] = { ...history[existingIndex], ...record };
    } else {
      history.push({
        id: Date.now().toString(),
        ...record
      });
    }
    return this.savePitchHistory(history);
  },

  getPitchHistoryForPlayer(playerId: string): PitchRecord[] {
    return this.getPitchHistory().filter(r => r.playerId === playerId);
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
  if (history.length === 0) {
    return { eligible: true, reason: 'Eligible', daysRest: null };
  }

  const sorted = [...history].sort((a, b) => compareDatesDesc(a.date, b.date));
  const lastPitched = sorted[0];

  const daysSince = daysBetween(lastPitched.date, gameDate);

  // Find required rest days based on pitches thrown
  let requiredRest = 0;
  for (const bp of rules.breakpoints) {
    if (lastPitched.pitches <= bp.maxPitches) {
      requiredRest = bp.restDays;
      break;
    }
  }

  // Check if exceeded all breakpoints
  const lastBreakpoint = rules.breakpoints[rules.breakpoints.length - 1];
  if (lastPitched.pitches > lastBreakpoint.maxPitches) {
    requiredRest = rules.absoluteMaxRest;
  }

  if (daysSince >= requiredRest) {
    return {
      eligible: true,
      reason: 'Eligible',
      daysRest: daysSince,
      lastPitched: lastPitched.pitches
    };
  }

  const daysNeeded = requiredRest - daysSince;
  return {
    eligible: false,
    reason: `${daysNeeded}d rest`,
    daysRest: daysSince,
    daysNeeded,
    lastPitched: lastPitched.pitches
  };
}
