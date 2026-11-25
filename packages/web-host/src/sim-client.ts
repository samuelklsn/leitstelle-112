/**
 * Fensterseite des Sim-Workers (ADR-0021, ADR-0022): Worker starten, nach Absturz neu starten und
 * den letzten Autosave laden, der Oberfläche einen MessagePort geben, vor dem Anhalten sichern.
 * Android und die 3D-Mac-App nutzen das gemeinsam.
 */
import type { LogLevel, WorkerControl, WorkerReport } from './worker-protocol';

/** Nach so vielen Abstürzen in Folge kein automatischer Neustart mehr. */
const MAX_RESTARTS = 3;

export interface SimClient {
  /** Worker starten und die Oberfläche verbinden (einmal, nachdem die Oberfläche geladen ist). */
  start(): void;
  /** Inhalte samt Mods neu laden (nach dem Speichern im Editor). */
  reloadContent(): void;
  /** Sichern und anhalten; wartet höchstens `timeoutMs`. */
  suspend(name: string, timeoutMs?: number): Promise<void>;
  restarts(): number;
}

export function createSimClient(options: {
  readonly log: (level: LogLevel, message: string, context: object) => void;
}): SimClient {
  let worker: Worker | undefined;
  let restarts = 0;
  let suspended: (() => void) | undefined;

  const control = (message: WorkerControl, transfer: Transferable[] = []) => {
    worker?.postMessage(message, transfer);
  };

  /** Frischer Kanal zwischen Oberfläche und Sim-Host – derselbe Weg wie beim Electron-Preload. */
  const connectWindow = () => {
    const { port1, port2 } = new MessageChannel();
    control({ type: 'connect-window' }, [port1]);
    window.postMessage({ type: 'ls112:sim-port' }, '*', [port2]);
  };

  const restart = () => {
    worker?.terminate();
    worker = undefined;
    if (restarts >= MAX_RESTARTS) return;
    restarts++;
    startWorker(true);
  };

  function startWorker(resume: boolean): void {
    const w = new Worker(new URL('./sim-worker.ts', import.meta.url), {
      type: 'module',
      name: 'Leitstelle 112 – Simulation',
    });
    w.addEventListener('message', (event: MessageEvent<WorkerReport>) => {
      const m = event.data;
      switch (m.type) {
        case 'log':
          options.log(m.level, m.message, m.context);
          return;
        case 'suspended':
          suspended?.();
          suspended = undefined;
          return;
        case 'fatal':
          options.log('error', 'Sim-Worker abgestürzt', { error: m.message });
          restart();
          return;
      }
    });
    w.addEventListener('error', (event) => {
      options.log('error', 'Sim-Worker-Fehler', { error: event.message });
      restart();
    });
    worker = w;
    if (resume) control({ type: 'resume-latest' });
    connectWindow();
  }

  return {
    start: () => {
      startWorker(false);
    },
    reloadContent: () => {
      control({ type: 'reload-content' });
    },
    suspend: (name, timeoutMs = 1500) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        suspended = () => {
          clearTimeout(timer);
          resolve();
        };
        control({ type: 'suspend', name });
      }),
    restarts: () => restarts,
  };
}
