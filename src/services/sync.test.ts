import { describe, expect, it } from 'vitest';
import { decideKeySync, type KeyDecision } from './sync';

const row = (updated_at: string) => ({ updated_at });

function decide(overrides: Partial<Parameters<typeof decideKeySync>[0]>): KeyDecision {
  return decideKeySync({
    dirty: false,
    dirtyAt: null,
    lastSeenRemote: null,
    remoteRow: null,
    hasLocalValue: true,
    ...overrides
  });
}

describe('decideKeySync', () => {
  it('seeds an empty account key from local data', () => {
    expect(decide({ remoteRow: null, hasLocalValue: true })).toBe('push');
  });

  it('does nothing for a key that exists nowhere', () => {
    expect(decide({ remoteRow: null, hasLocalValue: false })).toBe('none');
  });

  it('a fresh device adopts the account copy', () => {
    expect(decide({ remoteRow: row('2026-07-01T10:00:00Z'), lastSeenRemote: null })).toBe('apply');
  });

  it('remote unchanged + local clean -> nothing to do', () => {
    const ts = '2026-07-01T10:00:00Z';
    expect(decide({ remoteRow: row(ts), lastSeenRemote: ts })).toBe('none');
  });

  it('remote unchanged + local dirty -> push', () => {
    const ts = '2026-07-01T10:00:00Z';
    expect(decide({ remoteRow: row(ts), lastSeenRemote: ts, dirty: true, dirtyAt: '2026-07-02T09:00:00Z' })).toBe('push');
  });

  it('remote changed + local clean -> apply', () => {
    expect(decide({ remoteRow: row('2026-07-05T10:00:00Z'), lastSeenRemote: '2026-07-01T10:00:00Z' })).toBe('apply');
  });

  it('true conflict: newer side wins per key', () => {
    const conflict = (dirtyAt: string) => decide({
      remoteRow: row('2026-07-05T10:00:00Z'),
      lastSeenRemote: '2026-07-01T10:00:00Z',
      dirty: true,
      dirtyAt
    });
    expect(conflict('2026-07-06T09:00:00Z')).toBe('push');  // local edit is newer
    expect(conflict('2026-07-04T09:00:00Z')).toBe('apply'); // remote edit is newer
  });

  it('H1 regression: each key decides independently, so an unrelated remote change cannot clobber a local one', () => {
    // Device B changed settings offline; meanwhile device A pushed a roster
    // change. Old protocol: roster's newer timestamp forced applyRemote for
    // EVERY key, wiping B's settings. Now:
    const rosterDecision = decide({
      // roster: remote changed, local clean
      remoteRow: row('2026-07-05T10:00:00Z'),
      lastSeenRemote: '2026-07-01T10:00:00Z',
      dirty: false
    });
    const settingsDecision = decide({
      // settings: remote unchanged, local dirty
      remoteRow: row('2026-06-20T10:00:00Z'),
      lastSeenRemote: '2026-06-20T10:00:00Z',
      dirty: true,
      dirtyAt: '2026-07-05T08:00:00Z'
    });
    expect(rosterDecision).toBe('apply');   // take A's roster
    expect(settingsDecision).toBe('push');  // keep B's settings
  });

  it('H2 regression: a remote null tombstone is applied, not skipped', () => {
    // The decision layer treats a null-valued row like any other row; the
    // service then clears the local key when applying a null value.
    expect(decide({
      remoteRow: row('2026-07-05T10:00:00Z'),
      lastSeenRemote: '2026-07-01T10:00:00Z',
      hasLocalValue: true
    })).toBe('apply');
  });
});

import { decideSignInAction, Sync, clearSyncMeta, getDataOwner, type DataOwner } from './sync';

// Minimal localStorage shim for node (service-level tests below)
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }
};

describe('decideSignInAction (account-bound local data)', () => {
  const owner: DataOwner = { userId: 'coach-a', teamId: 't1', teamName: 'Tigers' };

  it('unowned local data (created signed-out) is adopted by the first account', () => {
    expect(decideSignInAction(null, 'coach-a')).toBe('proceed');
  });

  it('the owning account proceeds normally', () => {
    expect(decideSignInAction(owner, 'coach-a')).toBe('proceed');
  });

  it('a DIFFERENT account signing in is a conflict - never auto-uploaded', () => {
    expect(decideSignInAction(owner, 'coach-b')).toBe('conflict');
  });
});

describe('dirty state survives sign-out (unsynced edits are not lost)', () => {
  it('markDirty -> disable() keeps the per-key dirty flags and the owner marker', () => {
    store.clear();
    localStorage.setItem('ybl_dataOwner', JSON.stringify({ userId: 'u1', teamId: 't1', teamName: 'T' }));
    Sync.markDirty('roster');
    Sync.markDirty('games');
    expect(Sync.hasPendingChanges()).toBe(true);

    Sync.disable(); // sign-out

    // Dirty flags and the owner marker survive: the next sign-in to the
    // SAME account pushes the offline edits instead of losing them
    expect(Sync.hasPendingChanges()).toBe(true);
    expect(getDataOwner()).toMatchObject({ userId: 'u1', teamId: 't1' });
    const meta = JSON.parse(localStorage.getItem('ybl_syncMeta') || '{}');
    expect(meta.keys.roster.dirty).toBe(true);
    expect(meta.keys.games.dirty).toBe(true);
  });

  it('clearSyncMeta (clear-all / adoption) wipes both meta and owner', () => {
    store.clear();
    localStorage.setItem('ybl_dataOwner', JSON.stringify({ userId: 'u1', teamId: 't1', teamName: 'T' }));
    Sync.markDirty('roster');
    clearSyncMeta();
    expect(Sync.hasPendingChanges()).toBe(false);
    expect(getDataOwner()).toBeNull();
  });

  it('checkAccountConflict flags a different signing-in user', () => {
    store.clear();
    localStorage.setItem('ybl_dataOwner', JSON.stringify({ userId: 'u1', teamId: 't1', teamName: 'Tigers' }));
    expect(Sync.checkAccountConflict('u1')).toBeNull();
    expect(Sync.checkAccountConflict('u2')).toMatchObject({ userId: 'u1', teamName: 'Tigers' });
  });
});
