import type { RngState } from './rng';
import type { Scheduled } from './event-queue';
import type { SimTime } from './time';

/** Namen der Zufalls-Streams. Neue Subsysteme bekommen einen eigenen Namen (ADR-0004). */
export const RNG_STREAMS = [
  'calls',
  'callers',
  'patients',
  'crews',
  'outcome',
  'logistics',
  'hospitals',
  'orders',
  'world',
] as const;
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
  /** MANV-Übung: Der erste Notruf meldet eine Großlage (ADR-0017). */
  readonly drill?: boolean;
  /** Trainingsszenario aus den Inhalten (ADR-0019). */
  readonly scenarioId?: string;
  /** Hilfsfrist-Regel eines Landes statt der Vorgabe der Region (#32). */
  readonly hilfsfristPreset?: string;
}

/** FMS-Status (Fahrzeugstatus-Meldesystem). */
export type FmsStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// ----------------------------------------------------------------------------- Anrufe

export type CallerKind = 'self' | 'relative' | 'neighbor' | 'passerby' | 'caregiver';

/** Die verborgene, tatsächliche Lage hinter einem Notruf (ADR-0014, „wahre Lage"). */
/** Feuerwehrlage hinter einem Notruf; ändert sich, wenn sie sich ausbreitet. */
export interface FireTruth {
  scenarioId: string;
  /** Lage beim Notruf – Maßstab für die Stichwortwahl. */
  readonly originalScenarioId: string;
  escalations: number;
  /** Abarbeitung läuft bis … (gesetzt, sobald alle nötigen Kräfte vor Ort sind). */
  workUntil?: SimTime;
  done: boolean;
}

/** Sichtungskategorie: 1 rot (sofort), 2 gelb (dringend), 3 grün (leicht), 4 tot bzw. ohne Chance. */
export type TriageCategory = 1 | 2 | 3 | 4;

/** Ein Betroffener einer Großlage (ADR-0017). */
export interface MciPatient {
  readonly id: string;
  readonly triage: TriageCategory;
  readonly diagnosisId: string;
  readonly needsTransport: boolean;
  state: 'waiting' | 'loading' | 'transport' | 'delivered' | 'onSite' | 'deceased';
  vehicleId?: string;
  hospitalId?: string;
  deliveredAt?: SimTime;
}

/** Wahre Lage eines Massenanfalls von Verletzten. */
export interface MciTruth {
  readonly scenarioId: string;
  readonly patients: MciPatient[];
  /** Sichtung abgeschlossen (Kategorien für den Disponenten sichtbar). */
  triagedAt?: SimTime;
  /** Sichtung fertig ab … (wird früher, wenn ein Arzt eintrifft). */
  triageDue?: SimTime;
  /** Patientenverteilung übernimmt die Einsatzleitung nach Kapazität. */
  autoDistribute: boolean;
  /** Bereitstellungsraum: Fahrzeuge werden einzeln abgerufen, kein Stau an der Einsatzstelle. */
  staging: boolean;
  /** Leichtverletzte werden vor Ort versorgt ab … */
  onSiteDue?: SimTime;
}

export interface Truth {
  /** Krankheitsbild – leer, wenn es (bei Feuerwehrlagen) keinen Patienten gibt. */
  readonly diagnosisId: string;
  readonly addressId: number;
  /** Gibt es einen Patienten? (Fehlt bei Ölspur, Mülleimerbrand …) */
  readonly patient: boolean;
  readonly age: number;
  readonly sex: 'm' | 'w';
  /** Kann sich bis zum Eintreffen verschlechtern (Lageentwicklung). */
  naca: number;
  needsDoctor: boolean;
  readonly transport: boolean;
  readonly onSceneMs: number;
  /** Infektion: Das transportierende Fahrzeug muss danach desinfiziert werden. */
  readonly infectious: boolean;
  readonly fire?: FireTruth;
  readonly mci?: MciTruth;
  /** Gefahr für Einsatzkräfte (Gewalt, Waffen) – ohne Polizei wird gewartet (ADR-0018). */
  readonly danger?: boolean;
  /** Notruf einer bekannten Person (Vielanrufer, Stammpatient, Gefahrenadresse). */
  readonly personId?: string;
}

/** Wiederkehrende Person im Bereich (ADR-0018). */
export interface PersonState {
  readonly id: string;
  readonly kind: 'frequent' | 'regular' | 'danger';
  readonly addressId: number;
  readonly callback: string;
  readonly diagnosisId: string;
  calls: number;
}

/** Was die Leitstelle über eine Adresse weiß (Einsatzhistorie). */
export interface AddressHistory {
  count: number;
  lastAt: SimTime;
  /** Letzte Stichworte (neueste zuerst). */
  keywords: string[];
  /** Hinweise wie Gefahr für Einsatzkräfte. */
  flags: ('danger' | 'frequent')[];
}

/** Laufbahn und Bedarfsplanung (ADR-0018). */
export interface CareerState {
  rank: number;
  xp: number;
  budget: number;
  shifts: number;
  /** Bewilligte Fahrzeuge aus der Bedarfsplanung. */
  extraVehicles: {
    readonly id: string;
    readonly stationId: string;
    readonly typeId: string;
    readonly callsign: string;
    readonly service?: { readonly from: number; readonly to: number };
  }[];
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
  /** Rückrufnummer; leer bei unterdrückter Nummer. */
  readonly callback: string;
  readonly ageGuess: number;
  readonly sex: 'm' | 'w';
  /** Anrufer schätzt die Lage schlimmer (+1) oder harmloser (-1) ein als sie ist. */
  readonly misjudge: -1 | 0 | 1;
  /** Antwort auf „Ist die Person ansprechbar?" */
  readonly conscious: 'yes' | 'no' | 'unclear' | 'nobody';
  /** Antwort auf „Atmet die Person normal?" */
  readonly breathing: 'normal' | 'difficult' | 'none' | 'unclear' | 'nobody';
  /** Der Anrufer erwähnt Aggression oder Waffen (Hinweis auf Eigensicherung). */
  readonly aggressive?: boolean;
}

/**
 * Art des Anrufs (ADR-0014): Nicht jeder Notruf ist ein Notfall. Der Disponent muss Fehl-,
 * Scherz- und Auskunftsanrufe erkennen und Doppelmeldungen dem bestehenden Einsatz zuordnen.
 */
export type CallKind = 'emergency' | 'duplicate' | 'misdial' | 'prank' | 'info';

/** Woher der Anruf kommt: Notruf 112 oder Übergabe der Polizei (110). */
export type CallSource = '112' | '110';

/** Fragen der strukturierten Notrufabfrage. */
export const QUESTIONS = ['where', 'what', 'who', 'conscious', 'breathing', 'callback'] as const;
export type Question = (typeof QUESTIONS)[number];

export interface CallState {
  readonly id: string;
  readonly receivedAt: SimTime;
  status: 'waiting' | 'talking';
  acceptedAt?: SimTime;
  readonly kind: CallKind;
  readonly source: CallSource;
  /** Bei Doppelmeldungen: der bereits bestehende Einsatz. */
  readonly duplicateOf?: string;
  readonly truth: Truth;
  readonly report: CallerReport;
  /** Bereits beantwortete Fragen. */
  answered: Question[];
  /** Gestellte, noch unbeantwortete Fragen (der Anrufer antwortet nacheinander). */
  asked: Question[];
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
  | 'destinationTimeout'
  | 'duplicateIncident'
  | 'prankDispatched'
  | 'nonEmergencyDispatched'
  | 'fireSpread'
  | 'transportLate'
  | 'hospitalClosed'
  | 'breakMissed'
  | 'unsuitableTransport'
  | 'mciOverload'
  | 'policeNotRequested';

export type Outcome = 'gut' | 'beeintraechtigt' | 'verstorben' | 'keinPatient';

/** Transportauftrag (Krankentransport, Verlegung) – ADR-0015. */
export interface TransportOrderState {
  readonly templateId: string;
  /** Abholtermin. */
  readonly dueAt: SimTime;
  readonly fromHospitalId?: string;
  readonly toHospitalId?: string;
  /** Ziel ohne Klinik: Wohnadresse (Entlassung). */
  readonly toAddressId?: number;
  readonly handoverMs: number;
  /** Patient übernommen, Transport läuft. */
  pickedUpAt?: SimTime;
}

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
  /** Art des zugrunde liegenden Anrufs (Scherzanruf, Doppelmeldung …) oder Transportauftrag. */
  readonly callKind: CallKind | 'order';
  readonly order?: TransportOrderState;
  /** Doppelt angelegt: dieser Einsatz existierte schon. */
  readonly duplicateOf?: string;
  status: 'open' | 'active' | 'closed';
  vehicleIds: string[];
  firstAlarmAt?: SimTime;
  /** Erstes Fahrzeug rückt aus (Status 3) – Messbeginn bei reiner Fahrzeit. */
  firstDepartureAt?: SimTime;
  firstArrivalAt?: SimTime;
  /** Eintreffen des ersten Feuerwehrfahrzeugs (Hilfsfrist Feuerwehr). */
  firstFireArrivalAt?: SimTime;
  doctorArrivalAt?: SimTime;
  /** Erstbefund vor Ort ist bekannt (Diagnose/NACA für den Disponenten sichtbar). */
  assessed: boolean;
  doctorRequested: boolean;
  /** Polizei zur Eigensicherung verständigt. */
  policeRequested?: boolean;
  /** Bei der Anlage bekannt: Gefahrenadresse laut Historie oder Hinweis des Anrufers. */
  knownDanger?: boolean;
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
  | 'returning'
  /** Außer Dienst (FMS 6): auf dem Weg zur Wache bzw. dort (Desinfektion, Pause …). */
  | 'toService'
  | 'service';

/** Warum ein Fahrzeug außer Dienst ist. */
export type ServiceReason =
  | 'disinfection'
  | 'defect'
  | 'refuel'
  | 'break'
  | 'offDuty'
  /** Luftrettung: kein Flugwetter. */
  | 'weather'
  /** Luftrettung: Einsatz außerhalb des Leitstellenbereichs. */
  | 'external';

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
  /** Tankfüllung 0 … 1. */
  fuel: number;
  /** Außer Dienst mit Grund; `until` fehlt, solange das Ende offen ist (Dienstende). */
  service?: { reason: ServiceReason; since: SimTime; until?: SimTime };
  /** Laut Dienstplan besetzt. */
  onDuty: boolean;
  /** Dienstbeginn der aktuellen Besatzung. */
  crewSince: SimTime;
  breakTakenMs: number;
  breakRequestedAt?: SimTime;
  /** Dienstende während eines Einsatzes: Überstunden laufen seit … */
  overtimeSince?: SimTime;
  /** Großlage: Patient, den dieses Fahrzeug versorgt bzw. transportiert. */
  mciPatientId?: string;
}

/** Laufendes Ereignis der Weltlage (ADR-0016). */
export interface WorldEventState {
  readonly key: string;
  readonly eventId: string;
  readonly startedAt: SimTime;
  readonly until: SimTime;
  readonly townId?: string;
  /** Gesperrter Straßenabschnitt (beide Fahrtrichtungen). */
  readonly closure?: {
    readonly edges: readonly number[];
    readonly streetId: number;
    readonly x: number;
    readonly y: number;
  };
}

/** Wetter, Ereignisse und Einsatz-Regie (ADR-0016). */
export interface WorldState {
  weatherId: string;
  /** Temperatur in °C. */
  temperature: number;
  weatherUntil: SimTime;
  events: WorldEventState[];
  /** Einsatz-Regie: Faktor wandert in der Phase linear von `from` nach `to`. */
  director: { from: number; to: number; phaseStart: SimTime; phaseEnd: SimTime };
}

/** Aufnahmebereitschaft einer Klinik je Fachabteilung (ADR-0015). */
export interface HospitalState {
  /** Freie Aufnahmeplätze je Abteilung (nur Abteilungen mit Kapazität). */
  free: Record<string, number>;
  /** Kurzfristig abgemeldet bis … (Geräteausfall). */
  closedUntil: Record<string, SimTime>;
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
  /** Feuerwehr: gemessene und eingehaltene Eintreffzeiten. */
  fireMeasured: number;
  fireMet: number;
  /** Transportaufträge: eingegangen, abgeschlossen, pünktlich abgeholt. */
  ordersReceived: number;
  ordersDone: number;
  ordersOnTime: number;
  /** Überstunden der Besatzungen (ms). */
  overtimeMs: number;
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
  | { readonly kind: 'call/answer'; readonly callId: string }
  | { readonly kind: 'vehicle/turnoutDone'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/arrive'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/assessed'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/sceneDone'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/destTimeout'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/handoverDone'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'vehicle/serviceDone'; readonly vehicleId: string; readonly seq: number }
  | { readonly kind: 'hospital/update' }
  | { readonly kind: 'hospital/reopen'; readonly hospitalId: string; readonly department: string }
  | { readonly kind: 'order/expire'; readonly incidentId: string }
  | { readonly kind: 'world/weather' }
  | { readonly kind: 'world/director' }
  | { readonly kind: 'world/eventEnd'; readonly key: string }
  | { readonly kind: 'mci/triage'; readonly incidentId: string }
  | { readonly kind: 'scenario/call'; readonly index: number }
  | { readonly kind: 'mci/onSite'; readonly incidentId: string }
  | { readonly kind: 'incident/callbackDone'; readonly incidentId: string }
  | { readonly kind: 'shift/end' }
  | { readonly kind: 'fire/escalate'; readonly callId: string }
  | { readonly kind: 'fire/done'; readonly incidentId: string; readonly escalations: number };

/** Vollständiger, serialisierbarer Zustand. Enthält nur JSON-kompatible Werte. */
export interface SimState {
  time: SimTime;
  tick: number;
  nextId: number;
  calls: CallState[];
  incidents: IncidentState[];
  vehicles: VehicleState[];
  hospitals: Record<string, HospitalState>;
  world: WorldState;
  career: CareerState;
  persons: PersonState[];
  addressHistory: Record<string, AddressHistory>;
  shift: ShiftStats;
  shiftHistory: ShiftStats[];
}

/** Befehle sind die einzige Möglichkeit, den Zustand von außen zu verändern. */
export type SimCommand =
  | { readonly type: 'call/accept'; readonly callId: string }
  | { readonly type: 'call/close'; readonly callId: string }
  | { readonly type: 'call/ask'; readonly callId: string; readonly question: Question }
  | { readonly type: 'call/link'; readonly callId: string; readonly incidentId: string }
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
  | { readonly type: 'vehicle/release'; readonly vehicleId: string }
  /** Beantragte Pause genehmigen. */
  | { readonly type: 'vehicle/break'; readonly vehicleId: string }
  /** Pause vorzeitig beenden – das Fahrzeug ist sofort wieder einsatzbereit. */
  | { readonly type: 'vehicle/resume'; readonly vehicleId: string }
  /** Großlage: Patientenverteilung automatisch nach Kapazität (ADR-0017). */
  | { readonly type: 'mci/autoDistribute'; readonly incidentId: string; readonly on: boolean }
  /** Großlage: Bereitstellungsraum einrichten bzw. auflösen. */
  | { readonly type: 'mci/staging'; readonly incidentId: string; readonly on: boolean }
  /** Polizei zur Eigensicherung verständigen (ADR-0018). */
  | { readonly type: 'incident/police'; readonly incidentId: string }
  /** Bedarfsplanung: zusätzliches Fahrzeug an einer Wache beantragen. */
  | {
      readonly type: 'planning/request';
      readonly stationId: string;
      readonly kind: 'rtw' | 'rtwDay' | 'ktw' | 'nef';
    };

export type RejectReason =
  | 'unknownCall'
  | 'callNotWaiting'
  | 'callNotTalking'
  | 'lineBusy'
  | 'unknownAddress'
  | 'unknownKeyword'
  | 'unknownIncident'
  | 'incidentClosed'
  | 'unknownVehicle'
  | 'vehicleBusy'
  | 'notAwaitingDestination'
  | 'unknownHospital'
  | 'notReleasable'
  | 'noBreakDue'
  | 'notOnBreak'
  | 'notMci'
  | 'unknownStation'
  | 'noBudget'
  | 'notJustified';

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
  | {
      readonly type: 'call/answer';
      readonly at: SimTime;
      readonly callId: string;
      readonly question: Question;
    }
  | {
      readonly type: 'call/linked';
      readonly at: SimTime;
      readonly callId: string;
      readonly incidentId: string;
    }
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
  | { readonly type: 'shift/ended'; readonly at: SimTime; readonly index: number }
  | {
      readonly type: 'hospital/status';
      readonly at: SimTime;
      readonly hospitalId: string;
      readonly department: string;
      readonly open: boolean;
      /** Abmeldung wegen Belegung oder Geräteausfall. */
      readonly reason: 'full' | 'closure';
    }
  | { readonly type: 'world/weather'; readonly at: SimTime; readonly weatherId: string }
  | { readonly type: 'career/promoted'; readonly at: SimTime; readonly rank: number }
  | {
      readonly type: 'planning/approved';
      readonly at: SimTime;
      readonly vehicleId: string;
      readonly stationId: string;
    }
  | {
      readonly type: 'world/event';
      readonly at: SimTime;
      readonly eventId: string;
      readonly started: boolean;
      readonly townId?: string;
      readonly streetId?: number;
    };

export type RadioMessage =
  | 'status'
  | 'alarmed'
  | 'arrived'
  | 'requestDoctor'
  | 'requestTransport'
  | 'alreadyHandled'
  | 'fireReport'
  | 'requestUnits'
  | 'fireUnderControl'
  | 'fireSpread'
  | 'doctorNotNeeded'
  | 'secondUnitNotNeeded'
  | 'requestDestination'
  | 'destinationSelf'
  | 'noTransport'
  | 'noPatient'
  | 'wrongLocation'
  | 'locationFound'
  | 'accompany'
  | 'released'
  | 'patientPickedUp'
  | 'disinfection'
  | 'disinfected'
  | 'defect'
  | 'repaired'
  | 'refuel'
  | 'refueled'
  | 'requestBreak'
  | 'breakStart'
  | 'breakEnd'
  | 'offDuty'
  | 'onDuty'
  | 'grounded'
  | 'flyable'
  | 'externalMission'
  | 'externalBack'
  | 'mciReport'
  | 'triageDone'
  | 'patientLoaded'
  | 'greenTreated'
  | 'stagingReady'
  | 'waitingForPolice'
  | 'policeOnScene';

export interface LoggedCommand {
  /** Tick, nach dem der Befehl angewendet wurde (Spielzeit dieses Ticks). */
  readonly tick: number;
  readonly command: SimCommand;
}

/** Format-Version des Snapshots – bei inkompatiblen Änderungen erhöhen. */
export const SNAPSHOT_VERSION = 6;

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
