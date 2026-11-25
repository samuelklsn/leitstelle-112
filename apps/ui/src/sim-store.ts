import { loadKeymap, saveKeymap, type Keymap } from './keymap';
import {
  cueFor,
  loadSoundSettings,
  play,
  saveSoundSettings,
  type Cue,
  type SoundSettings,
} from './sound';
import { create } from 'zustand';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type GameMode,
  type HostMessage,
  type HostState,
  type Query,
  type QueryResult,
  type ShiftStats,
  type SimCommand,
  type SimEvent,
  type Speed,
  type ModStatusView,
  type StartPreset,
  type WorldInfo,
} from '@ls112/protocol';

export type LogEntry = SimEvent & { readonly key: number };

/** Wie viele Ereignisse das Protokoll im Speicher hält. */
export const EVENT_LOG_LIMIT = 400;

export type Dialog =
  | { readonly kind: 'start' }
  | { readonly kind: 'call'; readonly callId: string }
  | { readonly kind: 'dispatch'; readonly incidentId: string }
  | { readonly kind: 'destination'; readonly vehicleId: string }
  | { readonly kind: 'evaluation'; readonly shift?: ShiftStats }
  | { readonly kind: 'saves' }
  | { readonly kind: 'help' }
  | { readonly kind: 'windows' }
  | { readonly kind: 'mci'; readonly incidentId: string }
  | { readonly kind: 'mods' }
  | { readonly kind: 'scenarioEditor' }
  | { readonly kind: 'stationEditor' }
  | { readonly kind: 'keys' }
  /** Hauptmenü auf kleinen Bildschirmen (Android, ADR-0021). */
  | { readonly kind: 'menu' };

/** Ansicht dieses Fensters (Mehrfenster, #50): Hauptfenster oder ein ausgelagerter Bereich. */
export type WindowView = 'main' | 'map' | 'lists' | 'vehicles';
export const WINDOW_VIEW: WindowView = (() => {
  if (typeof window === 'undefined') return 'main';
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'map' || v === 'lists' || v === 'vehicles' ? v : 'main';
})();

/**
 * Fenster desselben Spiels stimmen Auswahl und Dialoge ab: Nebenfenster öffnen Dialoge im
 * Hauptfenster, eine Auswahl gilt in allen Fenstern.
 */
type WindowSync =
  | { readonly type: 'select'; readonly incidentId: string | null }
  | { readonly type: 'focusVehicle'; readonly vehicleId: string | null }
  | { readonly type: 'dialog'; readonly dialog: Dialog };
const channel: BroadcastChannel | undefined =
  typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('ls112-windows');

export type BottomTab = 'incidents' | 'orders' | 'hospitals' | 'radio';

/** Sichtbarer Bereich im Telefon-Layout – dort passt immer nur einer auf den Schirm. */
export type MobilePane = 'map' | 'calls' | 'vehicles' | 'lists';

interface SimStore {
  status: 'connecting' | 'connected' | 'disconnected';
  world: WorldInfo | undefined;
  host: HostState | undefined;
  events: readonly LogEntry[];
  dialog: Dialog | null;
  selectedIncidentId: string | null;
  focusVehicleId: string | null;
  notice: { text: string; at: number } | null;
  /** Fortschritt in der Notrufmaske (für das Tutorial). */
  maskProgress: { address: boolean; keyword: boolean };
  /** Nach „Einsatz anlegen" die Disposition des neuen Einsatzes automatisch öffnen. */
  expectDispatch: boolean;
  send: (message: ClientMessage) => void;
  command: (command: SimCommand) => void;
  query: (query: Query) => Promise<QueryResult>;
  togglePause: () => void;
  setSpeed: (speed: Speed) => void;
  newGame: (
    mode: GameMode,
    start?: StartPreset,
    extra?: { scenario?: string; hilfsfrist?: string },
  ) => void;
  /** Geladene und übersprungene Mods (ADR-0019). */
  mods: readonly ModStatusView[];
  /** Wählbare Szenarien und Hilfsfrist-Regeln für ein neues Spiel. */
  catalog: {
    scenarios: WorldInfo['scenarios'];
    hilfsfristPresets: WorldInfo['hilfsfristPresets'];
  } | null;
  /** Kartenauswahl für Editoren: nächster Klick auf die Karte liefert Koordinaten. */
  mapPick: ((x: number, y: number) => void) | null;
  setMapPick: (pick: ((x: number, y: number) => void) | null) => void;
  openDialog: (dialog: Dialog | null) => void;
  selectIncident: (id: string | null) => void;
  focusVehicle: (id: string | null) => void;
  notify: (text: string) => void;
  /** Tastenbelegung (#30) und ob gerade eine Taste neu belegt wird. */
  keymap: Keymap;
  setKeymap: (keymap: Keymap) => void;
  capturingKey: boolean;
  setCapturingKey: (on: boolean) => void;
  bottomTab: BottomTab;
  setBottomTab: (tab: BottomTab) => void;
  mobilePane: MobilePane;
  setMobilePane: (pane: MobilePane) => void;
  /** Akustische Signale (Notruf, Sprechwunsch, Großlage). */
  sound: SoundSettings;
  setSound: (sound: SoundSettings) => void;
}

let port: MessagePort | undefined;
let eventKey = 0;
let queryId = 0;
const pending = new Map<number, (r: QueryResult) => void>();
const cueListeners = new Set<(cue: Cue) => void>();

/** Zusätzliche Signale zu den Tönen, z. B. Vibration auf Android. Liefert eine Abmeldung. */
export function onCue(listener: (cue: Cue) => void): () => void {
  cueListeners.add(listener);
  return () => cueListeners.delete(listener);
}

/**
 * Zustand des Fensters, gespeist aus Nachrichten des Sim-Hosts, plus reiner UI-Zustand
 * (offene Dialoge, Auswahl). Keine Spiellogik (CLAUDE.md, Regel 4).
 */
export const useSim = create<SimStore>((set, get) => ({
  status: 'connecting',
  world: undefined,
  host: undefined,
  events: [],
  // Nur das Hauptfenster begrüßt mit dem Startbildschirm.
  dialog: WINDOW_VIEW === 'main' ? { kind: 'start' } : null,
  selectedIncidentId: null,
  focusVehicleId: null,
  notice: null,
  maskProgress: { address: false, keyword: false },
  expectDispatch: false,
  send: (message) => {
    port?.postMessage(message);
  },
  command: (command) => {
    get().send({ type: 'sim/command', command });
  },
  query: (query) =>
    new Promise((resolve) => {
      const id = ++queryId;
      pending.set(id, resolve);
      get().send({ type: 'query', id, query });
    }),
  togglePause: () => {
    get().send({ type: 'clock/togglePause' });
  },
  setSpeed: (speed) => {
    get().send({ type: 'clock/setSpeed', speed });
  },
  newGame: (mode, start, extra = {}) => {
    get().send({ type: 'game/new', mode, ...(start ? { start } : {}), ...extra });
    set({ events: [], dialog: null, selectedIncidentId: null });
  },
  openDialog: (dialog) => {
    // Nebenfenster haben keine Dialoge – das Hauptfenster übernimmt und kommt nach vorn.
    if (WINDOW_VIEW !== 'main' && dialog) {
      channel?.postMessage({ type: 'dialog', dialog } satisfies WindowSync);
      window.ls112?.focusMainWindow();
      return;
    }
    set({ dialog });
  },
  selectIncident: (id) => {
    set({ selectedIncidentId: id });
    channel?.postMessage({ type: 'select', incidentId: id } satisfies WindowSync);
  },
  focusVehicle: (id) => {
    set({ focusVehicleId: id });
    channel?.postMessage({ type: 'focusVehicle', vehicleId: id } satisfies WindowSync);
  },
  notify: (text) => {
    set({ notice: { text, at: Date.now() } });
  },
  keymap: loadKeymap(),
  setKeymap: (keymap) => {
    saveKeymap(keymap);
    set({ keymap });
  },
  capturingKey: false,
  setCapturingKey: (on) => {
    set({ capturingKey: on });
  },
  mods: [],
  catalog: null,
  mapPick: null,
  setMapPick: (pick) => {
    set({ mapPick: pick });
  },
  bottomTab: 'incidents',
  setBottomTab: (tab) => {
    set({ bottomTab: tab });
  },
  mobilePane: 'map',
  setMobilePane: (pane) => {
    set({ mobilePane: pane });
  },
  sound: loadSoundSettings(),
  setSound: (sound) => {
    saveSoundSettings(sound);
    set({ sound });
  },
}));

function handleHostMessage(message: HostMessage): void {
  switch (message.type) {
    case 'welcome':
      useSim.setState({ status: 'connected' });
      return;
    case 'world':
      useSim.setState({ world: message.world });
      return;
    case 'mods':
      useSim.setState({ mods: message.mods });
      return;
    case 'catalog':
      useSim.setState({
        catalog: { scenarios: message.scenarios, hilfsfristPresets: message.hilfsfristPresets },
      });
      return;
    case 'state': {
      const prev = useSim.getState().host;
      // Neues Spiel oder geladener Stand: Protokoll leeren.
      if (prev && prev.gameId !== message.state.gameId) {
        useSim.setState({ events: [], selectedIncidentId: null });
      }
      useSim.setState({ host: message.state, status: 'connected' });
      return;
    }
    case 'events': {
      const entries = message.events.map((e) => ({ ...e, key: eventKey++ }));
      useSim.setState((s) => ({
        events: [...entries.reverse(), ...s.events].slice(0, EVENT_LOG_LIMIT),
      }));
      // Nur das Hauptfenster gibt Töne aus – sonst klingelt jeder Bildschirm.
      const cue = WINDOW_VIEW === 'main' ? cueFor(message.events) : undefined;
      const sound = useSim.getState().sound;
      if (cue) play(cue, sound);
      if (cue && sound.enabled) for (const listener of cueListeners) listener(cue);
      const created = message.events.find((e) => e.type === 'incident/created');
      if (created?.type === 'incident/created' && useSim.getState().expectDispatch) {
        useSim.setState({
          expectDispatch: false,
          dialog: { kind: 'dispatch', incidentId: created.incidentId },
          selectedIncidentId: created.incidentId,
        });
      }
      return;
    }
    case 'reply': {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.result);
      return;
    }
    case 'saved':
      if (message.kind === 'manual') useSim.getState().notify(`Gespeichert: ${message.name}`);
      return;
    case 'shiftEnded':
      if (WINDOW_VIEW === 'main')
        useSim.setState({ dialog: { kind: 'evaluation', shift: message.shift } });
      return;
    case 'error':
      window.ls112?.log('warn', 'Sim-Host meldet Fehler', { code: message.code });
      if (message.code === 'loadFailed')
        useSim.getState().notify('Spielstand konnte nicht geladen werden.');
      if (message.code === 'saveFailed') useSim.getState().notify('Speichern fehlgeschlagen.');
      return;
  }
}

channel?.addEventListener('message', (event: MessageEvent<WindowSync>) => {
  const m = event.data;
  if (m.type === 'select') useSim.setState({ selectedIncidentId: m.incidentId });
  if (m.type === 'focusVehicle') useSim.setState({ focusVehicleId: m.vehicleId });
  if (m.type === 'dialog' && WINDOW_VIEW === 'main') {
    useSim.setState({
      dialog: m.dialog,
      ...(m.dialog.kind === 'dispatch' ? { selectedIncidentId: m.dialog.incidentId } : {}),
    });
  }
});

/** Nimmt den vom Preload übergebenen MessagePort entgegen (auch nach Neustart des Sim-Hosts). */
export function connectToSimHost(view: string): void {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown } | null;
    if (event.source !== window || data?.type !== 'ls112:sim-port') return;
    const next = event.ports[0];
    if (!next) return;
    port?.close();
    port = next;
    port.onmessage = (e: MessageEvent<HostMessage>) => {
      handleHostMessage(e.data);
    };
    port.addEventListener('close', () => {
      useSim.setState({ status: 'disconnected' });
    });
    port.start();
    port.postMessage({ type: 'hello', protocol: PROTOCOL_VERSION, view } satisfies ClientMessage);
  });
}
