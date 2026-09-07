/** Revision-checked, atomic team snapshots. No clock-based conflict winners. */
import { DEFAULT_SETTINGS } from '../domain/constants';
import { supabase } from './supabaseClient';
import { Storage, StorageKeys, type DataSet } from './storage';
import { validateBackup } from './backup';

export const SYNC_KEYS: string[] = [
  StorageKeys.ROSTER,
  StorageKeys.SETTINGS,
  StorageKeys.GAMES,
  StorageKeys.DEFAULT_BATTING_ORDER,
  StorageKeys.CURRENT_GAME,
];
export type SyncStatus =
  'signedOut' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'error';
export interface DataOwner {
  userId: string;
  teamId: string;
  teamName: string;
}
export interface TeamInfo {
  id: string;
  name: string;
  is_personal: boolean;
}
interface Meta {
  teamId: string | null;
  revision: number | null;
  localRevision: number;
  dirty: boolean;
  mutationId?: string;
}
interface Remote {
  revision: number;
  snapshot: DataSet;
  mutation_id?: string;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
const meta = (): Meta =>
  Storage._get('snapshotMeta', {
    teamId: null,
    revision: null,
    localRevision: 0,
    dirty: false,
  });
export const getDataOwner = (): DataOwner | null =>
  Storage._get('dataOwner', null);
export function clearSyncMeta() {
  const raw = Storage.raw();
  delete raw.snapshotMeta;
  delete raw.syncMeta;
  delete raw.dataOwner;
  if (!Storage.replaceRaw(raw)) throw new Error('Could not save sync metadata');
}
export function decideSignInAction(
  owner: DataOwner | null,
  userId: string,
): 'proceed' | 'conflict' {
  return owner && owner.userId !== userId ? 'conflict' : 'proceed';
}
export type KeyDecision = 'push' | 'apply' | 'none' | 'conflict';
// Retained as a pure decision helper; true conflicts never use wall clocks.
export function decideKeySync(p: {
  dirty: boolean;
  dirtyAt: string | null;
  lastSeenRemote: string | null;
  remoteRow: { updated_at: string } | null;
  hasLocalValue: boolean;
}): KeyDecision {
  if (!p.remoteRow) return p.dirty || p.hasLocalValue ? 'push' : 'none';
  if (p.remoteRow.updated_at === p.lastSeenRemote)
    return p.dirty ? 'push' : 'none';
  return p.dirty ? 'conflict' : 'apply';
}

export class SyncService {
  private team: TeamInfo | null = null;
  private userId: string | null = null;
  private generation = 0;
  private ready = false;
  private attemptedUser: string | null = null;
  private transitioning = false;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  private applied = new Set<() => void>();
  status: SyncStatus = 'signedOut';
  lastError: string | null = null;
  lastPulledAt: string | null = null;
  constructor(private client = supabase) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.ready) void this.flushDirty();
        else if (this.attemptedUser && !this.transitioning)
          void this.initialSync(this.attemptedUser).catch(() => undefined);
      });
      document.addEventListener('visibilitychange', () => {
        if (this.ready) void this.flushDirty();
      });
    }
  }
  get isReady() {
    return this.ready;
  }
  get canEdit() {
    return !this.transitioning;
  }
  get currentTeam() {
    return this.team;
  }
  onStatus(fn: (s: SyncStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => {
      this.listeners.delete(fn);
    };
  }
  onRemoteApplied(fn: () => void) {
    this.applied.add(fn);
    return () => {
      this.applied.delete(fn);
    };
  }
  private statusTo(s: SyncStatus, error: string | null = null) {
    this.status = s;
    this.lastError = error;
    this.listeners.forEach((f) => f(s));
  }
  private assertGeneration(g: number) {
    if (g !== this.generation)
      throw new Error('Session changed; operation cancelled');
  }
  hasPendingChanges() {
    return meta().dirty;
  }
  checkAccountConflict(userId: string) {
    const o = getDataOwner();
    return decideSignInAction(o, userId) === 'conflict' ? o : null;
  }
  /** User changes and their dirty revision land in ONE atomic local write. */
  saveLocal(data: DataSet) {
    if (!this.canEdit)
      throw new Error('Wait for the team transition to finish');
    const m = meta();
    if (
      !Storage.replaceRaw({
        ...Storage.raw(),
        ...data,
        pitchHistory: [],
        snapshotMeta: {
          ...m,
          dirty: true,
          localRevision: m.localRevision + 1,
          mutationId: undefined,
        },
      })
    )
      throw new Error('Could not save to device storage');
    this.schedule();
  }
  markDirty(_key: string) {
    const m = meta();
    if (
      !Storage._set('snapshotMeta', {
        ...m,
        dirty: true,
        localRevision: m.localRevision + 1,
        mutationId: undefined,
      })
    )
      throw new Error('Could not save pending changes');
  }
  markAllDirty() {
    this.markDirty('all');
  }
  schedulePush(key: string) {
    this.markDirty(key);
    this.schedule();
  }
  private schedule() {
    if (!this.ready) return;
    this.statusTo('pending');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushDirty();
    }, 1500);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
  async listTeams(): Promise<TeamInfo[]> {
    const { data, error } = await this.client
      .from('teams')
      .select('id,name,is_personal')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async createTeam(name: string): Promise<TeamInfo> {
    if (!this.ready || !this.userId || this.transitioning)
      throw new Error('Wait for the active team to finish loading');
    const g = this.generation;
    const pending = Storage._get<{
      userId: string;
      name: string;
      requestId: string;
    } | null>('pendingTeamCreation', null);
    const requestId =
      pending?.userId === this.userId && pending.name === name.trim()
        ? pending.requestId
        : crypto.randomUUID();
    if (
      !Storage._set('pendingTeamCreation', {
        userId: this.userId,
        name: name.trim(),
        requestId,
      })
    )
      throw new Error('Could not save team creation request');
    const { data, error } = await this.client.rpc('create_named_team', {
      team_name: name.trim(),
      request_id: requestId,
    });
    this.assertGeneration(g);
    if (error) throw error;
    if (!Storage._remove('pendingTeamCreation'))
      throw new Error('Team created; reload the team list before retrying');
    return data as TeamInfo;
  }
  async renameTeam(name: string) {
    const g = this.generation,
      team = this.team;
    if (!team || !name.trim()) throw new Error('Enter a team name');
    const { error } = await this.client
      .from('teams')
      .update({ name: name.trim() })
      .eq('id', team.id)
      .select('id')
      .single();
    this.assertGeneration(g);
    if (error) throw error;
    this.team = { ...team, name: name.trim() };
    if (
      !Storage._set('dataOwner', {
        userId: this.userId,
        teamId: team.id,
        teamName: name.trim(),
      })
    )
      throw new Error('Could not save team name');
    this.statusTo(this.status);
  }
  private async fetch(teamId: string, g: number): Promise<Remote | null> {
    const { data, error } = await this.client
      .from('team_snapshots')
      .select('revision,snapshot,mutation_id')
      .eq('team_id', teamId)
      .maybeSingle();
    this.assertGeneration(g);
    if (error)
      throw new Error(
        error.message ||
          'Cloud schema unavailable; deployment migration required',
      );
    if (!data) return null;
    const raw = data.snapshot;
    // Legacy pitchHistory is accepted only by the shared migration boundary.
    const snapshot = validateBackup({
      app: 'diamond-lineup',
      version: 2,
      data: raw,
    }).data;
    return { ...data, snapshot } as Remote;
  }
  recoveryCopies() {
    const copies: { key: string; teamName: string; data: DataSet }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ybl_recovery_')) continue;
      try {
        const copy = JSON.parse(localStorage.getItem(key)!);
        if (
          !copy.owner ||
          copy.owner.userId === (this.userId || getDataOwner()?.userId)
        )
          copies.push({
            key,
            teamName: copy.owner?.teamName || 'Local team',
            data: copy.data,
          });
      } catch {
        /* retain unreadable copy for manual recovery */
      }
    }
    return copies;
  }
  private archive() {
    // Recoverable account-bound copy. Never uploaded to a different team.
    const key = `ybl_recovery_${Date.now()}_${crypto.randomUUID()}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        owner: getDataOwner(),
        data: Storage.exportDataSet(),
        meta: meta(),
      }),
    );
  }
  private adopt(remote: Remote | null, team: TeamInfo, userId: string) {
    const data = remote?.snapshot || {
      roster: [],
      settings: structuredClone(DEFAULT_SETTINGS),
      games: [],
      currentGame: null,
      defaultBattingOrder: null,
    };
    if (
      !Storage.replaceRaw({
        ...data,
        dataOwner: { userId, teamId: team.id, teamName: team.name },
        snapshotMeta: {
          teamId: team.id,
          revision: remote?.revision ?? null,
          dirty: false,
          localRevision: 0,
        },
      })
    )
      throw new Error(
        'Could not store downloaded team; original data retained',
      );
    this.applied.forEach((f) => f());
  }
  async initialSync(userId: string): Promise<'pushLocal' | 'applyRemote'> {
    this.attemptedUser = userId;
    const g = ++this.generation;
    this.transitioning = true;
    this.ready = false;
    this.statusTo('syncing');
    try {
      if (this.checkAccountConflict(userId))
        throw new Error('This device belongs to another account');
      const teams = await this.listTeams();
      this.assertGeneration(g);
      const owner = getDataOwner();
      let team = teams.find((t) => t.id === owner?.teamId);
      if (owner && !team)
        throw new Error(
          'Previous team is unavailable. Export your data before choosing another team.',
        );
      if (!team) team = teams.find((t) => t.is_personal);
      if (!team) {
        const { data, error } = await this.client.rpc(
          'get_or_create_personal_team',
        );
        this.assertGeneration(g);
        if (error) throw error;
        team = { id: data as string, name: 'My Team', is_personal: true };
      }
      const remote = await this.fetch(team.id, g);
      if (!owner && remote) {
        this.archive();
        this.adopt(remote, team, userId);
      } else {
        const m = meta();
        const legacyDirty = Object.values(
          Storage._get<{ keys?: Record<string, { dirty: boolean }> }>(
            'syncMeta',
            {},
          ).keys || {},
        ).some((k) => k.dirty);
        if (
          !Storage.replaceRaw({
            ...Storage.raw(),
            dataOwner: { userId, teamId: team.id, teamName: team.name },
            snapshotMeta: {
              ...m,
              teamId: team.id,
              dirty: m.dirty || legacyDirty || !remote,
            },
          })
        )
          throw new Error('Could not bind local data');
        // Upgrading a known team: preserve any local data that differs.
        if (m.revision == null && remote) {
          const same =
            canonical(Storage.exportDataSet()) === canonical(remote.snapshot);
          if (same) this.adopt(remote, team, userId);
          else {
            this.markDirty('all');
          }
        }
      }
      this.team = team;
      this.userId = userId;
      this.ready = true;
      this.transitioning = false;
      await this.reconcile(g);
      return 'applyRemote';
    } catch (e) {
      if (g === this.generation) {
        this.ready = false;
        this.statusTo('error', errorMessage(e));
      }
      throw e;
    } finally {
      if (g === this.generation) this.transitioning = false;
    }
  }
  private async reconcile(g: number): Promise<void> {
    this.assertGeneration(g);
    const team = this.team,
      user = this.userId;
    if (!team || !user || !this.ready) throw new Error('Not signed in');
    this.statusTo('syncing');
    const remote = await this.fetch(team.id, g);
    this.lastPulledAt = new Date().toISOString();
    const m = meta();
    if (!m.dirty) {
      if (remote && remote.revision !== m.revision)
        this.adopt(remote, team, user);
      this.statusTo('synced');
      return;
    }
    if (remote && m.mutationId && remote.mutation_id === m.mutationId) {
      if (
        !Storage._set('snapshotMeta', {
          ...m,
          revision: remote.revision,
          dirty: false,
          mutationId: undefined,
        })
      )
        throw new Error('Could not acknowledge save');
      this.statusTo('synced');
      return;
    }
    if ((remote?.revision ?? null) !== m.revision) {
      this.statusTo(
        'conflict',
        'Another device changed this team. Your edits are preserved. Download a backup, then load the cloud copy to reconcile.',
      );
      return;
    }
    const snapshot = validateBackup({
      app: 'diamond-lineup',
      version: 2,
      data: Storage.exportDataSet(),
    }).data;
    const mutationId = m.mutationId || crypto.randomUUID();
    if (!Storage._set('snapshotMeta', { ...m, mutationId }))
      throw new Error('Could not save retry identity');
    const { data, error } = await this.client.rpc('save_team_snapshot', {
      target_team: team.id,
      expected_revision: m.revision,
      payload: snapshot,
      request_id: mutationId,
    });
    this.assertGeneration(g);
    if (error) {
      if (error.code === '40001') {
        this.statusTo(
          'conflict',
          'Cloud changed during save. Local changes are preserved.',
        );
        return;
      }
      throw error;
    }
    const cur = meta(),
      dirty = cur.localRevision !== m.localRevision;
    if (
      !Storage._set('snapshotMeta', {
        ...cur,
        revision: Number(data),
        dirty,
        mutationId: dirty ? undefined : mutationId,
      })
    )
      throw new Error('Could not acknowledge save');
    this.statusTo(dirty ? 'pending' : 'synced');
    if (dirty) this.schedule();
  }
  async syncNow(): Promise<'applyRemote'> {
    const g = this.generation;
    return this.serial(async () => {
      try {
        await this.reconcile(g);
        return 'applyRemote' as const;
      } catch (e) {
        if (g === this.generation) this.statusTo('error', errorMessage(e));
        throw e;
      }
    });
  }
  async flushDirty() {
    if (!this.ready) return;
    try {
      await this.syncNow();
    } catch {
      if (this.ready && !this.timer)
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flushDirty();
        }, 15000);
    }
  }
  async switchTeam(team: TeamInfo) {
    if (!this.ready || !this.userId) throw new Error('Not signed in');
    if (team.id === this.team?.id) return;
    if (this.transitioning)
      throw new Error('A team operation is already running');
    const g = this.generation,
      user = this.userId;
    this.transitioning = true;
    try {
      await this.syncNow();
      this.assertGeneration(g);
      if (this.hasPendingChanges())
        throw new Error(
          'Sync or resolve pending changes before switching teams',
        );
      const remote = await this.fetch(team.id, g);
      this.adopt(remote, team, user);
      this.team = team;
      ++this.generation;
      this.transitioning = false;
      this.statusTo('synced');
    } finally {
      if (g === this.generation) this.transitioning = false;
    }
  }
  async adoptAccount(userId: string): Promise<'applyRemote'> {
    this.attemptedUser = userId;
    const g = ++this.generation;
    this.ready = false;
    this.transitioning = true;
    try {
      const teams = await this.listTeams();
      this.assertGeneration(g);
      let team = teams.find((t) => t.is_personal);
      if (!team) {
        const { data, error } = await this.client.rpc(
          'get_or_create_personal_team',
        );
        this.assertGeneration(g);
        if (error) throw error;
        team = { id: data as string, name: 'My Team', is_personal: true };
      }
      const remote = await this.fetch(team.id, g);
      this.archive();
      this.adopt(remote, team, userId);
      this.userId = userId;
      this.team = team;
      this.ready = true;
      this.statusTo('synced');
      return 'applyRemote';
    } finally {
      if (g === this.generation) this.transitioning = false;
    }
  }
  async useCloudCopy() {
    const g = this.generation,
      team = this.team,
      user = this.userId;
    if (!team || !user || this.transitioning)
      throw new Error('Wait for the active team to finish loading');
    this.transitioning = true;
    try {
      await this.serial(async () => {
        const r = await this.fetch(team.id, g);
        if (!r) throw new Error('No cloud copy');
        this.archive();
        this.adopt(r, team, user);
        this.statusTo('synced');
      });
    } finally {
      if (g === this.generation) this.transitioning = false;
    }
  }
  async clearCloud() {
    if (!this.ready || !this.team || this.transitioning)
      throw new Error('Resolve the active team before clearing');
    const g = this.generation;
    this.transitioning = true;
    try {
      await this.serial(async () => {
        await this.reconcile(g);
        this.assertGeneration(g);
        if (this.hasPendingChanges())
          throw new Error('Resolve pending changes before clearing');
        this.archive();
        const m = meta();
        const data: DataSet = {
          roster: [],
          settings: Storage.getSettings(),
          games: [],
          currentGame: null,
          defaultBattingOrder: null,
          unreviewedPitchRecords: [],
        };
        if (
          !Storage.replaceRaw({
            ...Storage.raw(),
            ...data,
            pitchHistory: [],
            snapshotMeta: {
              ...m,
              dirty: true,
              localRevision: m.localRevision + 1,
              mutationId: undefined,
            },
          })
        )
          throw new Error('Could not save clear');
        this.applied.forEach((f) => f());
        await this.reconcile(g);
        if (this.hasPendingChanges())
          throw new Error(
            'Clear not acknowledged; resolve sync before continuing',
          );
      });
    } finally {
      if (g === this.generation) this.transitioning = false;
    }
  }
  async flushBeforeSignOut() {
    await this.flushDirty();
  }
  disable() {
    ++this.generation;
    this.attemptedUser = null;
    this.ready = false;
    this.transitioning = false;
    this.team = null;
    this.userId = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.statusTo('signedOut');
  }
}
function errorMessage(e: unknown) {
  return e && typeof e === 'object' && 'message' in e
    ? String(e.message)
    : 'Sync failed';
}
export const Sync = new SyncService();
