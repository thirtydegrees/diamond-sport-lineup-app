/* ============================================
   Diamond Lineup - Cloud sync

   Local-first: the app always reads and writes localStorage;
   sync mirrors those blobs to the team's rows in team_data.
   One JSONB row per storage key, last-write-wins.

   Rules (deliberately simple for the beta):
   - Account has no data yet        -> this device seeds it
   - Device never synced this team  -> the account's data wins
     (signing in "adopts" the account onto the device)
   - Both have synced before        -> whichever changed last wins

   Push is debounced per key and disabled until the initial
   sync decision has run, so a device can never clobber the
   account before it has looked at it.
   ============================================ */

import { supabase } from './supabaseClient';
import { Storage, StorageKeys, type ExportedData } from './storage';

/** Keys that sync (backups also carry exportDate, which does not). */
export const SYNC_KEYS: string[] = [
  StorageKeys.ROSTER,
  StorageKeys.SETTINGS,
  StorageKeys.GAMES,
  StorageKeys.PITCH_HISTORY,
  StorageKeys.DEFAULT_BATTING_ORDER,
  StorageKeys.CURRENT_GAME
];

export type SyncStatus = 'signedOut' | 'syncing' | 'synced' | 'error';

export interface RemoteRow {
  key: string;
  value: unknown;
  updated_at: string;
}

interface SyncMeta {
  teamId: string | null;
  lastSyncAt: string | null;
}

const META_STORAGE_KEY = 'ybl_syncMeta';

function getMeta(): SyncMeta {
  try {
    return { teamId: null, lastSyncAt: null, ...JSON.parse(localStorage.getItem(META_STORAGE_KEY) || '{}') };
  } catch {
    return { teamId: null, lastSyncAt: null };
  }
}

function setMeta(meta: Partial<SyncMeta>) {
  localStorage.setItem(META_STORAGE_KEY, JSON.stringify({ ...getMeta(), ...meta }));
}

export function clearSyncMeta() {
  localStorage.removeItem(META_STORAGE_KEY);
}

/**
 * Pure decision for what the initial sync should do.
 * Exported for unit tests.
 */
export function decideInitialSync(params: {
  hasLocalData: boolean;
  remoteRows: Pick<RemoteRow, 'updated_at'>[];
  lastSyncAt: string | null;
}): 'pushLocal' | 'applyRemote' {
  const { hasLocalData, remoteRows, lastSyncAt } = params;

  if (remoteRows.length === 0) return 'pushLocal';
  if (!hasLocalData) return 'applyRemote';
  if (!lastSyncAt) return 'applyRemote'; // never synced here: the account wins

  const remoteNewest = remoteRows.reduce(
    (max, r) => (r.updated_at > max ? r.updated_at : max), ''
  );
  return remoteNewest > lastSyncAt ? 'applyRemote' : 'pushLocal';
}

function localSnapshot(): Record<string, unknown> {
  const data: ExportedData = Storage.exportAllData();
  return {
    [StorageKeys.ROSTER]: data.roster,
    [StorageKeys.SETTINGS]: data.settings,
    [StorageKeys.GAMES]: data.games,
    [StorageKeys.PITCH_HISTORY]: data.pitchHistory,
    [StorageKeys.DEFAULT_BATTING_ORDER]: data.defaultBattingOrder,
    [StorageKeys.CURRENT_GAME]: data.currentGame
  };
}

function hasLocalData(): boolean {
  return Storage.getRoster().length > 0 || Storage.getGames().length > 0;
}

/** Write remote rows into local storage. Caller refreshes React state. */
export function applyRemoteRows(rows: RemoteRow[]) {
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  Storage.importAllData({
    roster: byKey.get(StorageKeys.ROSTER) as ExportedData['roster'],
    settings: byKey.get(StorageKeys.SETTINGS) as ExportedData['settings'],
    games: byKey.get(StorageKeys.GAMES) as ExportedData['games'],
    pitchHistory: byKey.get(StorageKeys.PITCH_HISTORY) as ExportedData['pitchHistory'],
    defaultBattingOrder: byKey.get(StorageKeys.DEFAULT_BATTING_ORDER) as ExportedData['defaultBattingOrder'],
    currentGame: byKey.get(StorageKeys.CURRENT_GAME) as ExportedData['currentGame']
  });
}

class SyncService {
  private teamId: string | null = null;
  private ready = false; // no pushes until the initial sync decision ran
  private pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private statusListeners = new Set<(s: SyncStatus) => void>();
  status: SyncStatus = 'signedOut';

  onStatus(listener: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
    this.statusListeners.forEach(l => l(s));
  }

  /** Find (or create) the signed-in user's team. */
  private async ensureTeam(): Promise<string> {
    const { data, error } = await supabase
      .from('teams')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return data[0].id;

    const { data: created, error: insertError } = await supabase
      .from('teams')
      .insert({ name: 'My Team' })
      .select('id')
      .single();
    if (insertError) throw insertError;
    return created.id;
  }

  private async fetchRemote(): Promise<RemoteRow[]> {
    const { data, error } = await supabase
      .from('team_data')
      .select('key,value,updated_at')
      .eq('team_id', this.teamId);
    if (error) throw error;
    return (data || []).filter(r => r.value !== null);
  }

  private async pushRows(rows: Record<string, unknown>) {
    const payload = Object.entries(rows).map(([key, value]) => ({
      team_id: this.teamId,
      key,
      value: value ?? null
    }));
    const { error } = await supabase
      .from('team_data')
      .upsert(payload, { onConflict: 'team_id,key' });
    if (error) throw error;
    setMeta({ lastSyncAt: new Date().toISOString() });
  }

  /**
   * Run when a session is (re)established or on app start while signed in.
   * Returns 'applyRemote' when local storage was replaced (the caller must
   * refresh React state from Storage), 'pushLocal' otherwise.
   */
  async initialSync(): Promise<'pushLocal' | 'applyRemote'> {
    this.setStatus('syncing');
    try {
      this.teamId = await this.ensureTeam();
      const storedMeta = getMeta();
      // Switching accounts/teams counts as "never synced here"
      const lastSyncAt = storedMeta.teamId === this.teamId ? storedMeta.lastSyncAt : null;
      setMeta({ teamId: this.teamId });

      const remoteRows = await this.fetchRemote();
      const decision = decideInitialSync({
        hasLocalData: hasLocalData(),
        remoteRows,
        lastSyncAt
      });

      if (decision === 'applyRemote') {
        applyRemoteRows(remoteRows);
        setMeta({ lastSyncAt: new Date().toISOString() });
      } else {
        await this.pushRows(localSnapshot());
      }

      this.ready = true;
      this.setStatus('synced');
      return decision;
    } catch (e) {
      console.error('Initial sync failed:', e);
      this.setStatus('error');
      throw e;
    }
  }

  /** Manual "Sync Now": pull if another device pushed since; push otherwise. */
  async syncNow(): Promise<'pushLocal' | 'applyRemote'> {
    if (!this.teamId) return this.initialSync();
    this.setStatus('syncing');
    try {
      const remoteRows = await this.fetchRemote();
      const { lastSyncAt } = getMeta();
      const remoteNewest = remoteRows.reduce(
        (max, r) => (r.updated_at > max ? r.updated_at : max), ''
      );
      if (remoteNewest && (!lastSyncAt || remoteNewest > lastSyncAt)) {
        applyRemoteRows(remoteRows);
        setMeta({ lastSyncAt: new Date().toISOString() });
        this.setStatus('synced');
        return 'applyRemote';
      }
      await this.pushRows(localSnapshot());
      this.setStatus('synced');
      return 'pushLocal';
    } catch (e) {
      console.error('Sync failed:', e);
      this.setStatus('error');
      throw e;
    }
  }

  /** Debounced push of one storage key. No-op until initialSync has run. */
  schedulePush(key: string, value: unknown) {
    if (!this.ready || !this.teamId || !SYNC_KEYS.includes(key)) return;

    const existing = this.pushTimers.get(key);
    if (existing) clearTimeout(existing);

    this.pushTimers.set(key, setTimeout(async () => {
      this.pushTimers.delete(key);
      try {
        this.setStatus('syncing');
        await this.pushRows({ [key]: value });
        this.setStatus('synced');
      } catch (e) {
        console.error(`Push failed for ${key}:`, e);
        this.setStatus('error');
      }
    }, 1500));
  }

  /** Stop syncing (sign-out). Local data stays on the device. */
  disable() {
    this.pushTimers.forEach(t => clearTimeout(t));
    this.pushTimers.clear();
    this.teamId = null;
    this.ready = false;
    clearSyncMeta();
    this.setStatus('signedOut');
  }
}

export const Sync = new SyncService();
