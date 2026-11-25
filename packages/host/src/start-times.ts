/**
 * Zeitabhängige Startwerte eines Spiels aus der Systemzeit. Gehört zum Host, nicht zum Kern:
 * Der Kern bekommt nur fertige Spielzeiten und Seeds (ADR-0004). Windows und Android teilen sich
 * diese Regeln, damit die Tages-Herausforderung auf beiden Geräten denselben Seed hat.
 */
import type { ContentBundle } from '@ls112/content';
import type { StartPreset } from '@ls112/protocol';
import { hashString32, simTimeFrom } from '@ls112/sim';

/**
 * Spielbeginn (Ortszeit): heutiger Schichtbeginn oder der nächste passende Tag einer Jahreszeit.
 * Die Silvesternacht beginnt mit dem Nachtdienst um 19 Uhr.
 */
export function shiftStart(
  content: ContentBundle,
  preset: StartPreset = 'today',
  now: Date = new Date(),
): number {
  const year = now.getFullYear();
  const hour = content.settings.shift.startHour;
  const month = now.getMonth() + 1;
  switch (preset) {
    case 'winter':
      return simTimeFrom(month === 1 && now.getDate() <= 20 ? year : year + 1, 1, 20, hour);
    case 'summer':
      return simTimeFrom(month <= 7 ? year : year + 1, 7, 18, hour);
    case 'newYear':
      return simTimeFrom(year, 12, 31, 19);
    case 'today':
    case 'drill':
    case 'daily':
      return simTimeFrom(year, month, now.getDate(), hour);
  }
}

/** Tages-Herausforderung: Seed aus dem heutigen Datum – auf jedem Gerät gleich, offline. */
export function dailySeed(now: Date = new Date()): { seed: number; date: string } {
  const date = `${now.getFullYear().toString()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  return { seed: hashString32(`ls112-tag-${date}`), date };
}

/** Startzeit eines Trainingsszenarios: nächster passender Monat ab heute. */
export function scenarioStart(hour: number, month?: number, now: Date = new Date()): number {
  const m = month ?? now.getMonth() + 1;
  // Das Datum selbst ist für Szenarien nebensächlich.
  const year = m < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
  return simTimeFrom(year, m, month === undefined ? now.getDate() : 15, hour);
}
