/**
 * Protokoll zwischen Sim-Host und Fenstern (ADR-0005).
 *
 * Richtung UI → Host: {@link ClientMessage}. Richtung Host → UI: {@link HostMessage}.
 * Alle Nachrichten sind strukturiert klonbar (MessagePort) und enthalten keine Texte.
 */
import type {
  GameView,
  HospitalSuggestion,
  ShiftStats,
  SimCommand,
  SimEvent,
  VehicleSuggestion,
  WorldInfo,
} from '@ls112/sim';

export type {
  CallView,
  FindingView,
  GameView,
  HospitalSuggestion,
  IncidentView,
  ReportView,
  ShiftStats,
  SimCommand,
  SimEvent,
  StaticAddress,
  VehicleSuggestion,
  VehicleView,
  WorldInfo,
  FmsStatus,
  ErrorCode,
  Outcome,
  RadioMessage,
} from '@ls112/sim';

/** Erlaubte Zeitraffer-Stufen. */
export const SPEEDS = [1, 2, 5, 10] as const;
export type Speed = (typeof SPEEDS)[number];

export const PROTOCOL_VERSION = 2;

export type GameMode = 'free' | 'tutorial';

export type Query =
  | { readonly type: 'suggestVehicles'; readonly incidentId: string }
  | { readonly type: 'suggestHospitals'; readonly vehicleId: string }
  | { readonly type: 'saves' };

export interface SaveInfo {
  readonly id: number;
  readonly name: string;
  readonly kind: 'auto' | 'manual';
  readonly createdAt: string;
  readonly gameTime: number;
  readonly region: string;
  readonly shiftIndex: number;
}

export type QueryResult =
  | { readonly type: 'suggestVehicles'; readonly items: readonly VehicleSuggestion[] }
  | { readonly type: 'suggestHospitals'; readonly items: readonly HospitalSuggestion[] }
  | { readonly type: 'saves'; readonly items: readonly SaveInfo[] };

export type ClientMessage =
  | { readonly type: 'hello'; readonly protocol: number; readonly view: string }
  | { readonly type: 'clock/setPaused'; readonly paused: boolean }
  /** Umschalten entscheidet der Host – sonst gehen schnelle Doppelklicks verloren. */
  | { readonly type: 'clock/togglePause' }
  | { readonly type: 'clock/setSpeed'; readonly speed: Speed }
  | { readonly type: 'sim/command'; readonly command: SimCommand }
  | { readonly type: 'query'; readonly id: number; readonly query: Query }
  | { readonly type: 'game/new'; readonly mode: GameMode }
  | { readonly type: 'save/write'; readonly name: string }
  | { readonly type: 'save/load'; readonly id: number };

/** Zustand, den jedes Fenster für die Anzeige braucht. */
export interface HostState {
  readonly view: GameView;
  readonly paused: boolean;
  readonly speed: Speed;
  readonly mode: GameMode;
  readonly gameId: number;
}

export type HostMessage =
  | { readonly type: 'welcome'; readonly protocol: number; readonly seed: number }
  | { readonly type: 'world'; readonly world: WorldInfo }
  | { readonly type: 'state'; readonly state: HostState }
  | { readonly type: 'events'; readonly events: readonly SimEvent[] }
  | { readonly type: 'reply'; readonly id: number; readonly result: QueryResult }
  | { readonly type: 'saved'; readonly name: string; readonly kind: 'auto' | 'manual' }
  | { readonly type: 'shiftEnded'; readonly shift: ShiftStats }
  | {
      readonly type: 'error';
      readonly code: 'protocolMismatch' | 'badMessage' | 'saveFailed' | 'loadFailed';
      readonly detail?: string;
    };

export function isSpeed(value: unknown): value is Speed {
  return typeof value === 'number' && (SPEEDS as readonly number[]).includes(value);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 64;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Prüft eingehende Nachrichten am Sim-Host. Fenster gelten als nicht vertrauenswürdig
 * (Mods, Fehler im UI), deshalb wird jede Nachricht strukturell validiert und kopiert.
 */
export function parseClientMessage(data: unknown): ClientMessage | undefined {
  if (!isRec(data)) return undefined;
  switch (data.type) {
    case 'hello':
      return typeof data.protocol === 'number' && typeof data.view === 'string'
        ? { type: 'hello', protocol: data.protocol, view: data.view.slice(0, 32) }
        : undefined;
    case 'clock/setPaused':
      return typeof data.paused === 'boolean'
        ? { type: 'clock/setPaused', paused: data.paused }
        : undefined;
    case 'clock/togglePause':
      return { type: 'clock/togglePause' };
    case 'clock/setSpeed':
      return isSpeed(data.speed) ? { type: 'clock/setSpeed', speed: data.speed } : undefined;
    case 'sim/command': {
      const command = parseSimCommand(data.command);
      return command ? { type: 'sim/command', command } : undefined;
    }
    case 'query': {
      const query = parseQuery(data.query);
      return isInt(data.id) && query ? { type: 'query', id: data.id, query } : undefined;
    }
    case 'game/new':
      return data.mode === 'free' || data.mode === 'tutorial'
        ? { type: 'game/new', mode: data.mode }
        : undefined;
    case 'save/write':
      return typeof data.name === 'string' && data.name.trim().length > 0
        ? { type: 'save/write', name: data.name.trim().slice(0, 60) }
        : undefined;
    case 'save/load':
      return isInt(data.id) ? { type: 'save/load', id: data.id } : undefined;
    default:
      return undefined;
  }
}

function parseQuery(q: unknown): Query | undefined {
  if (!isRec(q)) return undefined;
  if (q.type === 'suggestVehicles' && isId(q.incidentId))
    return { type: 'suggestVehicles', incidentId: q.incidentId };
  if (q.type === 'suggestHospitals' && isId(q.vehicleId))
    return { type: 'suggestHospitals', vehicleId: q.vehicleId };
  if (q.type === 'saves') return { type: 'saves' };
  return undefined;
}

export function parseSimCommand(c: unknown): SimCommand | undefined {
  if (!isRec(c)) return undefined;
  switch (c.type) {
    case 'call/accept':
    case 'call/close':
      return isId(c.callId) ? { type: c.type, callId: c.callId } : undefined;
    case 'incident/create':
      return isId(c.callId) && isInt(c.addressId) && isId(c.keywordId)
        ? {
            type: 'incident/create',
            callId: c.callId,
            addressId: c.addressId,
            keywordId: c.keywordId,
          }
        : undefined;
    case 'incident/dispatch':
      return isId(c.incidentId) &&
        Array.isArray(c.vehicleIds) &&
        c.vehicleIds.length > 0 &&
        c.vehicleIds.length <= 50 &&
        c.vehicleIds.every(isId)
        ? {
            type: 'incident/dispatch',
            incidentId: c.incidentId,
            vehicleIds: [...c.vehicleIds],
          }
        : undefined;
    case 'vehicle/assignDestination':
      return isId(c.vehicleId) && isId(c.hospitalId)
        ? { type: 'vehicle/assignDestination', vehicleId: c.vehicleId, hospitalId: c.hospitalId }
        : undefined;
    case 'vehicle/release':
      return isId(c.vehicleId) ? { type: 'vehicle/release', vehicleId: c.vehicleId } : undefined;
    default:
      return undefined;
  }
}
