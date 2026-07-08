import { describe, expect, it } from 'vitest';
import { decideInitialSync } from './sync';

const row = (updated_at: string) => ({ updated_at });

describe('decideInitialSync', () => {
  it('first device seeds an empty account', () => {
    expect(decideInitialSync({
      hasLocalData: true,
      remoteRows: [],
      lastSyncAt: null
    })).toBe('pushLocal');
  });

  it('a fresh device adopts the account data', () => {
    expect(decideInitialSync({
      hasLocalData: false,
      remoteRows: [row('2026-07-01T10:00:00Z')],
      lastSyncAt: null
    })).toBe('applyRemote');
  });

  it('a device with local data that never synced adopts the account (account wins)', () => {
    expect(decideInitialSync({
      hasLocalData: true,
      remoteRows: [row('2026-07-01T10:00:00Z')],
      lastSyncAt: null
    })).toBe('applyRemote');
  });

  it('remote changed since our last sync -> apply remote', () => {
    expect(decideInitialSync({
      hasLocalData: true,
      remoteRows: [row('2026-07-01T10:00:00Z'), row('2026-07-05T18:00:00Z')],
      lastSyncAt: '2026-07-03T09:00:00Z'
    })).toBe('applyRemote');
  });

  it('nothing changed remotely since our last sync -> push local', () => {
    expect(decideInitialSync({
      hasLocalData: true,
      remoteRows: [row('2026-07-01T10:00:00Z')],
      lastSyncAt: '2026-07-03T09:00:00Z'
    })).toBe('pushLocal');
  });

  it('empty account and empty device -> harmless push', () => {
    expect(decideInitialSync({
      hasLocalData: false,
      remoteRows: [],
      lastSyncAt: null
    })).toBe('pushLocal');
  });
});
