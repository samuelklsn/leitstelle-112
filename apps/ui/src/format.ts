import type { GameView } from '@ls112/protocol';

type Calendar = GameView['calendar'];

const pad = (n: number) => n.toString().padStart(2, '0');

/** „Di 24.11.2026" – Wochentagskürzel kommt aus i18n. */
export function formatDate(calendar: Calendar, weekdayShort: string): string {
  return `${weekdayShort} ${pad(calendar.day)}.${pad(calendar.month)}.${calendar.year.toString()}`;
}

/** „07:45:30" */
export function formatClock(calendar: Calendar): string {
  return `${pad(calendar.hour)}:${pad(calendar.minute)}:${pad(calendar.second)}`;
}

/** Spielzeit (ms) als „HH:MM:SS" ab Tagesbeginn – für Protokollzeilen. */
export function formatTimeOfDay(timeMs: number): string {
  const msOfDay = ((timeMs % 86_400_000) + 86_400_000) % 86_400_000;
  const s = Math.floor(msOfDay / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Dauer in ms als „0:45" bzw. „12:03" (Minuten:Sekunden). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60).toString()}:${pad(total % 60)}`;
}
