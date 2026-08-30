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
