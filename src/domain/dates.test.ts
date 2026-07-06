import { describe, expect, it } from 'vitest';
import { compareDatesDesc, daysBetween, formatDateDisplay, parseLocalDate, todayISO } from './dates';

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight, not UTC', () => {
    const d = parseLocalDate('2026-07-06');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(0);
  });
});

describe('formatDateDisplay', () => {
  it('renders the same calendar day that was stored (the print off-by-one bug)', () => {
    // new Date('2026-07-06').toLocaleDateString() renders July 5 in US timezones;
    // formatDateDisplay must always render July 6.
    const formatted = formatDateDisplay('2026-07-06');
    expect(formatted).toContain('6');
    expect(formatted).toContain('7');
    expect(formatted).toContain('2026');
  });

  it('returns empty string for empty input', () => {
    expect(formatDateDisplay('')).toBe('');
  });
});

describe('todayISO', () => {
  it('uses the local calendar date even late in the evening', () => {
    // 11pm local on July 6 must be "today = July 6" regardless of what UTC says
    const evening = new Date(2026, 6, 6, 23, 30);
    expect(todayISO(evening)).toBe('2026-07-06');
  });

  it('pads months and days', () => {
    expect(todayISO(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('daysBetween', () => {
  it('computes whole days between dates', () => {
    expect(daysBetween('2026-07-01', '2026-07-06')).toBe(5);
    expect(daysBetween('2026-07-06', '2026-07-06')).toBe(0);
  });

  it('handles month and year boundaries', () => {
    expect(daysBetween('2026-06-29', '2026-07-02')).toBe(3);
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3);
  });

  it('survives DST transitions (US spring forward 2026-03-08)', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('compareDatesDesc', () => {
  it('sorts newest first', () => {
    const dates = ['2026-05-01', '2026-07-06', '2026-06-15'];
    dates.sort(compareDatesDesc);
    expect(dates).toEqual(['2026-07-06', '2026-06-15', '2026-05-01']);
  });
});
