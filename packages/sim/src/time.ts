/**
 * Spielzeit und Kalender.
 *
 * Spielzeit ist eine ganze Zahl in Millisekunden seit 1970-01-01 00:00 *Normalzeit des
 * Leitstellenbereichs* (MEZ, ohne Sprünge). So läuft die Simulation gleichmäßig weiter. Erst die
 * Umrechnung in die Uhrzeit ({@link toCalendar}) berücksichtigt die Sommerzeit (MESZ): Ende März
 * springt die Uhr von 2 auf 3 Uhr, Ende Oktober läuft die Stunde von 2 bis 3 Uhr doppelt
 * (docs/domain/zeit.md). Die Umrechnung in Kalenderfelder nutzt nur Ganzzahlarithmetik
 * (Algorithmus nach Howard Hinnant, "chrono-compatible low-level date algorithms"),
 * damit sie deterministisch ist und ohne `Date` auskommt.
 */

/** Spielzeit in ganzzahligen Millisekunden. */
export type SimTime = number;

/** Länge eines Simulationsticks: 1 Sekunde Spielzeit (ADR-0004). */
export const TICK_MS = 1000;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Wochentag nach ISO 8601: 1 = Montag … 7 = Sonntag. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface CalendarTime {
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  /** 1–31 */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: IsoWeekday;
  /** Sommerzeit (MESZ) aktiv. */
  readonly summerTime: boolean;
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Tage seit 1970-01-01 für ein Datum des proleptischen gregorianischen Kalenders. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = floorDiv(y, 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = floorDiv(153 * mp + 2, 5) + day - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Umkehrung von {@link daysFromCivil}. */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(
    doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096),
    365,
  );
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const day = doy - floorDiv(153 * mp + 2, 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

/** Wochentag (ISO) eines Tages seit 1970-01-01. */
function weekdayOf(days: number): number {
  // 1970-01-01 war ein Donnerstag (ISO 4).
  return ((((days + 3) % 7) + 7) % 7) + 1;
}

/** Tag (seit 1970) des letzten Sonntags eines Monats mit 31 Tagen. */
function lastSunday(year: number, month: number): number {
  const last = daysFromCivil(year, month, 31);
  return last - (weekdayOf(last) % 7);
}

/**
 * Versatz der Sommerzeit zu einer Spielzeit (Normalzeit): Sie beginnt am letzten Sonntag im März
 * um 2:00 MEZ und endet am letzten Sonntag im Oktober um 3:00 MESZ (= 2:00 MEZ).
 */
export function summerTimeOffset(time: SimTime): number {
  const { year } = civilFromDays(floorDiv(time, MS_PER_DAY));
  const start = lastSunday(year, 3) * MS_PER_DAY + 2 * MS_PER_HOUR;
  const end = lastSunday(year, 10) * MS_PER_DAY + 2 * MS_PER_HOUR;
  return time >= start && time < end ? MS_PER_HOUR : 0;
}

/**
 * Erzeugt eine Spielzeit aus der Uhrzeit (Ortszeit mit Sommerzeit). In der doppelten Stunde im
 * Oktober gilt das erste Auftreten; eine Uhrzeit aus der übersprungenen Stunde im März liegt
 * danach.
 */
export function simTimeFrom(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): SimTime {
  const wall =
    daysFromCivil(year, month, day) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND;
  return summerTimeOffset(wall - MS_PER_HOUR) > 0 ? wall - MS_PER_HOUR : wall;
}

export function toCalendar(time: SimTime): CalendarTime {
  const offset = summerTimeOffset(time);
  const wall = time + offset;
  const days = floorDiv(wall, MS_PER_DAY);
  const msOfDay = wall - days * MS_PER_DAY;
  const { year, month, day } = civilFromDays(days);
  const weekday = weekdayOf(days);
  return {
    year,
    month,
    day,
    hour: floorDiv(msOfDay, MS_PER_HOUR),
    minute: floorDiv(msOfDay % MS_PER_HOUR, MS_PER_MINUTE),
    second: floorDiv(msOfDay % MS_PER_MINUTE, MS_PER_SECOND),
    weekday: weekday as IsoWeekday,
    summerTime: offset > 0,
  };
}
