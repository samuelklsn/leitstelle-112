/**
 * Rollierendes App-Log im localStorage (ADR-0012 sinngemäß): Grundlage für das Diagnosepaket auf
 * Android und Mac. Nichts davon verlässt das Gerät von selbst.
 */
import type { LogLevel } from './worker-protocol';

const LOG_KEY = 'ls112.log';
/** Wie viele Log-Zeilen das Gerät behält (rollierend) – reicht für ein Diagnosepaket. */
export const LOG_KEEP = 400;

export interface LogLine {
  readonly at: string;
  readonly level: LogLevel;
  readonly source: 'ui' | 'sim';
  readonly message: string;
  readonly context: object;
}

export function readLog(): LogLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as LogLine[]) : [];
  } catch {
    return [];
  }
}

export function appendLog(line: Omit<LogLine, 'at'>): void {
  const entry: LogLine = { at: new Date().toISOString(), ...line };
  const target =
    line.level === 'error' ? console.error : line.level === 'warn' ? console.warn : console.info;
  target(`[${line.source}] ${line.message}`, line.context);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify([...readLog(), entry].slice(-LOG_KEEP)));
  } catch {
    // Speicher voll – Log ist verzichtbar.
  }
}
