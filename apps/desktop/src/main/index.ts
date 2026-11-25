/**
 * Electron-Main-Prozess: Fenster, Lifecycle, Logging-Sammelstelle, Crash-Handling (ADR-0005).
 * Enthält keine Spiellogik.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  screen,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { createLogger } from '../shared/logger';
import { writeCrashReport } from '../shared/crash';
import {
  EMPTY_LAYOUT_FILE,
  WINDOW_VIEWS,
  allLayouts,
  fitLayout,
  parseLayoutFile,
  removeLayout,
  upsertLayout,
  type DisplayInfo,
  type LayoutFile,
  type WindowPlacement,
  type WindowView,
} from '../shared/layouts';
import { createZip, type ZipEntry } from '../shared/zip';

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
/** Mods: je Unterordner ein Mod (ADR-0019). Eigene Szenarien und Wachen speichern die Editoren hier. */
const modsDir = join(app.getPath('userData'), 'mods');
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
/** Welche Ansicht zeigt welches Fenster (Mehrfenster, #50). */
const views = new Map<BrowserWindow, WindowView>();
const layoutFile = () => join(app.getPath('userData'), 'layouts.json');

function readLayouts(): LayoutFile {
  try {
    return existsSync(layoutFile())
      ? parseLayoutFile(readFileSync(layoutFile(), 'utf8'))
      : EMPTY_LAYOUT_FILE;
  } catch (error) {
    log.warn({ err: error }, 'Layout-Datei nicht lesbar');
    return EMPTY_LAYOUT_FILE;
  }
}

function writeLayouts(file: LayoutFile): void {
  try {
    writeFileSync(layoutFile(), JSON.stringify(file, null, 2), 'utf8');
  } catch (error) {
    log.warn({ err: error }, 'Layout-Datei nicht schreibbar');
  }
}

function displays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen
    .getAllDisplays()
    .map((d) => ({ id: d.id, primary: d.id === primary, workArea: d.workArea }));
}

function windowOf(view: WindowView): BrowserWindow | undefined {
  for (const [win, v] of views) if (v === view && !win.isDestroyed()) return win;
  return undefined;
}

function place(win: BrowserWindow, p: WindowPlacement): void {
  if (win.isMaximized()) win.unmaximize();
  win.setBounds(p.bounds);
  if (p.maximized) win.maximize();
}

/** Layout anwenden: fehlende Fenster öffnen, überzählige Nebenfenster schließen. */
function applyLayout(name: string): boolean {
  const file = readLayouts();
  const layout = allLayouts(file, displays()).find((l) => l.name === name);
  if (!layout) return false;
  const placements = fitLayout(layout, displays());
  for (const p of placements) {
    const win = windowOf(p.view) ?? createWindow(p.view);
    place(win, p);
  }
  for (const [win, v] of views) {
    if (v !== 'main' && !placements.some((p) => p.view === v)) win.close();
  }
  writeLayouts({ ...file, last: name });
  return true;
}

function currentPlacements(): WindowPlacement[] {
  return [...views]
    .filter(([win]) => !win.isDestroyed())
    .map(([win, view]) => ({
      view,
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
    }));
}

/** Logs und Absturzberichte als ZIP (#34) – nichts wird versendet. */
async function createDiagnostics(parent: BrowserWindow | undefined): Promise<string | null> {
  const entries: ZipEntry[] = [];
  for (const [dir, prefix] of [
    [logDir, 'logs'],
    [crashDir, 'crashes'],
  ] as const) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.(log|json|txt|dmp)$/i.test(name)) continue;
      try {
        entries.push({ name: `${prefix}/${name}`, data: readFileSync(join(dir, name)) });
      } catch {
        // Gerade geschriebene Dateien können gesperrt sein – überspringen.
      }
    }
  }
  const info = {
    version: app.getVersion(),
    electron: process.versions.electron,
    os: `${process.platform} ${process.getSystemVersion()}`,
    arch: process.arch,
    displays: screen.getAllDisplays().length,
    simHostRestarts,
    createdAt: new Date().toISOString(),
  };
  entries.push({ name: 'system.json', data: Buffer.from(JSON.stringify(info, null, 2)) });
  const fileName = `Leitstelle112-Diagnose-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
  let target: string | undefined = process.env.LS112_DIAG_DIR
    ? join(process.env.LS112_DIAG_DIR, fileName)
    : undefined;
  if (!target) {
    const options = {
      title: 'Diagnosepaket speichern',
      defaultPath: join(app.getPath('desktop'), fileName),
      filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }],
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  writeFileSync(target, createZip(entries));
  log.info({ file: basename(target), entries: entries.length }, 'Diagnosepaket erstellt');
  if (!process.env.LS112_DIAG_DIR) shell.showItemInFolder(target);
  return target;
}

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
      LS112_MODS_DIR: modsDir,
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

const VIEW_TITLES: Record<WindowView, string> = {
  main: 'Leitstelle 112',
  map: 'Leitstelle 112 – Lagekarte',
  lists: 'Leitstelle 112 – Einsätze, Aufträge, Kliniken, Funk',
  vehicles: 'Leitstelle 112 – Fahrzeugstatus',
};

function createWindow(view: WindowView = 'main'): BrowserWindow {
  const main = view === 'main';
  const win = new BrowserWindow({
    width: main ? 1600 : 1100,
    height: main ? 900 : 760,
    minWidth: main ? 1024 : 480,
    minHeight: main ? 640 : 360,
    title: VIEW_TITLES[view],
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
  views.set(win, view);
  win.on('closed', () => {
    windows.delete(win);
    views.delete(win);
  });
  // Das Hauptfenster schließt die Anwendung samt Nebenfenstern.
  if (main) {
    win.on('close', () => {
      for (const other of windows) if (other !== win && !other.isDestroyed()) other.destroy();
    });
  }
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

  const query = main ? '' : `?view=${view}`;
  if (DEV_URL) {
    void win.loadURL(`${DEV_URL}${query}`);
  } else {
    void win.loadURL(`app://ui/index.html${query}`);
  }
  return win;
}

function isWindowView(v: unknown): v is WindowView {
  return WINDOW_VIEWS.some((x) => x === v);
}

ipcMain.handle('window-open', (_event, view: unknown) => {
  if (!isWindowView(view)) return false;
  const existing = windowOf(view);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  } else {
    createWindow(view);
  }
  return true;
});

ipcMain.on('window-focus-main', () => {
  const win = windowOf('main');
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

ipcMain.handle('layout-list', () => {
  const file = readLayouts();
  return {
    last: file.last ?? null,
    layouts: allLayouts(file, displays()).map((l) => ({
      name: l.name,
      builtIn: l.builtIn === true,
      windows: l.windows.length,
    })),
    displays: displays().length,
  };
});

ipcMain.handle('layout-apply', (_event, name: unknown) =>
  typeof name === 'string' ? applyLayout(name) : false,
);

ipcMain.handle('layout-save', (_event, name: unknown) => {
  if (typeof name !== 'string' || name.trim().length === 0) return false;
  writeLayouts(
    upsertLayout(readLayouts(), { name: name.trim().slice(0, 60), windows: currentPlacements() }),
  );
  return true;
});

ipcMain.handle('layout-delete', (_event, name: unknown) => {
  if (typeof name !== 'string') return false;
  writeLayouts(removeLayout(readLayouts(), name));
  return true;
});

ipcMain.handle('mods-open-folder', async () => {
  mkdirSync(modsDir, { recursive: true });
  return (await shell.openPath(modsDir)) === '';
});

/**
 * Editor speichert in einen eigenen Mod: Manifest plus eine JSON-Datei (JSON ist gültiges YAML).
 * Der Sim-Host prüft und lädt die Inhalte danach neu – kaputte Mods werden gemeldet, nicht geladen.
 */
ipcMain.handle('mods-save', (_event, modId: unknown, fileName: unknown, data: unknown) => {
  if (
    typeof modId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{1,40}$/.test(modId) ||
    typeof fileName !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,60}$/.test(fileName) ||
    typeof data !== 'object' ||
    data === null
  )
    return false;
  const text = JSON.stringify(data, null, 2);
  if (text.length > 1_000_000) return false;
  const dir = join(modsDir, modId);
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, 'mod.json');
  if (!existsSync(manifest)) {
    writeFileSync(
      manifest,
      JSON.stringify(
        { mod: { id: modId, name: 'Eigene Inhalte', version: '1.0.0', author: 'Spieler/in' } },
        null,
        2,
      ),
      'utf8',
    );
  }
  writeFileSync(join(dir, `${fileName}.json`), text, 'utf8');
  log.info({ mod: modId, file: fileName }, 'Mod-Datei gespeichert');
  simHost?.postMessage({ type: 'reload-content' });
  return true;
});

ipcMain.handle('diagnostics-create', (event) =>
  createDiagnostics([...windows].find((w) => w.webContents === event.sender)),
);

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
    createWindow('main');
    // Zuletzt benutztes Layout wiederherstellen (nicht im Test – dort zählt der Ausgangszustand).
    const last = readLayouts().last;
    if (last && !IS_E2E) applyLayout(last);
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
