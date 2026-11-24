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
  | { readonly kind: 'help' };

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
  newGame: (mode: GameMode) => void;
  openDialog: (dialog: Dialog | null) => void;
  selectIncident: (id: string | null) => void;
  focusVehicle: (id: string | null) => void;
  notify: (text: string) => void;
}

let port: MessagePort | undefined;
let eventKey = 0;
let queryId = 0;
const pending = new Map<number, (r: QueryResult) => void>();

/**
 * Zustand des Fensters, gespeist aus Nachrichten des Sim-Hosts, plus reiner UI-Zustand
 * (offene Dialoge, Auswahl). Keine Spiellogik (CLAUDE.md, Regel 4).
 */
export const useSim = create<SimStore>((set, get) => ({
  status: 'connecting',
  world: undefined,
  host: undefined,
  events: [],
  dialog: { kind: 'start' },
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
  newGame: (mode) => {
    get().send({ type: 'game/new', mode });
    set({ events: [], dialog: null, selectedIncidentId: null });
  },
  openDialog: (dialog) => {
    set({ dialog });
  },
  selectIncident: (id) => {
    set({ selectedIncidentId: id });
  },
  focusVehicle: (id) => {
    set({ focusVehicleId: id });
  },
  notify: (text) => {
    set({ notice: { text, at: Date.now() } });
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
