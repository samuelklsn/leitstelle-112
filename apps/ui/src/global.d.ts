/** Vom Preload bereitgestellte Brücke (apps/desktop/src/preload). Fehlt im reinen Browser. */
interface Ls112Bridge {
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
}

interface Window {
  readonly ls112?: Ls112Bridge;
}
