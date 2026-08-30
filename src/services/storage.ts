/* ============================================
   Diamond Lineup - Storage Service

   Abstraction layer over localStorage. All persistence goes
   through this service; cloud sync mirrors these keys.

   v2: games carry their own out ledgers and pitch-count state.
   Legacy v1 blobs (from old devices, cloud rows, or backups)
   are migrated on read, so every caller always sees v2 games.
   The old pitchHistory collection is migration input only -
   pitching workload is derived from completed games.
   ============================================ */

import { DEFAULT_SETTINGS } from '../domain/constants';
import { compareDatesDesc } from '../domain/dates';
import { normalizePitchRules } from '../domain/pitching';
import type { Game, PitchRecord, Player, Settings } from '../domain/types';
import { isV2Game, migrateCurrentGameV1, migrateSavedGameV1 } from './migrate';

const STORAGE_PREFIX = 'ybl_';

export interface DataSet {
  roster: Player[];
  settings: Settings;
  currentGame: Game | null;
  games: Game[];
  defaultBattingOrder: string[] | null;
}

export const StorageKeys = {
  ROSTER: 'roster',
  SETTINGS: 'settings',
  CURRENT_GAME: 'currentGame',
  GAMES: 'games',
  PITCH_HISTORY: 'pitchHistory', // legacy, read for migration only
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
  // Roster
  // ----------------------------------------

  getRoster(): Player[] {
    return this._get<Player[]>(StorageKeys.ROSTER, []);
  },

  saveRoster(roster: Player[]): boolean {
    return this._set(StorageKeys.ROSTER, roster);
  },

  // ----------------------------------------
  // Settings
  // ----------------------------------------

  getSettings(): Settings {
    const saved = this._get<Partial<Settings>>(StorageKeys.SETTINGS, {});
    // Merge with defaults so fields added in later versions exist, and
    // normalize pitch rules so malformed custom input can't corrupt
    // eligibility math (unsorted breakpoints, negative values).
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      fairness: {
        ...DEFAULT_SETTINGS.fairness,
        ...(saved.fairness || {})
      },
      pitchRules: normalizePitchRules({
        ...DEFAULT_SETTINGS.pitchRules,
        ...(saved.pitchRules || {})
      })
    };
  },

  saveSettings(settings: Settings): boolean {
    return this._set(StorageKeys.SETTINGS, {
      ...settings,
      pitchRules: normalizePitchRules(settings.pitchRules)
    });
  },

  // ----------------------------------------
  // Default batting order
  // ----------------------------------------

  getDefaultBattingOrder(): string[] | null {
    return this._get<string[] | null>(StorageKeys.DEFAULT_BATTING_ORDER, null);
  },

  saveDefaultBattingOrder(order: string[] | null): boolean {
    if (order === null) return this._remove(StorageKeys.DEFAULT_BATTING_ORDER);
    return this._set(StorageKeys.DEFAULT_BATTING_ORDER, order);
  },

  // ----------------------------------------
  // Current (draft/live) game
  // ----------------------------------------

  getCurrentGame(): Game | null {
    const raw = this._get<unknown>(StorageKeys.CURRENT_GAME, null);
    if (raw === null) return null;
    if (isV2Game(raw)) return raw;
    const migrated = migrateCurrentGameV1(raw, this.getRoster());
    this._set(StorageKeys.CURRENT_GAME, migrated);
    return migrated;
  },

  saveCurrentGame(game: Game | null): boolean {
    return this._set(StorageKeys.CURRENT_GAME, game);
  },

  clearCurrentGame(): boolean {
    return this._remove(StorageKeys.CURRENT_GAME);
  },

  // ----------------------------------------
  // Completed game history
  // ----------------------------------------

  getGames(): Game[] {
    const raw = this._get<unknown[]>(StorageKeys.GAMES, []);
    if (raw.every(isV2Game)) return raw as Game[];
    // Legacy blob (local v1 data, an old backup, or an old cloud row):
    // migrate every game and write the result back once.
    const pitchHistory = this.getLegacyPitchHistory();
    const roster = this.getRoster();
    const migrated = raw.map(g => (isV2Game(g) ? g : migrateSavedGameV1(g, pitchHistory, roster)));
    this._set(StorageKeys.GAMES, migrated);
    return migrated;
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
    // v2: pitching workload is derived from the games list, so removing the
    // game removes its workload with it - no separate records to purge.
    return this.saveGames(this.getGames().filter(g => g.id !== gameId));
  },

  /** Most recent completed game (for "use last game's lineup"). */
  getLastGame(): Game | null {
    const games = this.getGames();
    if (games.length === 0) return null;
    const sorted = [...games].sort((a, b) => compareDatesDesc(a.date, b.date));
    return sorted[0];
  },

  // ----------------------------------------
  // Legacy pitch history (migration input only)
  // ----------------------------------------

  getLegacyPitchHistory(): PitchRecord[] {
    return this._get<PitchRecord[]>(StorageKeys.PITCH_HISTORY, []);
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

  /** Current dataset (backup export and sync snapshots). */
  exportDataSet(): DataSet {
    return {
      roster: this.getRoster(),
      settings: this.getSettings(),
      currentGame: this.getCurrentGame(),
      games: this.getGames(),
      defaultBattingOrder: this.getDefaultBattingOrder()
    };
  },

  /**
   * Replace the full dataset. Explicit nulls CLEAR their key (a cleared
   * current game or batting order must not resurrect). Every write result
   * is checked; on any failure the previous values are restored so a
   * half-applied import can't corrupt the device (H11).
   */
  importDataSet(data: DataSet): boolean {
    const backupRaw: Record<string, string | null> = {};
    const keys = [
      StorageKeys.ROSTER,
      StorageKeys.SETTINGS,
      StorageKeys.CURRENT_GAME,
      StorageKeys.GAMES,
      StorageKeys.DEFAULT_BATTING_ORDER
    ];
    try {
      for (const key of keys) {
        backupRaw[key] = localStorage.getItem(STORAGE_PREFIX + key);
      }
    } catch {
      return false;
    }

    const writes: [string, unknown][] = [
      [StorageKeys.ROSTER, data.roster],
      [StorageKeys.SETTINGS, data.settings],
      [StorageKeys.CURRENT_GAME, data.currentGame],
      [StorageKeys.GAMES, data.games],
      [StorageKeys.DEFAULT_BATTING_ORDER, data.defaultBattingOrder]
    ];

    let ok = true;
    for (const [key, value] of writes) {
      if (value === null) ok = this._remove(key) && ok;
      else ok = this._set(key, value) && ok;
      if (!ok) break;
    }

    if (!ok) {
      // Roll back to the pre-import state
      for (const [key, raw] of Object.entries(backupRaw)) {
        try {
          if (raw === null) localStorage.removeItem(STORAGE_PREFIX + key);
          else localStorage.setItem(STORAGE_PREFIX + key, raw);
        } catch {
          // Rollback is best-effort under storage failure
        }
      }
      return false;
    }
    return true;
  }
};
