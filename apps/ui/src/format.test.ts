import { describe, expect, it } from 'vitest';
import { formatClock, formatDate, formatDuration, formatTimeOfDay } from './format';

const calendar = {
  year: 2026,
  month: 11,
  day: 4,
  hour: 7,
  minute: 5,
  second: 9,
  weekday: 3 as const,
  summerTime: false,
};

describe('format', () => {
  it('formatiert Datum und Uhrzeit deutsch', () => {
    expect(formatDate(calendar, 'Mi')).toBe('Mi 04.11.2026');
    expect(formatClock(calendar)).toBe('07:05:09');
  });

  it('formatiert Tageszeit und Dauer', () => {
    expect(formatTimeOfDay(3 * 86_400_000 + 13 * 3_600_000 + 61_000)).toBe('13:01:01');
    // Im Sommer zeigt die Uhr eine Stunde mehr (MESZ): 1.7.2026, 11:00 MEZ = 12:00 MESZ.
    expect(formatTimeOfDay(20_635 * 86_400_000 + 11 * 3_600_000)).toBe('12:00:00');
    expect(formatDuration(45_000)).toBe('0:45');
    expect(formatDuration(723_400)).toBe('12:03');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
