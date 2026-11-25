/** Vom Preload bereitgestellte Brücke (apps/desktop/src/preload). Fehlt im reinen Browser. */
interface Ls112Bridge {
  /** Auf welcher Plattform die Oberfläche läuft (ADR-0021). Fehlt bei älteren Brücken. */
  readonly platform?: 'windows' | 'android';
  log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void;
  appInfo(): Promise<{ version: string; electron: string; simHostRestarts: number }>;
  e2eCrashSimHost(): void;
  openWindow(view: 'map' | 'lists' | 'vehicles'): Promise<boolean>;
  focusMainWindow(): void;
  listLayouts(): Promise<{
    readonly last: string | null;
    readonly layouts: readonly { name: string; builtIn: boolean; windows: number }[];
    readonly displays: number;
  }>;
  applyLayout(name: string): Promise<boolean>;
  saveLayout(name: string): Promise<boolean>;
  deleteLayout(name: string): Promise<boolean>;
  createDiagnostics(): Promise<string | null>;
  openModsFolder(): Promise<boolean>;
  saveModFile(modId: string, fileName: string, data: unknown): Promise<boolean>;
}

interface Window {
  readonly ls112?: Ls112Bridge;
}
