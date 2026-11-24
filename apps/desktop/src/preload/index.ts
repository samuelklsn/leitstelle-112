/**
 * Preload (sandboxed): stellt nur eine minimale, typisierte Brücke bereit (ADR-0005).
 * Der MessagePort zum Sim-Host wird per window.postMessage an die Seite übergeben,
 * weil Ports nicht über contextBridge transportiert werden können.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface Ls112Bridge {
  log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void;
  appInfo(): Promise<{ version: string; electron: string; simHostRestarts: number }>;
  e2eCrashSimHost(): void;
  /** Ansicht in eigenem Fenster öffnen (Mehrmonitor). */
  openWindow(view: 'map' | 'lists' | 'vehicles'): Promise<boolean>;
  focusMainWindow(): void;
  listLayouts(): Promise<LayoutList>;
  applyLayout(name: string): Promise<boolean>;
  saveLayout(name: string): Promise<boolean>;
  deleteLayout(name: string): Promise<boolean>;
  /** Logs und Absturzberichte als ZIP speichern; liefert den Pfad oder null (abgebrochen). */
  createDiagnostics(): Promise<string | null>;
}

export interface LayoutList {
  readonly last: string | null;
  readonly layouts: readonly { name: string; builtIn: boolean; windows: number }[];
  readonly displays: number;
}

const bridge: Ls112Bridge = {
  log: (level, message, context) => {
    ipcRenderer.send('renderer-log', level, message, context ?? {});
  },
  appInfo: () =>
    ipcRenderer.invoke('app-info') as Promise<{
      version: string;
      electron: string;
      simHostRestarts: number;
    }>,
  e2eCrashSimHost: () => {
    ipcRenderer.send('e2e-crash-sim-host');
  },
  openWindow: (view) => ipcRenderer.invoke('window-open', view) as Promise<boolean>,
  focusMainWindow: () => {
    ipcRenderer.send('window-focus-main');
  },
  listLayouts: () => ipcRenderer.invoke('layout-list') as Promise<LayoutList>,
  applyLayout: (name) => ipcRenderer.invoke('layout-apply', name) as Promise<boolean>,
  saveLayout: (name) => ipcRenderer.invoke('layout-save', name) as Promise<boolean>,
  deleteLayout: (name) => ipcRenderer.invoke('layout-delete', name) as Promise<boolean>,
  createDiagnostics: () => ipcRenderer.invoke('diagnostics-create') as Promise<string | null>,
};

contextBridge.exposeInMainWorld('ls112', bridge);

ipcRenderer.on('sim-port', (event) => {
  window.postMessage({ type: 'ls112:sim-port' }, '*', event.ports);
});
