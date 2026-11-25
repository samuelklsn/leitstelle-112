/**
 * Schnittstelle der Spielstand-Ablage (ADR-0008). Die Plattformen liefern die Umsetzung:
 * Windows SQLite (`apps/desktop`), Android IndexedDB (`apps/android`, ADR-0021).
 * Bewusst synchron, damit der Host Laden und Speichern ohne Zwischenzustände abwickelt.
 */
import type { SaveInfo } from '@ls112/protocol';
import type { LoggedCommand, SimSnapshot } from '@ls112/sim';

export interface StoredGame {
  readonly info: SaveInfo;
  readonly snapshot: SimSnapshot;
  readonly commands: readonly LoggedCommand[];
  readonly mode: 'free' | 'tutorial';
}

export interface SaveEntry {
  readonly kind: 'auto' | 'manual';
  readonly name: string;
  readonly snapshot: SimSnapshot;
  readonly commands: readonly LoggedCommand[];
  readonly region: string;
  readonly shiftIndex: number;
  readonly mode: 'free' | 'tutorial';
}

export interface SaveStore {
  list(): SaveInfo[];
  write(entry: SaveEntry): SaveInfo;
  read(id: number): StoredGame | undefined;
  latestAuto(): number | undefined;
  close(): void;
}

/** Wie viele automatische Spielstände aufbewahrt werden (rollierend). */
export const AUTOSAVE_KEEP = 3;
