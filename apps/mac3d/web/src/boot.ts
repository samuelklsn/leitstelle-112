/**
 * Start des Web-Teils der 3D-Mac-App (ADR-0022): Sim-Worker und Leitstellen-Oberfläche wie auf
 * Android, dazu der Szenen-Feed für RealityKit und Befehle aus der 3D-Ansicht (Fahrzeug oder
 * Einsatz angeklickt).
 */
import { strToU8, zipSync } from 'fflate';
import { appendLog, createSimClient, openDatabase, readLog, saveModFile } from '@ls112/web-host';
import { hasNative, postNative } from './native';
import { createStateMapper, toSceneWorld } from './scene-feed';

declare const __APP_VERSION__: string;

/** Wie oft die 3D-Ansicht die Lage bekommt – wie der Host an die Fenster (ADR-0005). */
const STATE_INTERVAL_MS = 100;

let dbPromise: Promise<IDBDatabase> | undefined;
const db = () => (dbPromise ??= openDatabase());

const sim = createSimClient({
  log: (level, message, context) => {
    appendLog({ level, source: 'sim', message, context });
    if (level !== 'info') postNative({ type: 'log', level, message, context });
  },
});

const bridge: Ls112Bridge = {
  platform: 'mac',
  log: (level, message, context) => {
    appendLog({ level, source: 'ui', message: message.slice(0, 2000), context: context ?? {} });
  },
  appInfo: () =>
    Promise.resolve({
      version: __APP_VERSION__,
      electron: 'macOS WKWebView',
      simHostRestarts: sim.restarts(),
    }),
  e2eCrashSimHost: () => undefined,
  openWindow: () => Promise.resolve(false),
  focusMainWindow: () => undefined,
  listLayouts: () => Promise.resolve({ last: null, layouts: [], displays: 1 }),
  applyLayout: () => Promise.resolve(false),
  saveLayout: () => Promise.resolve(false),
  deleteLayout: () => Promise.resolve(false),
  createDiagnostics: () => {
    const createdAt = new Date().toISOString();
    const zip = zipSync({
      'logs/app.json': strToU8(JSON.stringify(readLog(), null, 2)),
      'system.json': strToU8(
        JSON.stringify(
          {
            version: __APP_VERSION__,
            userAgent: navigator.userAgent,
            restarts: sim.restarts(),
            createdAt,
          },
          null,
          2,
        ),
      ),
    });
    const fileName = `Leitstelle112-3D-Diagnose-${createdAt.slice(0, 19).replace(/[:T]/g, '-')}.zip`;
    let binary = '';
    for (const b of zip) binary += String.fromCharCode(b);
    // Die Swift-Hülle fragt mit einem Sichern-Dialog nach dem Ziel.
    postNative({ type: 'diagnostics', fileName, base64: btoa(binary) });
    return Promise.resolve(fileName);
  },
  openModsFolder: () => Promise.resolve(false),
  saveModFile: async (modId, fileName, data) => {
    try {
      const ok = await saveModFile(await db(), modId, fileName, data);
      if (ok) sim.reloadContent();
      return ok;
    } catch (error) {
      appendLog({
        level: 'error',
        source: 'ui',
        message: 'Mod-Datei nicht gespeichert',
        context: { err: String(error) },
      });
      return false;
    }
  },
};
Object.defineProperty(window, 'ls112', { value: bridge, configurable: false, writable: false });
document.documentElement.dataset['platform'] = 'mac';

const ui = await import('./ui');
sim.start();

// ---------------------------------------------------------------- Szenen-Feed an RealityKit

if (hasNative()) {
  let mapState: ReturnType<typeof createStateMapper> | undefined;
  let lastWorld: unknown;
  let lastSent = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const sendState = () => {
    pending = undefined;
    const host = ui.useSim.getState().host;
    if (!host || !mapState) return;
    lastSent = performance.now();
    postNative(mapState(host));
  };

  ui.useSim.subscribe((s) => {
    if (s.world && s.world !== lastWorld) {
      lastWorld = s.world;
      mapState = createStateMapper(s.world);
      postNative(toSceneWorld(s.world));
    }
    if (!s.host || pending) return;
    const wait = Math.max(0, STATE_INTERVAL_MS - (performance.now() - lastSent));
    pending = setTimeout(sendState, wait);
  });
  postNative({ type: 'ready' });
}

/** Befehle der Swift-Hülle: Auswahl aus der 3D-Ansicht, Sichern beim Beenden. */
const shell = {
  focusVehicle: (id: string) => {
    ui.useSim.getState().focusVehicle(id);
  },
  /** Einsatz auswählen; fehlen noch Kräfte, gleich die Disposition öffnen. */
  openIncident: (id: string) => {
    const s = ui.useSim.getState();
    s.selectIncident(id);
    const incident = s.host?.view.incidents.find((i) => i.id === id);
    if (incident?.status === 'open') s.openDialog({ kind: 'dispatch', incidentId: id });
  },
  acceptCall: () => {
    const s = ui.useSim.getState();
    const call =
      s.host?.view.calls.find((c) => c.status === 'talking') ??
      s.host?.view.calls.find((c) => c.status === 'waiting');
    if (!call) return false;
    if (call.status === 'waiting') s.command({ type: 'call/accept', callId: call.id });
    s.openDialog({ kind: 'call', callId: call.id });
    return true;
  },
  togglePause: () => {
    ui.useSim.getState().togglePause();
  },
  /** Prüfmodus der Mac-App (Snapshot.swift): freies Spiel mit Zeitraffer starten. */
  startDemo: () => {
    const s = ui.useSim.getState();
    s.newGame('free');
    s.setSpeed(10);
  },
  suspend: () => sim.suspend('Beim Beenden'),
};
Object.defineProperty(window, 'ls112Shell', { value: shell });
