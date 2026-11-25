/**
 * Kleine IndexedDB-Hülle für die Android-App (ADR-0021): Spielstände und eigene Mods.
 * Läuft im Fenster und im Sim-Worker. Ohne Bibliothek – es sind nur wenige Zugriffe.
 */
import type { SavePersistence, SaveRecord } from './cached-save-store';

const DB_NAME = 'leitstelle112';
const DB_VERSION = 1;
const SAVES = 'saves';
const MODS = 'mods';

/** Eine Mod-Datei, wie sie der Editor speichert (Pfad `<mod>/<datei>.json`). */
export interface ModFileRecord {
  readonly modId: string;
  readonly fileName: string;
  readonly text: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB-Fehler'));
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'));
    };
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES, { keyPath: 'info.id' });
    if (!db.objectStoreNames.contains(MODS))
      db.createObjectStore(MODS, { keyPath: ['modId', 'fileName'] });
  };
  return request(req);
}

export async function readAllSaves(db: IDBDatabase): Promise<SaveRecord[]> {
  return request(db.transaction(SAVES).objectStore(SAVES).getAll() as IDBRequest<SaveRecord[]>);
}

export function savePersistence(db: IDBDatabase): SavePersistence {
  return {
    put: async (record) => {
      const tx = db.transaction(SAVES, 'readwrite');
      tx.objectStore(SAVES).put(record);
      await done(tx);
    },
    delete: async (id) => {
      const tx = db.transaction(SAVES, 'readwrite');
      tx.objectStore(SAVES).delete(id);
      await done(tx);
    },
  };
}

export async function readAllModFiles(db: IDBDatabase): Promise<ModFileRecord[]> {
  return request(db.transaction(MODS).objectStore(MODS).getAll() as IDBRequest<ModFileRecord[]>);
}

export async function writeModFile(db: IDBDatabase, file: ModFileRecord): Promise<void> {
  const tx = db.transaction(MODS, 'readwrite');
  tx.objectStore(MODS).put(file);
  await done(tx);
}

export async function hasModFile(
  db: IDBDatabase,
  modId: string,
  fileName: string,
): Promise<boolean> {
  const key = await request(db.transaction(MODS).objectStore(MODS).getKey([modId, fileName]));
  return key !== undefined;
}
