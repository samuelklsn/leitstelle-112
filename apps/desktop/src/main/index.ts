/**
 * Electron-Main-Prozess: Fenster, Lifecycle, Logging-Sammelstelle, Crash-Handling (ADR-0005).
 * Enthält keine Spiellogik.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  crashReporter,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { createLogger } from '../shared/logger';
import { writeCrashReport } from '../shared/crash';

const APP_ID = 'de.leitstelle112.app';
const DEV_URL = process.env.LS112_DEV_URL;
const IS_E2E = process.env.LS112_E2E === '1';

// Eigener, leerzeichenfreier Datenordner: %APPDATA%\Leitstelle112 (PLAN 4.6).
// Für E2E-Tests kann er umgelenkt werden, damit Tests das echte Profil nicht berühren.
app.setPath(
  'userData',
  process.env.LS112_USER_DATA ?? join(app.getPath('appData'), 'Leitstelle112'),
);
app.setAppUserModelId(APP_ID);

const logDir = join(app.getPath('userData'), 'logs');
const crashDir = join(app.getPath('userData'), 'crashes');
app.setPath('crashDumps', crashDir);
crashReporter.start({ uploadToServer: false });

const log = createLogger(logDir, 'main');
log.info({ version: app.getVersion(), electron: process.versions.electron }, 'App startet');

function fatal(error: unknown): void {
  const file = writeCrashReport(crashDir, { process: 'main', appVersion: app.getVersion() }, error);
  log.fatal({ err: error, crashReport: file }, 'Unbehandelter Fehler im Main-Prozess');
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

// Renderer-Dateien über ein eigenes Schema statt file:// – so gelten CSP und Herkunft sauber.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function registerAppProtocol(): void {
  const root = join(__dirname, 'renderer');
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = join(root, relative);
    // Pfad-Ausbruch verhindern (../).
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(response.body, { status: response.status, headers });
  });
}

let quitting = false;
let simHost: UtilityProcess | undefined;
let simHostRestarts = 0;
const windows = new Set<BrowserWindow>();

/** Basisinhalte: im Installer unter resources/content, in der Entwicklung im Repository. */
function contentDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'content', 'base')
    : join(__dirname, '..', '..', '..', 'content', 'base');
}

function startSimHost(resume = false): void {
  const child = utilityProcess.fork(join(__dirname, 'sim-host.cjs'), [], {
    serviceName: 'Leitstelle 112 – Simulation',
    stdio: 'pipe',
    env: {
      ...process.env,
      LS112_LOG_DIR: logDir,
      LS112_CRASH_DIR: crashDir,
      LS112_APP_VERSION: app.getVersion(),
      LS112_CONTENT_DIR: contentDir(),
      LS112_SAVE_FILE: join(app.getPath('userData'), 'saves.db'),
      LS112_RESUME: resume ? '1' : '0',
    },
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    log.debug({ simHost: chunk.toString() }, 'sim-host stdout');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log.warn({ simHost: chunk.toString() }, 'sim-host stderr');
  });
  child.on('exit', (code) => {
    if (simHost !== child) return;
    simHost = undefined;
    if (code === 0 || quitting) return;
    log.error({ code }, 'Sim-Host unerwartet beendet');
    void handleSimHostCrash();
  });
  child.on('spawn', () => {
    for (const win of windows) connectWindow(win);
  });
  simHost = child;
}

async function handleSimHostCrash(): Promise<void> {
  // Im Test automatisch neu starten, sonst den Spieler fragen.
  if (IS_E2E) {
    simHostRestarts++;
    startSimHost(true);
    return;
  }
  const parent = [...windows][0];
  const options = {
    type: 'error' as const,
    title: 'Leitstelle 112',
    message: 'Die Simulation wurde unerwartet beendet.',
    detail:
      'Ein Absturzbericht wurde lokal gespeichert. Es werden keine Daten versendet.\n' +
      'Beim Neustart wird der letzte automatische Spielstand geladen (höchstens 5 Spielminuten alt).',
    buttons: ['Neu starten', 'Berichtsordner öffnen', 'Beenden'],
    defaultId: 0,
    cancelId: 2,
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response === 1) void shell.openPath(crashDir);
  if (response === 2) {
    app.quit();
    return;
  }
  simHostRestarts++;
  startSimHost(true);
}

/** Gibt dem Fenster einen direkten Kanal zum Sim-Host (ADR-0005). */
function connectWindow(win: BrowserWindow): void {
  if (!simHost || win.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  simHost.postMessage({ type: 'connect-window' }, [port1]);
  win.webContents.postMessage('sim-port', null, [port2]);
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Leitstelle 112',
    backgroundColor: '#0b0f14',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  win.once('ready-to-show', () => {
    win.show();
  });
  // Bei jedem (Neu-)Laden einen frischen Port – alte Ports gehören zur alten Seite.
  win.webContents.on('did-finish-load', () => {
    connectWindow(win);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    const file = writeCrashReport(
      crashDir,
      { process: 'renderer', appVersion: app.getVersion() },
      new Error(`Renderer beendet: ${details.reason}`),
    );
    log.error({ details, crashReport: file }, 'Renderer-Prozess beendet');
  });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadURL('app://ui/index.html');
  }
  return win;
}

type RendererLogLevel = 'info' | 'warn' | 'error';
ipcMain.on('renderer-log', (_event, level: unknown, message: unknown, context: unknown) => {
  const lvl: RendererLogLevel = level === 'warn' || level === 'error' ? level : 'info';
  const msg = typeof message === 'string' ? message.slice(0, 2000) : 'ungültige Log-Nachricht';
  const ctx = typeof context === 'object' && context !== null ? context : {};
  log[lvl]({ renderer: ctx }, msg);
});

ipcMain.handle('app-info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  simHostRestarts,
}));

// Nur für E2E-Tests: Absturz des Sim-Hosts auslösen.
ipcMain.on('e2e-crash-sim-host', () => {
  if (IS_E2E) simHost?.postMessage({ type: 'crash-test' });
});

app.on('before-quit', () => {
  quitting = true;
  log.info('App wird beendet');
  // Sim-Host sichert den aktuellen Stand und beendet sich selbst.
  simHost?.postMessage({ type: 'shutdown' });
});

const gotLock = IS_E2E || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = [...windows][0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app.whenReady().then(() => {
    registerAppProtocol();
    startSimHost();
    createMainWindow();
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
