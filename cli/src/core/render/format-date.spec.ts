import { formatLocalDateTime } from './format-date';

describe('formatLocalDateTime', () => {
  it('formats an ISO timestamp as YYYY-MM-DD HH:MM in local time', () => {
    const iso = new Date(2026, 8, 11, 11, 48).toISOString();
    expect(formatLocalDateTime(iso)).toBe('2026-09-11 11:48');
  });

  it('pads single-digit month/day/hour/minute', () => {
    const iso = new Date(2026, 0, 5, 9, 5).toISOString();
    expect(formatLocalDateTime(iso)).toBe('2026-01-05 09:05');
  });

  it('falls back to the raw string for something Date cannot parse', () => {
    expect(formatLocalDateTime('not-a-date')).toBe('not-a-date');
  });
});
