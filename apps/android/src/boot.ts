/**
 * Start der Android-App (ADR-0021). Übernimmt die Rolle von Electron-Main und Preload:
 * Sim-Worker starten, Brücke `window.ls112` bereitstellen, der Oberfläche einen MessagePort zum
 * Sim-Host geben und auf den Android-Lebenszyklus reagieren (Hintergrund, Zurück-Taste).
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { appendLog, createBridge } from './bridge';
import { openDatabase } from './idb';
import type { WorkerControl, WorkerReport } from './worker-protocol';

declare const __APP_VERSION__: string;

/** Nach so vielen Abstürzen in Folge kein automatischer Neustart mehr. */
const MAX_RESTARTS = 3;

let worker: Worker | undefined;
let restarts = 0;
let suspended: (() => void) | undefined;
let dbPromise: Promise<IDBDatabase> | undefined;

function control(message: WorkerControl, transfer: Transferable[] = []): void {
  worker?.postMessage(message, transfer);
}

function startWorker(resume: boolean): void {
  const w = new Worker(new URL('./sim-worker.ts', import.meta.url), {
    type: 'module',
    name: 'Leitstelle 112 – Simulation',
  });
  w.addEventListener('message', (event: MessageEvent<WorkerReport>) => {
    const m = event.data;
    switch (m.type) {
      case 'log':
        appendLog({ level: m.level, source: 'sim', message: m.message, context: m.context });
        return;
      case 'suspended':
        suspended?.();
        suspended = undefined;
        return;
      case 'fatal':
        appendLog({
          level: 'error',
          source: 'sim',
          message: 'Sim-Worker abgestürzt',
          context: { error: m.message },
        });
        restartWorker();
        return;
    }
  });
  w.addEventListener('error', (event) => {
    appendLog({
      level: 'error',
      source: 'sim',
      message: 'Sim-Worker-Fehler',
      context: { error: event.message },
    });
    restartWorker();
  });
  worker = w;
  if (resume) control({ type: 'resume-latest' });
  connectWindow();
}

/** Wie unter Windows: nach einem Absturz neu starten und den letzten Autosave laden. */
function restartWorker(): void {
  worker?.terminate();
  worker = undefined;
  if (restarts >= MAX_RESTARTS) return;
  restarts++;
  startWorker(true);
}

/** Frischer Kanal zwischen Oberfläche und Sim-Host – derselbe Weg wie beim Electron-Preload. */
function connectWindow(): void {
  const { port1, port2 } = new MessageChannel();
  control({ type: 'connect-window' }, [port1]);
  window.postMessage({ type: 'ls112:sim-port' }, '*', [port2]);
}

/** Vor dem Anhalten durch Android sichern; höchstens kurz warten, Android lässt wenig Zeit. */
function suspend(name: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    suspended = () => {
      clearTimeout(timer);
      resolve();
    };
    control({ type: 'suspend', name });
  });
}

const bridge = createBridge({
  version: __APP_VERSION__,
  db: () => (dbPromise ??= openDatabase()),
  reloadContent: () => {
    control({ type: 'reload-content' });
  },
  restarts: () => restarts,
});
Object.defineProperty(window, 'ls112', { value: bridge, configurable: false, writable: false });
document.documentElement.dataset['platform'] = 'android';

// Oberfläche laden (registriert dabei den Empfänger für den Port), danach den Sim-Worker starten.
const ui = await import('./ui');
startWorker(false);

if (Capacitor.isNativePlatform()) {
  await App.addListener('pause', () => {
    void suspend('App im Hintergrund');
  });
  await App.addListener('backButton', () => {
    if (!ui.handleBack()) void App.minimizeApp();
  });
  // Notruf und Großlage zusätzlich spürbar machen – auch bei stummgeschaltetem Telefon.
  ui.onCue((cue) => {
    void Haptics.impact({ style: cue === 'ring' ? ImpactStyle.Medium : ImpactStyle.Heavy });
  });
} else {
  // Im Browser (Entwicklung) dieselbe Sicherung beim Verlassen der Seite.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void suspend('App im Hintergrund');
  });
}
