import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncService, getDataOwner } from './sync';
import { Storage } from './storage';
import { DEFAULT_SETTINGS } from '../domain/constants';
import { makePlayer } from '../test/fixtures';

const store = new Map<string, string>();
const shim = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
};
Object.assign(globalThis, { localStorage: shim });
const empty = () => ({
  roster: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  games: [],
  currentGame: null,
  defaultBattingOrder: null,
  unreviewedPitchRecords: [],
});
const team = { id: 't1', name: 'Tigers', is_personal: true };
const other = { id: 't2', name: 'Bears', is_personal: false };
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}
class Cloud {
  rows = new Map<string, any>();
  failedTeam: string | null = null;
  pause: ReturnType<typeof deferred> | null = null;
  entered: ReturnType<typeof deferred> | null = null;
  writes = 0;
  reads = new Map<
    string,
    { pause: ReturnType<typeof deferred>; entered: ReturnType<typeof deferred> }
  >();
  from(table: string) {
    let teamId = '';
    const query: any = {
      select: () => query,
      eq: (_k: string, v: string) => {
        teamId = v;
        return query;
      },
      order: async () => ({ data: [team, other], error: null }),
      maybeSingle: async () => {
        const row = this.rows.get(teamId) || null;
        const gate = this.reads.get(teamId);
        if (gate) {
          this.reads.delete(teamId);
          gate.entered.release();
          await gate.pause.promise;
        }
        return {
          data: row,
          error: this.failedTeam === teamId ? { message: 'offline' } : null,
        };
      },
    };
    return query;
  }
  async rpc(name: string, args: any) {
    if (name === 'get_or_create_personal_team')
      return { data: team.id, error: null };
    this.entered?.release();
    if (this.pause) await this.pause.promise;
    const old = this.rows.get(args.target_team);
    if ((old?.revision ?? null) !== args.expected_revision)
      return { error: { code: '40001' } };
    const revision = (old?.revision ?? 0) + 1;
    this.rows.set(args.target_team, {
      revision,
      snapshot: structuredClone(args.payload),
      mutation_id: args.request_id,
    });
    this.writes++;
    return { data: revision, error: null };
  }
}
let service: SyncService;
let cloud: Cloud;
beforeEach(() => {
  store.clear();
  Object.assign(globalThis, { localStorage: shim });
  cloud = new Cloud();
  service = new SyncService(cloud as any);
});
afterEach(() => service.disable());
describe('real snapshot sync lifecycle', () => {
  it('upgrades an unchanged legacy team without creating a conflict', async () => {
    Storage.replaceRaw({
      ...empty(),
      dataOwner: { userId: 'u1', teamId: 't1', teamName: 'Tigers' },
    });
    cloud.rows.set('t1', {
      revision: 1,
      snapshot: empty(),
      mutation_id: 'legacy',
    });
    await service.initialSync('u1');
    expect(service.status).toBe('synced');
    expect(cloud.writes).toBe(0);
  });
  it('first use pushes once; hydration does not become an upload', async () => {
    await service.initialSync('u1');
    expect(cloud.writes).toBe(1);
    await service.syncNow();
    expect(cloud.writes).toBe(1);
    expect(service.hasPendingChanges()).toBe(false);
  });
  it('preserves a newer local edit made while a save is in flight', async () => {
    await service.initialSync('u1');
    service.saveLocal({
      ...Storage.exportDataSet(),
      roster: [makePlayer('a', 'First')],
    });
    cloud.pause = deferred();
    cloud.entered = deferred();
    const sync = service.syncNow();
    await cloud.entered.promise;
    service.saveLocal({
      ...Storage.exportDataSet(),
      roster: [makePlayer('a', 'Second')],
    });
    cloud.pause.release();
    await sync;
    expect(Storage.getRoster()[0].name).toBe('Second');
    expect(service.hasPendingChanges()).toBe(true);
    cloud.pause = null;
    await service.syncNow();
    expect(cloud.rows.get('t1').snapshot.roster[0].name).toBe('Second');
  });
  it('preserves both devices on conflict, with no unconditional fallback', async () => {
    await service.initialSync('u1');
    service.saveLocal({
      ...Storage.exportDataSet(),
      roster: [makePlayer('a', 'Local')],
    });
    cloud.rows.set('t1', {
      revision: 2,
      snapshot: { ...empty(), roster: [makePlayer('b', 'Remote')] },
      mutation_id: 'other',
    });
    await service.syncNow();
    expect(service.status).toBe('conflict');
    expect(Storage.getRoster()[0].name).toBe('Local');
    expect(cloud.writes).toBe(1);
    await service.useCloudCopy();
    expect(Storage.getRoster()[0].name).toBe('Remote');
    expect([...store.keys()].some((k) => k.startsWith('ybl_recovery_'))).toBe(
      true,
    );
  });
  it('does not delete the active team when destination fetch fails', async () => {
    await service.initialSync('u1');
    cloud.failedTeam = 't2';
    const original = Storage.exportDataSet();
    await expect(service.switchTeam(other)).rejects.toThrow('offline');
    expect(Storage.exportDataSet()).toEqual(original);
    expect(getDataOwner()?.teamId).toBe('t1');
    expect(service.canEdit).toBe(true);
  });
  it('invalidates late saves on signout', async () => {
    await service.initialSync('u1');
    service.saveLocal({ ...empty(), roster: [makePlayer('a', 'Pending')] });
    cloud.pause = deferred();
    cloud.entered = deferred();
    const sync = service.syncNow();
    await cloud.entered.promise;
    service.disable();
    cloud.pause.release();
    await expect(sync).rejects.toThrow('Session changed');
    expect(service.status).toBe('signedOut');
    expect(service.hasPendingChanges()).toBe(true);
    expect(Storage.getRoster()[0].name).toBe('Pending');
  });
  it('rejects malformed remote snapshots without replacing local data', async () => {
    await service.initialSync('u1');
    cloud.rows.set('t1', {
      revision: 2,
      snapshot: { ...empty(), games: [{ schemaVersion: 2 }] },
    });
    await expect(service.syncNow()).rejects.toThrow();
    expect(Storage.getGames()).toEqual([]);
    expect(service.status).toBe('error');
  });
  it('clears only the selected team and preserves its owner', async () => {
    cloud.rows.set('t2', {
      revision: 1,
      snapshot: { ...empty(), roster: [makePlayer('b', 'Bears')] },
    });
    await service.initialSync('u1');
    service.saveLocal({ ...empty(), roster: [makePlayer('a', 'Tigers')] });
    await service.syncNow();
    await service.clearCloud();
    expect(cloud.rows.get('t1').snapshot.roster).toEqual([]);
    expect(cloud.rows.get('t2').snapshot.roster).toHaveLength(1);
    expect(getDataOwner()?.teamId).toBe('t1');
  });
  it('does not acknowledge a local edit if storage is full', async () => {
    await service.initialSync('u1');
    const before = Storage.exportDataSet();
    Object.assign(globalThis, {
      localStorage: {
        ...shim,
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    expect(() =>
      service.saveLocal({ ...empty(), roster: [makePlayer('a', 'Lost')] }),
    ).toThrow('Could not save');
    expect(Storage.exportDataSet()).toEqual(before);
  });
});

it('invalidates an old-team download still in flight when a switch commits', async () => {
  await service.initialSync('u1');
  cloud.rows.set('t2', {
    revision: 1,
    snapshot: { ...empty(), roster: [makePlayer('b', 'Bears')] },
  });
  const destination = { pause: deferred(), entered: deferred() };
  cloud.reads.set('t2', destination);
  const switching = service.switchTeam(other);
  await destination.entered.promise;
  const oldRead = { pause: deferred(), entered: deferred() };
  cloud.reads.set('t1', oldRead);
  const stale = service.syncNow();
  await oldRead.entered.promise;
  destination.pause.release();
  await switching;
  oldRead.pause.release();
  await expect(stale).rejects.toThrow('Session changed');
  expect(getDataOwner()?.teamId).toBe('t2');
  expect(Storage.getRoster()[0].name).toBe('Bears');
  expect(service.canEdit).toBe(true);
});
it('surfaces a server conflict between fetch and save without falling back', async () => {
  await service.initialSync('u1');
  service.saveLocal({ ...empty(), roster: [makePlayer('a', 'Local')] });
  cloud.pause = deferred();
  cloud.entered = deferred();
  const sync = service.syncNow();
  await cloud.entered.promise;
  cloud.rows.set('t1', {
    revision: 2,
    snapshot: { ...empty(), roster: [makePlayer('b', 'Other device')] },
  });
  cloud.pause.release();
  await sync;
  expect(service.status).toBe('conflict');
  expect(Storage.getRoster()[0].name).toBe('Local');
  expect(cloud.writes).toBe(1);
});
