/**
 * Android-Gegenstück zum Electron-Preload (ADR-0021): dieselbe Brücke `window.ls112`, damit die
 * Oberfläche unverändert bleibt. Was es auf dem Telefon nicht gibt (Mehrfenster, Layouts,
 * Mod-Ordner im Explorer), meldet `false` – die Oberfläche blendet es auf Android aus.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { strToU8, zipSync } from 'fflate';
import { hasModFile, writeModFile } from './idb';
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

function readLog(): LogLine[] {
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

const MOD_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;

export interface BridgeDeps {
  readonly version: string;
  readonly db: () => Promise<IDBDatabase>;
  readonly reloadContent: () => void;
  readonly restarts: () => number;
}

export function createBridge(deps: BridgeDeps): Ls112Bridge {
  return {
    platform: 'android',
    log: (level, message, context) => {
      appendLog({ level, source: 'ui', message: message.slice(0, 2000), context: context ?? {} });
    },
    appInfo: () =>
      Promise.resolve({
        version: deps.version,
        electron: `Android WebView (${Capacitor.getPlatform()})`,
        simHostRestarts: deps.restarts(),
      }),
    e2eCrashSimHost: () => undefined,
    openWindow: () => Promise.resolve(false),
    focusMainWindow: () => undefined,
    listLayouts: () => Promise.resolve({ last: null, layouts: [], displays: 1 }),
    applyLayout: () => Promise.resolve(false),
    saveLayout: () => Promise.resolve(false),
    deleteLayout: () => Promise.resolve(false),
    createDiagnostics: () => createDiagnostics(deps),
    openModsFolder: () => Promise.resolve(false),
    saveModFile: async (modId, fileName, data) => {
      if (
        !MOD_ID.test(modId) ||
        !FILE_NAME.test(fileName) ||
        typeof data !== 'object' ||
        data === null
      )
        return false;
      const text = JSON.stringify(data, null, 2);
      if (text.length > 1_000_000) return false;
      try {
        const db = await deps.db();
        // Wie unter Windows: Steckbrief anlegen, falls der Mod neu ist (ADR-0019).
        if (!(await hasModFile(db, modId, 'mod'))) {
          const manifest = {
            mod: { id: modId, name: 'Eigene Inhalte', version: '1.0.0', author: 'Spieler/in' },
          };
          await writeModFile(db, {
            modId,
            fileName: 'mod',
            text: JSON.stringify(manifest, null, 2),
          });
        }
        await writeModFile(db, { modId, fileName, text });
      } catch (error) {
        appendLog({
          level: 'error',
          source: 'ui',
          message: 'Mod-Datei nicht gespeichert',
          context: { err: String(error) },
        });
        return false;
      }
      appendLog({
        level: 'info',
        source: 'ui',
        message: 'Mod-Datei gespeichert',
        context: { mod: modId, file: fileName },
      });
      deps.reloadContent();
      return true;
    },
  };
}

/**
 * Log und Geräteinfo als ZIP (#34) und über das Android-Teilen-Menü weitergeben. Nichts wird
 * von selbst versendet – der Spieler wählt das Ziel (Regel 6).
 */
async function createDiagnostics(deps: BridgeDeps): Promise<string | null> {
  const system = {
    version: deps.version,
    platform: Capacitor.getPlatform(),
    userAgent: navigator.userAgent,
    screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio },
    simHostRestarts: deps.restarts(),
    createdAt: new Date().toISOString(),
  };
  const zip = zipSync({
    'logs/app.json': strToU8(JSON.stringify(readLog(), null, 2)),
    'system.json': strToU8(JSON.stringify(system, null, 2)),
  });
  const fileName = `Leitstelle112-Diagnose-${system.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.zip`;
  if (!Capacitor.isNativePlatform()) {
    // Im Browser (Entwicklung): als Download anbieten.
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return fileName;
  }
  const written = await Filesystem.writeFile({
    path: fileName,
    data: toBase64(zip),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: 'Leitstelle 112 – Diagnosepaket', files: [written.uri] });
  } catch {
    // Teilen abgebrochen – die Datei liegt trotzdem im App-Cache.
  }
  return fileName;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
