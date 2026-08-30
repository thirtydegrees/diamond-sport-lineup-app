/* ============================================
   Diamond Lineup - Cloud sync (v2 protocol)

   Local-first: the app always reads and writes localStorage;
   sync mirrors those blobs to the team's rows in team_data.
   One JSONB row per storage key.

   Protocol properties (each fixes an audit failure):
   - PER-KEY reconciliation with per-key dirty state: a change to
     one key can never cause an unrelated key to be overwritten
     in either direction (H1).
   - Server timestamps only for remote-change detection: we store
     the server's updated_at per key and compare identity, not
     client wall-clock ordering. The client clock is used only to
     break a true both-sides-changed conflict (rare; per-key).
   - Nulls are tombstones: a cleared current game or batting
     order pushes value=null, remote null rows are applied as
     local clears, and cleared data stays cleared (H2).
   - Writes are serialized per key and always read the LATEST
     local value at send time, so an older in-flight write can
     never finish last and clobber a newer one. Failed pushes
     keep their dirty flag and retry (H3).
   - Every queued write is bound to the user+team it was queued
     for and is dropped if identity changes before it runs (H4).
   - Team provisioning uses an atomic server-side function when
     available (see 0002 migration), so two devices racing on a
     new account cannot create two teams (H5).
   ============================================ */

import { supabase } from './supabaseClient';
import { Storage, StorageKeys } from './storage';

/** Keys that sync. pitchHistory is legacy: applied from remote for v1
    migration, never pushed (nothing writes it locally anymore). */
export const SYNC_KEYS: string[] = [
  StorageKeys.ROSTER,
  StorageKeys.SETTINGS,
  StorageKeys.GAMES,
  StorageKeys.DEFAULT_BATTING_ORDER,
  StorageKeys.CURRENT_GAME
];
const LEGACY_PULL_KEYS: string[] = [StorageKeys.PITCH_HISTORY];

export type SyncStatus = 'signedOut' | 'syncing' | 'synced' | 'error';

export interface RemoteRow {
  key: string;
  value: unknown;
  updated_at: string;
}

interface KeyMeta {
  dirty: boolean;
  dirtyAt: string | null;
  /** The server updated_at we last saw/wrote for this key. */
  remoteUpdatedAt: string | null;
}

interface SyncMeta {
  teamId: string | null;
  keys: Record<string, KeyMeta>;
}

const META_STORAGE_KEY = 'ybl_syncMeta';

function getMeta(): SyncMeta {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_STORAGE_KEY) || '{}');
    return { teamId: parsed.teamId ?? null, keys: parsed.keys ?? {} };
  } catch {
    return { teamId: null, keys: {} };
  }
}

function setMeta(mutate: (meta: SyncMeta) => void) {
  const meta = getMeta();
  mutate(meta);
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch (e) {
    console.error('sync meta write failed:', e);
  }
}

function keyMeta(meta: SyncMeta, key: string): KeyMeta {
  return meta.keys[key] || { dirty: false, dirtyAt: null, remoteUpdatedAt: null };
}

export function clearSyncMeta() {
  localStorage.removeItem(META_STORAGE_KEY);
}

export type KeyDecision = 'push' | 'apply' | 'none';

/**
 * Pure per-key reconciliation decision. Exported for unit tests.
 *
 * - Remote unchanged since last seen: push if locally dirty (or if the key
 *   has a local value the account has never seen - initial seeding).
 * - Remote changed, local clean: apply remote.
 * - Both changed (true conflict): last write wins, comparing the server's
 *   updated_at with the local edit time; ties go to remote.
 */
export function decideKeySync(params: {
  dirty: boolean;
  dirtyAt: string | null;
  lastSeenRemote: string | null;
  remoteRow: { updated_at: string } | null;
  hasLocalValue: boolean;
}): KeyDecision {
  const { dirty, dirtyAt, lastSeenRemote, remoteRow, hasLocalValue } = params;
  if (!remoteRow) {
    return dirty || hasLocalValue ? 'push' : 'none';
  }
  const remoteChanged = remoteRow.updated_at !== lastSeenRemote;
  if (!remoteChanged) return dirty ? 'push' : 'none';
  if (!dirty) return 'apply';
  return dirtyAt && dirtyAt > remoteRow.updated_at ? 'push' : 'apply';
}

function readLocal(key: string): unknown {
  return Storage._get<unknown>(key, null);
}

function writeLocal(key: string, value: unknown) {
  if (value === null) Storage._remove(key);
  else Storage._set(key, value);
}

class SyncService {
  private teamId: string | null = null;
  private userId: string | null = null;
  private ready = false; // no pushes until the initial reconcile ran
  private pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per-key write chains: guarantees one in-flight write per key. */
  private chains = new Map<string, Promise<void>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<(s: SyncStatus) => void>();
  status: SyncStatus = 'signedOut';
  lastError: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { void this.flushDirty(); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flushDirty();
      });
    }
  }

  onStatus(listener: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(s: SyncStatus, error: string | null = null) {
    this.status = s;
    this.lastError = error;
    this.statusListeners.forEach(l => l(s));
  }

  get isReady() {
    return this.ready;
  }

  /** Record that a local key changed (called on every persisted change). */
  markDirty(key: string) {
    if (!SYNC_KEYS.includes(key)) return;
    setMeta(meta => {
      meta.keys[key] = { ...keyMeta(meta, key), dirty: true, dirtyAt: new Date().toISOString() };
    });
  }

  /** All local keys marked dirty (after a restore replaces everything). */
  markAllDirty() {
    SYNC_KEYS.forEach(k => this.markDirty(k));
  }

  /**
   * Find (or atomically create) the signed-in user's personal team.
   * Prefers the 0002 migration's RPC; falls back to select-then-insert
   * for projects that have not run it yet.
   */
  private async ensureTeam(): Promise<string> {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_or_create_personal_team');
    if (!rpcError && rpcData) return rpcData as string;

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
    // Null values are tombstones and MUST be kept (H2)
    return data || [];
  }

  private applyRow(key: string, value: unknown, updatedAt: string) {
    writeLocal(key, value);
    setMeta(meta => {
      meta.keys[key] = { dirty: false, dirtyAt: null, remoteUpdatedAt: updatedAt };
    });
  }

  /**
   * Push one key, serialized per key. Reads the CURRENT local value at send
   * time and uses optimistic concurrency against the last-seen server
   * timestamp so a concurrent remote write is detected, not clobbered.
   */
  private flushKey(key: string): Promise<void> {
    const boundUser = this.userId;
    const boundTeam = this.teamId;
    const prev = this.chains.get(key) || Promise.resolve();
    const next = prev.then(async () => {
      // Identity binding (H4): drop writes queued for another user/team
      if (!this.ready || this.userId !== boundUser || this.teamId !== boundTeam || !boundTeam) return;
      const meta = keyMeta(getMeta(), key);
      if (!meta.dirty) return;

      const value = readLocal(key);
      const sentDirtyAt = meta.dirtyAt;

      const finish = (updatedAt: string) => {
        setMeta(m => {
          const cur = keyMeta(m, key);
          m.keys[key] = {
            // Keep dirty if the value changed again while this was in flight
            dirty: cur.dirtyAt !== sentDirtyAt,
            dirtyAt: cur.dirtyAt !== sentDirtyAt ? cur.dirtyAt : null,
            remoteUpdatedAt: updatedAt
          };
        });
      };

      if (meta.remoteUpdatedAt) {
        // Conditional update: only wins if the row is exactly as we last saw
        const { data, error } = await supabase
          .from('team_data')
          .update({ value: value ?? null })
          .eq('team_id', boundTeam)
          .eq('key', key)
          .eq('updated_at', meta.remoteUpdatedAt)
          .select('updated_at');
        if (error) throw error;
        if (data && data.length > 0) {
          finish(data[0].updated_at);
          return;
        }
        // The row changed (or vanished) under us: re-fetch and reconcile
        const { data: rows, error: fetchError } = await supabase
          .from('team_data')
          .select('key,value,updated_at')
          .eq('team_id', boundTeam)
          .eq('key', key);
        if (fetchError) throw fetchError;
        const row = rows?.[0] ?? null;
        if (row && (!sentDirtyAt || row.updated_at >= sentDirtyAt)) {
          // Remote edit is newer: it wins; our local change is superseded
          this.applyRow(key, row.value, row.updated_at);
          return;
        }
        // Our change is newer (or the row is gone): write unconditionally
      }

      const { data: upserted, error: upsertError } = await supabase
        .from('team_data')
        .upsert({ team_id: boundTeam, key, value: value ?? null }, { onConflict: 'team_id,key' })
        .select('updated_at');
      if (upsertError) throw upsertError;
      finish(upserted?.[0]?.updated_at ?? new Date().toISOString());
    });
    this.chains.set(key, next.catch(() => undefined));
    return next;
  }

  /** Push every dirty key. Failures keep dirty flags and arm a retry. */
  async flushDirty(): Promise<void> {
    if (!this.ready || !this.teamId) return;
    const meta = getMeta();
    const dirtyKeys = SYNC_KEYS.filter(k => keyMeta(meta, k).dirty);
    if (dirtyKeys.length === 0) return;

    this.setStatus('syncing');
    try {
      await Promise.all(dirtyKeys.map(k => this.flushKey(k)));
      this.setStatus('synced');
    } catch (e) {
      console.error('Sync push failed:', e);
      this.setStatus('error', e instanceof Error ? e.message : 'Push failed');
      this.armRetry();
    }
  }

  private armRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushDirty();
    }, 15000);
  }

  /**
   * Reconcile every key against the account (used by initial sync and
   * Sync Now). Returns true when any remote data was applied locally
   * (the caller must refresh React state from Storage).
   */
  private async reconcile(): Promise<boolean> {
    const remoteRows = await this.fetchRemote();
    const rowByKey = new Map(remoteRows.map(r => [r.key, r]));
    let applied = false;

    // Legacy pull-only keys (v1 pitch history feeds game migration)
    for (const key of LEGACY_PULL_KEYS) {
      const row = rowByKey.get(key);
      if (row && row.value !== null && readLocal(key) === null) {
        writeLocal(key, row.value);
        applied = true;
      }
    }

    for (const key of SYNC_KEYS) {
      const meta = keyMeta(getMeta(), key);
      const row = rowByKey.get(key) ?? null;
      const decision = decideKeySync({
        dirty: meta.dirty,
        dirtyAt: meta.dirtyAt,
        lastSeenRemote: meta.remoteUpdatedAt,
        remoteRow: row,
        hasLocalValue: readLocal(key) !== null
      });
      if (decision === 'apply' && row) {
        this.applyRow(key, row.value, row.updated_at);
        applied = true;
      } else if (decision === 'push') {
        this.markDirty(key);
        await this.flushKey(key);
      } else if (row) {
        // In sync: remember the server timestamp we're aligned with
        setMeta(m => {
          m.keys[key] = { ...keyMeta(m, key), remoteUpdatedAt: row.updated_at };
        });
      }
    }
    return applied;
  }

  /**
   * Run when a session is (re)established. Returns 'applyRemote' when any
   * local storage was replaced (caller must refresh React state).
   */
  async initialSync(userId: string): Promise<'pushLocal' | 'applyRemote'> {
    this.setStatus('syncing');
    try {
      this.userId = userId;
      this.teamId = await this.ensureTeam();
      // Switching accounts/teams counts as "never synced here"
      const stored = getMeta();
      if (stored.teamId !== this.teamId) {
        setMeta(meta => {
          meta.teamId = this.teamId;
          meta.keys = {};
        });
      }
      this.ready = true;
      const applied = await this.reconcile();
      this.setStatus('synced');
      return applied ? 'applyRemote' : 'pushLocal';
    } catch (e) {
      console.error('Initial sync failed:', e);
      this.ready = false;
      this.setStatus('error', e instanceof Error ? e.message : 'Sync failed');
      throw e;
    }
  }

  /** Manual "Sync Now": full two-way per-key reconcile. */
  async syncNow(): Promise<'pushLocal' | 'applyRemote'> {
    if (!this.teamId || !this.userId) throw new Error('Not signed in');
    this.setStatus('syncing');
    try {
      const applied = await this.reconcile();
      this.setStatus('synced');
      return applied ? 'applyRemote' : 'pushLocal';
    } catch (e) {
      console.error('Sync failed:', e);
      this.setStatus('error', e instanceof Error ? e.message : 'Sync failed');
      throw e;
    }
  }

  /** Debounced push of one storage key. No-op until initialSync has run. */
  schedulePush(key: string, _value?: unknown) {
    if (!SYNC_KEYS.includes(key)) return;
    // Dirty state is tracked even while signed out/not ready, so changes
    // made before the first sync are pushed once sync becomes available.
    this.markDirty(key);
    if (!this.ready || !this.teamId) return;

    const existing = this.pushTimers.get(key);
    if (existing) clearTimeout(existing);
    this.pushTimers.set(key, setTimeout(async () => {
      this.pushTimers.delete(key);
      try {
        this.setStatus('syncing');
        await this.flushKey(key);
        this.setStatus('synced');
      } catch (e) {
        console.error(`Push failed for ${key}:`, e);
        this.setStatus('error', e instanceof Error ? e.message : 'Push failed');
        this.armRetry();
      }
    }, 1500));
  }

  /**
   * Clear the account's cloud copy (used by signed-in "Clear All Data"):
   * writes null tombstones for every synced key so other devices clear too.
   */
  async clearCloud(): Promise<void> {
    if (!this.teamId) return;
    const payload = [...SYNC_KEYS, ...LEGACY_PULL_KEYS].map(key => ({
      team_id: this.teamId,
      key,
      value: null
    }));
    const { error } = await supabase
      .from('team_data')
      .upsert(payload, { onConflict: 'team_id,key' });
    if (error) throw error;
  }

  /** Best-effort flush before sign-out so pending edits reach the account. */
  async flushBeforeSignOut(): Promise<void> {
    try {
      await this.flushDirty();
    } catch {
      // Sign-out proceeds regardless; dirty flags survive locally
    }
  }

  /** Stop syncing (sign-out). Local data stays on the device. */
  disable() {
    this.pushTimers.forEach(t => clearTimeout(t));
    this.pushTimers.clear();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.chains.clear();
    this.teamId = null;
    this.userId = null;
    this.ready = false;
    clearSyncMeta();
    this.setStatus('signedOut');
  }
}

export const Sync = new SyncService();
