/**
 * Spielstände in SQLite (ADR-0008, Nachtrag: `node:sqlite` statt better-sqlite3 – in Electron
 * eingebaut, kein natives Modul nötig). Snapshots und Befehlsprotokoll werden komprimiert.
 */
import { DatabaseSync } from 'node:sqlite';
import { deflateSync, inflateSync } from 'node:zlib';
import type { SaveInfo } from '@ls112/protocol';
import type { LoggedCommand, SimSnapshot } from '@ls112/sim';

export interface StoredGame {
  readonly info: SaveInfo;
  readonly snapshot: SimSnapshot;
  readonly commands: readonly LoggedCommand[];
  readonly mode: 'free' | 'tutorial';
}

export interface SaveStore {
  list(): SaveInfo[];
  write(entry: {
    kind: 'auto' | 'manual';
    name: string;
    snapshot: SimSnapshot;
    commands: readonly LoggedCommand[];
    region: string;
    shiftIndex: number;
    mode: 'free' | 'tutorial';
  }): SaveInfo;
  read(id: number): StoredGame | undefined;
  latestAuto(): number | undefined;
  close(): void;
}

/** Wie viele automatische Spielstände aufbewahrt werden (rollierend). */
export const AUTOSAVE_KEEP = 3;

const SCHEMA_VERSION = 1;

export class SqliteSaveStore implements SaveStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as
      { value: string } | undefined;
    const version = row ? Number(row.value) : 0;
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS saves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('auto', 'manual')),
          created_at TEXT NOT NULL,
          game_time INTEGER NOT NULL,
          region TEXT NOT NULL,
          shift_index INTEGER NOT NULL,
          mode TEXT NOT NULL,
          snapshot_version INTEGER NOT NULL,
          snapshot BLOB NOT NULL,
          commands BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS saves_kind ON saves(kind, id);
      `);
    }
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)")
      .run(String(SCHEMA_VERSION));
  }

  list(): SaveInfo[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, kind, created_at, game_time, region, shift_index FROM saves ORDER BY id DESC',
      )
      .all() as {
      id: number;
      name: string;
      kind: 'auto' | 'manual';
      created_at: string;
      game_time: number;
      region: string;
      shift_index: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      createdAt: r.created_at,
      gameTime: r.game_time,
      region: r.region,
      shiftIndex: r.shift_index,
    }));
  }

  write(entry: Parameters<SaveStore['write']>[0]): SaveInfo {
    const createdAt = new Date().toISOString();
    const snapshot = deflateSync(JSON.stringify(entry.snapshot));
    const commands = deflateSync(JSON.stringify(entry.commands));
    this.db.exec('BEGIN');
    try {
      const result = this.db
        .prepare(
          `INSERT INTO saves (name, kind, created_at, game_time, region, shift_index, mode, snapshot_version, snapshot, commands)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.name,
          entry.kind,
          createdAt,
          entry.snapshot.state.time,
          entry.region,
          entry.shiftIndex,
          entry.mode,
          entry.snapshot.version,
          snapshot,
          commands,
        );
      if (entry.kind === 'auto') {
        this.db
          .prepare(
            "DELETE FROM saves WHERE kind = 'auto' AND id NOT IN (SELECT id FROM saves WHERE kind = 'auto' ORDER BY id DESC LIMIT ?)",
          )
          .run(AUTOSAVE_KEEP);
      }
      this.db.exec('COMMIT');
      return {
        id: Number(result.lastInsertRowid),
        name: entry.name,
        kind: entry.kind,
        createdAt,
        gameTime: entry.snapshot.state.time,
        region: entry.region,
        shiftIndex: entry.shiftIndex,
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  read(id: number): StoredGame | undefined {
    const row = this.db
      .prepare(
        'SELECT id, name, kind, created_at, game_time, region, shift_index, mode, snapshot, commands FROM saves WHERE id = ?',
      )
      .get(id) as
      | {
          id: number;
          name: string;
          kind: 'auto' | 'manual';
          created_at: string;
          game_time: number;
          region: string;
          shift_index: number;
          mode: 'free' | 'tutorial';
          snapshot: Uint8Array;
          commands: Uint8Array;
        }
      | undefined;
    if (!row) return undefined;
    return {
      info: {
        id: row.id,
        name: row.name,
        kind: row.kind,
        createdAt: row.created_at,
        gameTime: row.game_time,
        region: row.region,
        shiftIndex: row.shift_index,
      },
      snapshot: JSON.parse(inflateSync(row.snapshot).toString('utf8')) as SimSnapshot,
      commands: JSON.parse(inflateSync(row.commands).toString('utf8')) as LoggedCommand[],
      mode: row.mode,
    };
  }

  latestAuto(): number | undefined {
    const row = this.db
      .prepare("SELECT id FROM saves WHERE kind = 'auto' ORDER BY id DESC LIMIT 1")
      .get() as { id: number } | undefined;
    return row ? row.id : undefined;
  }

  close(): void {
    this.db.close();
  }
}
