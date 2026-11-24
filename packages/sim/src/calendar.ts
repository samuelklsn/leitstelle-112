/**
 * Feiertage und Ruhetage (ADR-0016). Reine Ganzzahlrechnung ohne `Date`, damit sie
 * deterministisch ist (ADR-0004).
 */
import type { Holiday } from '@ls112/content';
import { MS_PER_DAY, daysFromCivil, toCalendar, type SimTime } from './time';

/**
 * Ostersonntag als Tag seit 1970-01-01 (gregorianischer Kalender, Algorithmus nach
 * Meeus/Jones/Butcher – nur Ganzzahlarithmetik).
 */
export function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return daysFromCivil(year, month, day);
}

/** Name des Feiertags am Tag dieser Spielzeit (Uhrzeit mit Sommerzeit) oder undefined. */
export function holidayName(holidays: readonly Holiday[], time: SimTime): string | undefined {
  if (holidays.length === 0) return undefined;
  const cal = toCalendar(time);
  const today = daysFromCivil(cal.year, cal.month, cal.day);
  let easter: number | undefined;
  for (const h of holidays) {
    if (h.date) {
      if (h.date.month === cal.month && h.date.day === cal.day) return h.name;
    } else if (h.easterOffset !== undefined) {
      easter ??= easterSunday(cal.year);
      if (easter + h.easterOffset === today) return h.name;
    }
  }
  return undefined;
}

/** Wochenende oder Feiertag: Verkehr, Aufkommen und Vorhaltung wie an einem Sonntag. */
export function isRestDay(holidays: readonly Holiday[], time: SimTime): boolean {
  return toCalendar(time).weekday >= 6 || holidayName(holidays, time) !== undefined;
}

/** Wochentag 1–7 für Tagesmuster; Feiertage zählen als Sonntag. */
export function patternWeekday(holidays: readonly Holiday[], time: SimTime): number {
  return holidayName(holidays, time) !== undefined ? 7 : toCalendar(time).weekday;
}

/** Tage zwischen zwei Spielzeiten (für Tests und Anzeigen). */
export function dayIndex(time: SimTime): number {
  return Math.floor(time / MS_PER_DAY);
}
