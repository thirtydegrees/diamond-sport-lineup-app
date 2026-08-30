/* ============================================
   Diamond Lineup - Backup export & validated restore

   Backups are versioned. Restores are validated fully in memory
   (structure, field types, and per-game migration) BEFORE any
   write, then committed through Storage.importDataSet, which is
   atomic-with-rollback. A malformed, truncated, or partial file
   can never leave the device with a hybrid dataset (H11).

   v1 backups (the old flat ExportedData shape) restore through
   the same migration path as v1 device data.
   ============================================ */

import { DEFAULT_SETTINGS } from '../domain/constants';
import { normalizePitchRules } from '../domain/pitching';
import { todayISO } from '../domain/dates';
import type { Game, PitchRecord, Player, Settings } from '../domain/types';
import { isV2Game, migrateCurrentGameV1, migrateSavedGameV1 } from './migrate';
import { Storage, type DataSet } from './storage';

export const BACKUP_VERSION = 2;

export interface BackupFile {
  app: 'diamond-lineup';
  version: number;
  exportDate: string;
  data: DataSet;
}

export function buildBackup(): BackupFile {
  return {
    app: 'diamond-lineup',
    version: BACKUP_VERSION,
    exportDate: new Date().toISOString(),
    data: Storage.exportDataSet()
  };
}

export function backupFilename(): string {
  return `diamond-lineup-backup-${todayISO()}.json`;
}

export interface ValidatedBackup {
  data: DataSet;
  summary: string;
  fromVersion: 1 | 2;
}

export class BackupError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validatePlayer(raw: unknown, index: number): Player {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new BackupError(`player #${index + 1} is malformed`);
  }
  return {
    id: raw.id,
    name: raw.name,
    canPitch: !!raw.canPitch,
    prefersPitching: !!raw.prefersPitching,
    canCatch: !!raw.canCatch,
    positions: isRecord(raw.positions) ? (raw.positions as Player['positions']) : {},
    preferredOrder: Array.isArray(raw.preferredOrder) ? (raw.preferredOrder as Player['preferredOrder']) : []
  };
}

function validateSettings(raw: unknown): Settings {
  const saved = isRecord(raw) ? (raw as Partial<Settings>) : {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    fairness: { ...DEFAULT_SETTINGS.fairness, ...(isRecord(saved.fairness) ? saved.fairness : {}) },
    pitchRules: normalizePitchRules({
      ...DEFAULT_SETTINGS.pitchRules,
      ...(isRecord(saved.pitchRules) ? saved.pitchRules : {})
    })
  };
}

function validateGameShape(raw: unknown, index: number): void {
  if (!isRecord(raw)) throw new BackupError(`game #${index + 1} is not an object`);
  if (typeof raw.id !== 'string' || typeof raw.date !== 'string') {
    throw new BackupError(`game #${index + 1} is missing id/date`);
  }
  if (raw.lineup !== undefined && !isRecord(raw.lineup)) {
    throw new BackupError(`game #${index + 1} has a malformed lineup`);
  }
  if (!Array.isArray(raw.battingOrder ?? [])) {
    throw new BackupError(`game #${index + 1} has a malformed batting order`);
  }
}

function checkV2Game(game: Game, index: number): Game {
  if (!Array.isArray(game.outs)) throw new BackupError(`game #${index + 1} has malformed outs`);
  if (!isRecord(game.pitchCounts)) throw new BackupError(`game #${index + 1} has malformed pitch counts`);
  if (!['draft', 'live', 'completed'].includes(game.status)) {
    throw new BackupError(`game #${index + 1} has an unknown status`);
  }
  return game;
}

/**
 * Parse + validate backup JSON (already object-parsed). Throws BackupError
 * with a human-readable reason. Returns the fully-migrated dataset; nothing
 * is written to storage.
 */
export function validateBackup(parsed: unknown): ValidatedBackup {
  if (!isRecord(parsed)) throw new BackupError('not a Diamond Lineup backup');

  // Distinguish v2 envelope from v1 flat export
  const isV2 = parsed.app === 'diamond-lineup' && typeof parsed.version === 'number';
  const body = isV2 ? parsed.data : parsed;
  if (!isRecord(body) || !Array.isArray(body.roster)) {
    throw new BackupError('not a Diamond Lineup backup');
  }
  if (isV2 && (parsed.version as number) > BACKUP_VERSION) {
    throw new BackupError(`backup version ${parsed.version} is newer than this app understands`);
  }

  const roster = (body.roster as unknown[]).map(validatePlayer);
  const settings = validateSettings(body.settings);

  const rawGames = body.games === undefined || body.games === null ? [] : body.games;
  if (!Array.isArray(rawGames)) throw new BackupError('games list is malformed');
  rawGames.forEach(validateGameShape);

  const pitchHistory: PitchRecord[] = Array.isArray(body.pitchHistory)
    ? (body.pitchHistory as PitchRecord[])
    : [];

  const games: Game[] = rawGames.map((g, i) =>
    isV2Game(g) ? checkV2Game(g, i) : migrateSavedGameV1(g, pitchHistory, roster)
  );

  const rawCurrent = body.currentGame ?? null;
  let currentGame: Game | null = null;
  if (rawCurrent !== null) {
    validateGameShape(rawCurrent, 0);
    currentGame = isV2Game(rawCurrent) ? checkV2Game(rawCurrent, 0) : migrateCurrentGameV1(rawCurrent, roster);
  }

  const rawOrder = body.defaultBattingOrder ?? null;
  if (rawOrder !== null && !Array.isArray(rawOrder)) {
    throw new BackupError('default batting order is malformed');
  }
  const defaultBattingOrder = rawOrder as string[] | null;

  const fromVersion = isV2 ? 2 : 1;
  return {
    data: { roster, settings, currentGame, games, defaultBattingOrder },
    summary:
      `${roster.length} players, ${games.length} saved games` +
      (fromVersion === 1 ? ' (older backup format, converted)' : ''),
    fromVersion: fromVersion as 1 | 2
  };
}

/** Commit a validated backup. Returns false (and changes nothing) on failure. */
export function restoreBackup(validated: ValidatedBackup): boolean {
  return Storage.importDataSet(validated.data);
}
