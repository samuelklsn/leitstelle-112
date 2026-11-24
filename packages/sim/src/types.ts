import type { RngState } from './rng';
import type { Scheduled } from './event-queue';
import type { SimTime } from './time';

/** Namen der Zufalls-Streams. Neue Subsysteme bekommen einen eigenen Namen (ADR-0004). */
export const RNG_STREAMS = ['calls', 'callers', 'patients', 'crews', 'outcome'] as const;
export type RngStreamName = (typeof RNG_STREAMS)[number];

/** Serialisierbare Startparameter. Inhalte (Region, Fahrzeuge …) kommen separat. */
export interface SimConfig {
  /** Master-Seed, ganze Zahl 0 … 2^32-1. */
  readonly seed: number;
  /** Startzeitpunkt (Ortszeit). */
  readonly startTime: SimTime;
  /** Multiplikator auf das Notrufaufkommen (Schwierigkeitsgrad), 1 = Standard. */
  readonly callRateFactor: number;
  /** Trainingsmodus: erster Notruf nach wenigen Sekunden, danach ruhiger. */
  readonly tutorial: boolean;
}

/** FMS-Status (Fahrzeugstatus-Meldesystem). */
export type FmsStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// ----------------------------------------------------------------------------- Anrufe

export type CallerKind = 'self' | 'relative' | 'neighbor' | 'passerby' | 'caregiver';

/** Die verborgene, tatsächliche Lage hinter einem Notruf (ADR-0014, „wahre Lage"). */
export interface Truth {
  readonly diagnosisId: string;
  readonly addressId: number;
  readonly age: number;
  readonly sex: 'm' | 'w';
  readonly naca: number;
  readonly needsDoctor: boolean;
  readonly transport: boolean;
  readonly onSceneMs: number;
}

/** Was der Anrufer sagt – nicht immer richtig. */
export interface CallerReport {
  readonly kind: CallerKind;
  readonly reportKey: string;
  /** Genannte Adresse (Straßen-ID, Hausnummer, Ort – Ort kann fehlen). */
  readonly streetId: number;
  readonly number: string;
  readonly townId: string | null;
  readonly toTownId: string | null;
  readonly callback: string;
  readonly ageGuess: number;
  readonly sex: 'm' | 'w';
  /** Anrufer schätzt die Lage schlimmer (+1) oder harmloser (-1) ein als sie ist. */
  readonly misjudge: -1 | 0 | 1;
}

export interface CallState {
  readonly id: string;
  readonly receivedAt: SimTime;
  status: 'waiting' | 'talking';
  acceptedAt?: SimTime;
  readonly truth: Truth;
  readonly report: CallerReport;
}

// ----------------------------------------------------------------------------- Einsätze

export type ErrorCode =
  | 'callAbandoned'
  | 'callClosedWithEmergency'
  | 'undertriage'
  | 'overtriage'
  | 'wrongLocation'
  | 'notNearestVehicle'
  | 'slowDispatch'
  | 'doctorLate'
  | 'unsuitableHospital'
  | 'destinationTimeout';

export type Outcome = 'gut' | 'beeintraechtigt' | 'verstorben' | 'keinPatient';

export interface IncidentState {
  readonly id: string;
  readonly callId: string;
  /** Eingang des Notrufs – Beginn der Hilfsfrist. */
  readonly receivedAt: SimTime;
  readonly createdAt: SimTime;
  keywordId: string;
  /** Vom Disponenten gewählte Adresse. */
  addressId: number;
  readonly truth: Truth;
  readonly report: CallerReport;
  status: 'open' | 'active' | 'closed';
  vehicleIds: string[];
  firstAlarmAt?: SimTime;
  firstArrivalAt?: SimTime;
  doctorArrivalAt?: SimTime;
  /** Erstbefund vor Ort ist bekannt (Diagnose/NACA für den Disponenten sichtbar). */
  assessed: boolean;
  doctorRequested: boolean;
  /** Seit wann ein (nachgeforderter) Notarzt auf Alarmierung wartet. */
  doctorNeededSince?: SimTime;
  /** War zu diesem Zeitpunkt ein Notarzt verfügbar? */
  doctorWasAvailable?: boolean;
  /** Adresse falsch, Rückruf läuft. */
  locating: boolean;
  treatmentDoneAt?: SimTime;
  hospitalId?: string;
  hospitalArrivalAt?: SimTime;
  closedAt?: SimTime;
  outcome?: Outcome;
  errors: ErrorCode[];
}

// ----------------------------------------------------------------------------- Fahrzeuge

export type VehicleTask =
  | 'idle'
  | 'turnout'
  | 'toScene'
  | 'onScene'
  | 'awaitDestination'
  | 'toHospital'
  | 'handover'
  | 'returning';

export interface RouteState {
  readonly nodes: readonly number[];
  readonly cumulativeMs: readonly number[];
  readonly startedAt: SimTime;
  readonly emergency: boolean;
}

export interface VehicleState {
  readonly id: string;
  readonly typeId: string;
  readonly stationId: string;
  readonly homeNode: number;
  status: FmsStatus;
  task: VehicleTask;
  /** Erhöht sich mit jeder neuen Aufgabe; geplante Ereignisse alter Aufgaben verfallen. */
  taskSeq: number;
  incidentId: string | null;
  /** Letzter bekannter Knoten (Standort oder zuletzt passierter Routenknoten). */
  node: number;
  route: RouteState | null;
  hospitalId: string | null;
  requestSince?: SimTime;
  /** Seit wann das Fahrzeug gebunden ist (für die Auslastung). */
  busySince?: SimTime;
  busyMs: number;
}

// ----------------------------------------------------------------------------- Auswertung

export interface ShiftStats {
  readonly index: number;
  readonly startedAt: SimTime;
  endedAt?: SimTime;
  callsReceived: number;
  callsAccepted: number;
  callsAbandoned: number;
  totalAnswerMs: number;
  incidents: number;
  /** Notfälle mit Hilfsfrist-Messung und davon eingehaltene. */
  hilfsfristMeasured: number;
  hilfsfristMet: number;
  totalResponseMs: number;
  outcomes: Record<Outcome, number>;
  errors: Partial<Record<ErrorCode, number>>;
  score: number;
  /** Gebundene Zeit je Fahrzeug in dieser Schicht (ms), gesetzt bei Schichtende. */
  vehicleBusyMs?: Record<string, number>;
}

/** Intern geplante Ereignisse. */
export type ScheduledPayload =
  | { readonly kind: 'call/abandon'; readonly callId: string }
  | { readonly kind: 'vehicle/turnoutDone'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/arrive'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/assessed'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/sceneDone'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/destTimeout'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/handoverDone'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'incident/callbackDone'; readonly incidentId: string }
  | { readonly kind: 'shift/end' };

/** Vollständiger, serialisierbarer Zustand. Enthält nur JSON-kompatible Werte. */
export interface SimState {
  time: SimTime;
  tick: number;
  nextId: number;
  calls: CallState[];
  incidents: IncidentState[];
  vehicles: VehicleState[];
  shift: ShiftStats;
  shiftHistory: ShiftStats[];
}

/** Befehle sind die einzige Möglichkeit, den Zustand von außen zu verändern. */
export type SimCommand =
  | { readonly type: 'call/accept'; readonly callId: string }
  | { readonly type: 'call/close'; readonly callId: string }
  | {
      readonly type: 'incident/create';
      readonly callId: string;
      readonly addressId: number;
      readonly keywordId: string;
    }
  | {
      readonly type: 'incident/dispatch';
      readonly incidentId: string;
      readonly vehicleIds: readonly string[];
    }
  | {
      readonly type: 'vehicle/assignDestination';
      readonly vehicleId: string;
      readonly hospitalId: string;
    }
  | { readonly type: 'vehicle/release'; readonly vehicleId: string };

export type RejectReason =
  | 'unknownCall'
  | 'callNotWaiting'
  | 'callNotTalking'
  | 'unknownAddress'
  | 'unknownKeyword'
  | 'unknownIncident'
  | 'incidentClosed'
  | 'unknownVehicle'
  | 'vehicleBusy'
  | 'notAwaitingDestination'
  | 'unknownHospital'
  | 'notReleasable';

/**
 * Ausgabe-Ereignisse. Keine Texte, nur Typ und Parameter; das UI übersetzt (CLAUDE.md, Regel 5).
 * Funkverkehr ist ein Ereignis mit Fahrzeug und Meldungsschlüssel.
 */
export type SimEvent =
  | { readonly type: 'call/incoming'; readonly at: SimTime; readonly callId: string }
  | {
      readonly type: 'call/accepted';
      readonly at: SimTime;
      readonly callId: string;
      readonly waitedMs: number;
    }
  | { readonly type: 'call/abandoned'; readonly at: SimTime; readonly callId: string }
  | { readonly type: 'call/closed'; readonly at: SimTime; readonly callId: string }
  | { readonly type: 'incident/created'; readonly at: SimTime; readonly incidentId: string }
  | {
      readonly type: 'incident/closed';
      readonly at: SimTime;
      readonly incidentId: string;
      readonly outcome: Outcome;
    }
  | {
      readonly type: 'radio';
      readonly at: SimTime;
      readonly vehicleId: string;
      readonly status: FmsStatus;
      readonly message: RadioMessage;
      readonly incidentId: string | null;
    }
  | {
      readonly type: 'command/rejected';
      readonly at: SimTime;
      readonly command: SimCommand['type'];
      readonly reason: RejectReason;
    }
  | { readonly type: 'shift/ended'; readonly at: SimTime; readonly index: number };

export type RadioMessage =
  | 'status'
  | 'alarmed'
  | 'arrived'
  | 'requestDoctor'
  | 'requestTransport'
  | 'doctorNotNeeded'
  | 'secondUnitNotNeeded'
  | 'requestDestination'
  | 'destinationSelf'
  | 'noTransport'
  | 'noPatient'
  | 'wrongLocation'
  | 'locationFound'
  | 'accompany'
  | 'released';

export interface LoggedCommand {
  /** Tick, nach dem der Befehl angewendet wurde (Spielzeit dieses Ticks). */
  readonly tick: number;
  readonly command: SimCommand;
}

/** Format-Version des Snapshots – bei inkompatiblen Änderungen erhöhen. */
export const SNAPSHOT_VERSION = 2;

export interface SimSnapshot {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly config: SimConfig;
  /** Prüfsumme der Inhalte, mit denen der Stand entstand. */
  readonly contentHash: string;
  readonly state: SimState;
  readonly rng: Readonly<Record<RngStreamName, RngState>>;
  readonly queue: {
    readonly nextSeq: number;
    readonly entries: readonly Scheduled<ScheduledPayload>[];
  };
  readonly pending: readonly SimCommand[];
}
