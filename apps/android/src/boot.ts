/**
 * Start der Android-App (ADR-0021). Übernimmt die Rolle von Electron-Main und Preload:
 * Sim-Worker starten, Brücke `window.ls112` bereitstellen, der Oberfläche einen MessagePort zum
 * Sim-Host geben und auf den Android-Lebenszyklus reagieren (Hintergrund, Zurück-Taste).
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { appendLog, createSimClient, openDatabase } from '@ls112/web-host';
import { createBridge } from './bridge';

declare const __APP_VERSION__: string;

let dbPromise: Promise<IDBDatabase> | undefined;

const sim = createSimClient({
  log: (level, message, context) => {
    appendLog({ level, source: 'sim', message, context });
  },
});

const bridge = createBridge({
  version: __APP_VERSION__,
  db: () => (dbPromise ??= openDatabase()),
  reloadContent: () => {
    sim.reloadContent();
  },
  restarts: () => sim.restarts(),
});
Object.defineProperty(window, 'ls112', { value: bridge, configurable: false, writable: false });
document.documentElement.dataset['platform'] = 'android';

// Oberfläche laden (registriert dabei den Empfänger für den Port), danach den Sim-Worker starten.
const ui = await import('./ui');
sim.start();

if (Capacitor.isNativePlatform()) {
  await App.addListener('pause', () => {
    void sim.suspend('App im Hintergrund');
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
    if (document.visibilityState === 'hidden') void sim.suspend('App im Hintergrund');
  });
}
