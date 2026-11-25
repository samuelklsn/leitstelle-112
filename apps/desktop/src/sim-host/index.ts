/**
 * Einstiegspunkt des Sim-Hosts (Electron utilityProcess, ADR-0005).
 * Lädt die Inhalte, verwaltet Spielstände, empfängt MessagePorts der Fenster und betreibt den Takt.
 */
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { MessagePortMain } from 'electron';
import { loadWithMods } from '@ls112/content/node';
import type { HostMessage } from '@ls112/protocol';
import {
  SimHost,
  dailySeed,
  scenarioStart,
  shiftStart,
  type ClientPort,
  type SaveStore,
} from '@ls112/host';
import { createLogger } from '../shared/logger';
import { writeCrashReport } from '../shared/crash';
import { SqliteSaveStore } from './saves';

const LOOP_INTERVAL_MS = 50;

const env = process.env;
const logDir = env.LS112_LOG_DIR ?? '.';
const crashDir = env.LS112_CRASH_DIR ?? '.';
const appVersion = env.LS112_APP_VERSION ?? '0.0.0';
const log = createLogger(logDir, 'sim-host');

const started = performance.now();
const contentDir = env.LS112_CONTENT_DIR ?? 'content/base';
const modsDir = env.LS112_MODS_DIR;
/** Basis plus Mods (ADR-0019); fehlerhafte Mods werden übersprungen und gemeldet. */
function loadAll() {
  const result = loadWithMods(contentDir, modsDir);
  for (const m of result.mods)
    if (!m.ok) log.warn({ mod: m.folder, problems: m.problems }, 'Mod übersprungen');
  return result;
}
const loaded = loadAll();
const content = loaded.bundle;
let store: SaveStore | undefined;
try {
  store = env.LS112_SAVE_FILE ? new SqliteSaveStore(env.LS112_SAVE_FILE) : undefined;
} catch (error) {
  log.error({ err: error }, 'Spielstand-Datenbank nicht verfügbar – Speichern deaktiviert');
}

const fixedSeed = env.LS112_SEED ? Number(env.LS112_SEED) >>> 0 : undefined;
// Nur für Tests: höheres Notrufaufkommen, damit kurze E2E-Läufe genug zu tun haben.
const rate = env.LS112_E2E === '1' && env.LS112_CALL_RATE ? Number(env.LS112_CALL_RATE) : 1;

const host = new SimHost({
  content,
  log,
  ...(store ? { store } : {}),
  newSeed: () => fixedSeed ?? randomInt(0, 2 ** 32 - 1),
  dailySeed: () => dailySeed(),
  startTime: (preset) => shiftStart(content, preset),
  mods: loaded.mods,
  reloadContent: () => {
    const next = loadAll();
    return { content: next.bundle, mods: next.mods };
  },
  scenarioStart: (hour, month) => scenarioStart(hour, month),
  callRateFactor: Number.isFinite(rate) && rate > 0 ? rate : 1,
});

// Nach einem Absturz: letzten automatischen Spielstand laden.
if (env.LS112_RESUME === '1') {
  const id = store?.latestAuto();
  if (id !== undefined && host.loadGame(id)) log.info({ id }, 'Nach Absturz fortgesetzt');
}
log.info(
  {
    seed: host.sim.config.seed,
    appVersion,
    startupMs: Math.round(performance.now() - started),
    nodes: host.sim.world.graph.nodeCount,
  },
  'Sim-Host gestartet',
);

function crash(error: unknown): never {
  const file = writeCrashReport(
    crashDir,
    {
      process: 'sim-host',
      appVersion,
      extra: {
        seed: host.sim.config.seed,
        tick: host.sim.tick,
        // Letzte Befehle: damit lässt sich der Absturz per Replay nachstellen.
        lastCommands: host.sim.commandLog().slice(-200),
      },
    },
    error,
  );
  log.fatal({ err: error, crashReport: file }, 'Sim-Host abgestürzt');
  log.flush();
  process.exit(1);
}

process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);

function wrapPort(port: MessagePortMain): ClientPort {
  return {
    postMessage: (message: HostMessage) => {
      port.postMessage(message);
    },
    onMessage: (listener) =>
      port.on('message', (event) => {
        listener(event.data);
      }),
    onClose: (listener) => port.on('close', listener),
  };
}

process.parentPort.on('message', (event) => {
  const data = event.data as { type?: unknown } | undefined;
  if (data?.type === 'connect-window') {
    const port = event.ports[0];
    if (!port) return;
    host.addClient(wrapPort(port));
    port.start();
  } else if (data?.type === 'reload-content') {
    host.reloadContent();
  } else if (data?.type === 'shutdown') {
    // Beim Beenden den aktuellen Stand sichern.
    host.suspend('Beim Beenden');
    store?.close();
    log.flush();
    process.exit(0);
  } else if (data?.type === 'crash-test' && env.LS112_E2E === '1') {
    // Nur für E2E-Tests: provozierter Absturz, um die Wiederherstellung zu prüfen.
    throw new Error('Absichtlicher Testabsturz');
  }
});

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  host.update(now - last);
  last = now;
}, LOOP_INTERVAL_MS);
