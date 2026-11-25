/**
 * Android-Gegenstück zum Electron-Preload (ADR-0021): dieselbe Brücke `window.ls112`, damit die
 * Oberfläche unverändert bleibt. Was es auf dem Telefon nicht gibt (Mehrfenster, Layouts,
 * Mod-Ordner im Explorer), meldet `false` – die Oberfläche blendet es auf Android aus.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { strToU8, zipSync } from 'fflate';
import { appendLog, readLog, saveModFile } from '@ls112/web-host';

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
      let ok: boolean;
      try {
        ok = await saveModFile(await deps.db(), modId, fileName, data);
      } catch (error) {
        appendLog({
          level: 'error',
          source: 'ui',
          message: 'Mod-Datei nicht gespeichert',
          context: { err: String(error) },
        });
        return false;
      }
      if (!ok) return false;
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
