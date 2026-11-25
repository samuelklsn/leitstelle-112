/**
 * Sim-Host auf Android (ADR-0021): derselbe {@link SimHost} wie unter Windows, nur in einem
 * Web Worker statt im Electron-utilityProcess. So bleibt die Oberfläche flüssig, auch wenn die
 * Simulation rechnet oder speichert.
 */
/// <reference lib="webworker" />
import { loadWithModLayers } from '@ls112/content';
import { SimHost, dailySeed, scenarioStart, shiftStart, type ClientPort } from '@ls112/host';
import type { HostMessage } from '@ls112/protocol';
import { CachedSaveStore } from './cached-save-store';
import { BASE_LAYER, modLayers } from './content';
import { openDatabase, readAllModFiles, readAllSaves, savePersistence } from './idb';
import type { LogLevel, WorkerControl, WorkerReport } from './worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

const LOOP_INTERVAL_MS = 50;

function report(message: WorkerReport): void {
  self.postMessage(message);
}

function logAt(level: LogLevel) {
  return (obj: object, msg?: string) => {
    report({ type: 'log', level, message: msg ?? '', context: serializable(obj) });
  };
}
const log = { info: logAt('info'), warn: logAt('warn'), error: logAt('error') };

/** Fehlerobjekte überstehen postMessage nicht als solche – als Text weitergeben. */
function serializable(obj: object): object {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v instanceof Error ? String(v) : v;
  return out;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

async function start(): Promise<{
  host: SimHost;
  store: CachedSaveStore | undefined;
  reload: () => Promise<void>;
}> {
  const started = performance.now();
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
  } catch (error) {
    log.error({ err: error }, 'Datenbank nicht verfügbar – Speichern deaktiviert');
  }
  const loadAll = async () => {
    const result = loadWithModLayers(BASE_LAYER, modLayers(db ? await readAllModFiles(db) : []));
    for (const m of result.mods)
      if (!m.ok) log.warn({ mod: m.folder, problems: m.problems }, 'Mod übersprungen');
    return result;
  };
  const loaded = await loadAll();
  const content = loaded.bundle;
  const store = db
    ? new CachedSaveStore(savePersistence(db), await readAllSaves(db), (error: unknown) => {
        log.error({ err: error }, 'Spielstand konnte nicht dauerhaft gespeichert werden');
      })
    : undefined;
  const host = new SimHost({
    content,
    log,
    ...(store ? { store } : {}),
    newSeed: randomSeed,
    dailySeed: () => dailySeed(),
    startTime: (preset) => shiftStart(content, preset),
    mods: loaded.mods,
    scenarioStart: (hour, month) => scenarioStart(hour, month),
  });
  // Mods neu laden ist asynchron (IndexedDB); der Host bekommt das fertige Ergebnis.
  const reload = async () => {
    try {
      const next = await loadAll();
      host.replaceContent(next.bundle, next.mods);
    } catch (error) {
      log.error({ err: error }, 'Inhalte konnten nicht neu geladen werden');
    }
  };
  log.info(
    {
      seed: host.sim.config.seed,
      startupMs: Math.round(performance.now() - started),
      nodes: host.sim.world.graph.nodeCount,
      saves: store?.list().length ?? 0,
    },
    'Sim-Worker gestartet',
  );
  return { host, store, reload };
}

function wrapPort(port: MessagePort): ClientPort {
  return {
    postMessage: (message: HostMessage) => {
      port.postMessage(message);
    },
    onMessage: (listener) => {
      port.addEventListener('message', (event: MessageEvent<unknown>) => {
        listener(event.data);
      });
    },
    onClose: (listener) => {
      port.addEventListener('close', listener);
    },
  };
}

const ready = start();

ready
  .then(({ host }) => {
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      host.update(now - last);
      last = now;
    }, LOOP_INTERVAL_MS);
  })
  .catch((error: unknown) => {
    report({ type: 'fatal', message: String(error) });
  });

self.addEventListener('message', (event: MessageEvent<WorkerControl>) => {
  const data = event.data;
  const port = event.ports[0];
  void ready.then(async ({ host, store, reload }) => {
    switch (data.type) {
      case 'connect-window':
        if (!port) return;
        host.addClient(wrapPort(port));
        port.start();
        return;
      case 'reload-content':
        await reload();
        return;
      case 'resume-latest': {
        const id = store?.latestAuto();
        if (id !== undefined && host.loadGame(id)) log.info({ id }, 'Nach Absturz fortgesetzt');
        return;
      }
      case 'suspend':
        host.suspend(data.name);
        await store?.flush();
        report({ type: 'suspended' });
        return;
    }
  });
});

self.addEventListener('error', (event) => {
  report({ type: 'fatal', message: event.message });
});
self.addEventListener('unhandledrejection', (event) => {
  report({ type: 'fatal', message: String(event.reason) });
});
