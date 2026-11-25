/**
 * Spielstände auf Android (ADR-0021). Der Host erwartet eine synchrone Ablage (ADR-0008), der
 * Browser bietet nur asynchrones IndexedDB. Deshalb hält dieser Store alle Spielstände
 * komprimiert im Speicher und schreibt jede Änderung im Hintergrund durch.
 *
 * Gleiche Regeln wie unter Windows: Snapshot und Befehlsprotokoll komprimiert (zlib),
 * höchstens {@link AUTOSAVE_KEEP} automatische Stände, neueste zuerst.
 */
import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';
import { AUTOSAVE_KEEP, type SaveEntry, type SaveStore, type StoredGame } from '@ls112/host';
import type { SaveInfo } from '@ls112/protocol';
import type { LoggedCommand, SimSnapshot } from '@ls112/sim';

/** Ein Spielstand, wie er in IndexedDB liegt. */
export interface SaveRecord {
  readonly info: SaveInfo;
  readonly mode: 'free' | 'tutorial';
  readonly snapshotVersion: number;
  readonly snapshot: Uint8Array;
  readonly commands: Uint8Array;
}

/** Dauerhafte Ablage hinter dem Speicher-Cache (IndexedDB oder im Test ein Fake). */
export interface SavePersistence {
  put(record: SaveRecord): Promise<void>;
  delete(id: number): Promise<void>;
}

export class CachedSaveStore implements SaveStore {
  private readonly records = new Map<number, SaveRecord>();
  private nextId: number;
  /** Laufende Schreibvorgänge – `flush()` wartet darauf (z. B. bevor Android die App anhält). */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly persistence: SavePersistence,
    initial: readonly SaveRecord[] = [],
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const r of initial) this.records.set(r.info.id, r);
    this.nextId = Math.max(0, ...this.records.keys()) + 1;
  }

  list(): SaveInfo[] {
    return [...this.records.values()].map((r) => r.info).sort((a, b) => b.id - a.id);
  }

  write(entry: SaveEntry): SaveInfo {
    const info: SaveInfo = {
      id: this.nextId++,
      name: entry.name,
      kind: entry.kind,
      createdAt: this.now().toISOString(),
      gameTime: entry.snapshot.state.time,
      region: entry.region,
      shiftIndex: entry.shiftIndex,
    };
    const record: SaveRecord = {
      info,
      mode: entry.mode,
      snapshotVersion: entry.snapshot.version,
      snapshot: zlibSync(strToU8(JSON.stringify(entry.snapshot))),
      commands: zlibSync(strToU8(JSON.stringify(entry.commands))),
    };
    this.records.set(info.id, record);
    this.track(this.persistence.put(record));
    if (entry.kind === 'auto') {
      const autos = this.list().filter((s) => s.kind === 'auto');
      for (const old of autos.slice(AUTOSAVE_KEEP)) {
        this.records.delete(old.id);
        this.track(this.persistence.delete(old.id));
      }
    }
    return info;
  }

  read(id: number): StoredGame | undefined {
    const r = this.records.get(id);
    if (!r) return undefined;
    return {
      info: r.info,
      snapshot: JSON.parse(strFromU8(unzlibSync(r.snapshot))) as SimSnapshot,
      commands: JSON.parse(strFromU8(unzlibSync(r.commands))) as LoggedCommand[],
      mode: r.mode,
    };
  }

  latestAuto(): number | undefined {
    return this.list().find((s) => s.kind === 'auto')?.id;
  }

  /** Wartet, bis alle Änderungen dauerhaft gespeichert sind. */
  flush(): Promise<void> {
    return this.pending.then(() => undefined);
  }

  close(): void {
    // Nichts zu schließen – IndexedDB schließt mit dem Worker.
  }

  private track(write: Promise<void>): void {
    const guarded = write.catch(this.onError);
    this.pending = Promise.all([this.pending, guarded]);
  }
}
