/**
 * Kanal zur Swift-Hülle (WKScriptMessageHandler „ls112"). Fehlt im Browser – dann geht nichts
 * verloren, die 3D-Ansicht fehlt einfach.
 */
import type { SceneState, SceneWorld } from './scene-feed';

export type NativeMessage =
  | SceneWorld
  | SceneState
  | {
      readonly type: 'log';
      readonly level: string;
      readonly message: string;
      readonly context: object;
    }
  | { readonly type: 'diagnostics'; readonly fileName: string; readonly base64: string }
  | { readonly type: 'ready' };

interface WebKitWindow {
  readonly webkit?: {
    readonly messageHandlers?: { readonly ls112?: { postMessage(message: unknown): void } };
  };
}

export function postNative(message: NativeMessage): void {
  (window as unknown as WebKitWindow).webkit?.messageHandlers?.ls112?.postMessage(message);
}

export function hasNative(): boolean {
  return (window as unknown as WebKitWindow).webkit?.messageHandlers?.ls112 !== undefined;
}
