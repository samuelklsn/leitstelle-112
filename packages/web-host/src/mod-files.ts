/**
 * Editor-Ergebnis als Mod-Datei in IndexedDB ablegen (ADR-0019, ADR-0021) – Gegenstück zum
 * Mod-Ordner unter Windows. Gleiche Prüfungen wie im Electron-Main.
 */
import { hasModFile, writeModFile } from './idb';

const MOD_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;

export async function saveModFile(
  db: IDBDatabase,
  modId: string,
  fileName: string,
  data: unknown,
): Promise<boolean> {
  if (!MOD_ID.test(modId) || !FILE_NAME.test(fileName) || typeof data !== 'object' || data === null)
    return false;
  const text = JSON.stringify(data, null, 2);
  if (text.length > 1_000_000) return false;
  // Wie unter Windows: Steckbrief anlegen, falls der Mod neu ist.
  if (!(await hasModFile(db, modId, 'mod'))) {
    const manifest = {
      mod: { id: modId, name: 'Eigene Inhalte', version: '1.0.0', author: 'Spieler/in' },
    };
    await writeModFile(db, { modId, fileName: 'mod', text: JSON.stringify(manifest, null, 2) });
  }
  await writeModFile(db, { modId, fileName, text });
  return true;
}
