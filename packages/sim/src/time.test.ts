import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  civilFromDays,
  daysFromCivil,
  simTimeFrom,
  summerTimeOffset,
  toCalendar,
} from './time';

describe('Kalender', () => {
  it('1970-01-01 ist Tag 0 und ein Donnerstag', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(toCalendar(0).weekday).toBe(4);
  });

  it('kennt bekannte Daten', () => {
    // 24.11.2026 ist ein Dienstag.
    const t = simTimeFrom(2026, 11, 24, 7, 45, 30);
    expect(toCalendar(t)).toEqual({
      year: 2026,
      month: 11,
      day: 24,
      hour: 7,
      minute: 45,
      second: 30,
      weekday: 2,
      summerTime: false,
    });
    // Schaltjahr
    expect(civilFromDays(daysFromCivil(2028, 2, 29))).toEqual({ year: 2028, month: 2, day: 29 });
    expect(daysFromCivil(2028, 3, 1) - daysFromCivil(2028, 2, 28)).toBe(2);
    expect(daysFromCivil(2100, 3, 1) - daysFromCivil(2100, 2, 28)).toBe(1);
  });

  it('daysFromCivil und civilFromDays sind invers', () => {
    fc.assert(
      fc.property(fc.integer({ min: -200_000, max: 200_000 }), (days) => {
        const { year, month, day } = civilFromDays(days);
        expect(daysFromCivil(year, month, day)).toBe(days);
      }),
    );
  });

  it('Wochentag rückt jeden Tag um eins weiter', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (days) => {
        const a = toCalendar(days * MS_PER_DAY).weekday;
        const b = toCalendar((days + 1) * MS_PER_DAY).weekday;
        expect(b).toBe((a % 7) + 1);
      }),
    );
  });
});

describe('Sommerzeit', () => {
  it('beginnt am letzten Sonntag im März: 2 Uhr wird 3 Uhr', () => {
    // 29.03.2026 ist der letzte Sonntag im März.
    const before = simTimeFrom(2026, 3, 29, 1, 59, 0);
    expect(toCalendar(before)).toMatchObject({ hour: 1, minute: 59, summerTime: false });
    const after = toCalendar(before + MS_PER_MINUTE);
    expect(after).toMatchObject({ day: 29, hour: 3, minute: 0, summerTime: true });
    expect(toCalendar(simTimeFrom(2026, 7, 1, 12)).hour).toBe(12);
  });

  it('endet am letzten Sonntag im Oktober: die Stunde von 2 bis 3 Uhr läuft doppelt', () => {
    // 25.10.2026 ist der letzte Sonntag im Oktober.
    const first = simTimeFrom(2026, 10, 25, 2, 30);
    expect(toCalendar(first)).toMatchObject({ hour: 2, minute: 30, summerTime: true });
    expect(toCalendar(first + MS_PER_HOUR)).toMatchObject({
      hour: 2,
      minute: 30,
      summerTime: false,
    });
    // Der Tag der Umstellung hat 25 Stunden.
    expect(simTimeFrom(2026, 10, 26) - simTimeFrom(2026, 10, 25)).toBe(25 * MS_PER_HOUR);
    expect(simTimeFrom(2026, 3, 30) - simTimeFrom(2026, 3, 29)).toBe(23 * MS_PER_HOUR);
  });

  it('Uhrzeit und Spielzeit sind außerhalb der Umstellung invers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 4, max: 23 }),
        (year, month, day, hour) => {
          const c = toCalendar(simTimeFrom(year, month, day, hour, 15));
          expect([c.year, c.month, c.day, c.hour, c.minute]).toEqual([year, month, day, hour, 15]);
        },
      ),
    );
    expect(summerTimeOffset(simTimeFrom(2026, 1, 10))).toBe(0);
    expect(summerTimeOffset(simTimeFrom(2026, 8, 10))).toBe(MS_PER_HOUR);
  });
});
