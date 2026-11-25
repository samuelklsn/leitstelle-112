/**
 * Steuernachrichten zwischen App-Fenster und Sim-Worker (ADR-0021). Das Spiel selbst läuft über
 * einen eigenen MessagePort mit dem normalen Protokoll (`@ls112/protocol`), wie unter Windows.
 */

/** Fenster → Worker. Der Port für das Spielprotokoll reist als Transferable mit. */
export type WorkerControl =
  | { readonly type: 'connect-window' }
  | { readonly type: 'reload-content' }
  /** Nach einem Absturz des Workers: letzten automatischen Spielstand laden. */
  | { readonly type: 'resume-latest' }
  /** App geht in den Hintergrund: sichern, anhalten und melden, wenn es gespeichert ist. */
  | { readonly type: 'suspend'; readonly name: string };

export type LogLevel = 'info' | 'warn' | 'error';

/** Worker → Fenster. */
export type WorkerReport =
  | {
      readonly type: 'log';
      readonly level: LogLevel;
      readonly message: string;
      readonly context: object;
    }
  | { readonly type: 'suspended' }
  | { readonly type: 'fatal'; readonly message: string };
