/**
 * Ansicht für die Oberfläche. Enthält nur, was ein Disponent wissen kann: die *gemeldete* Lage,
 * Rückmeldungen der Einsatzkräfte und Fahrzeugpositionen. Die wahre Lage bleibt verborgen,
 * bis die Einsatzkräfte sie vor Ort erkennen (ADR-0014).
 */
import type { ContentBundle } from '@ls112/content';
import type { Simulation } from './simulation';
import { toCalendar, type CalendarTime, type SimTime } from './time';
import {
  QUESTIONS,
  type CallSource,
  type CallerKind,
  type CallerReport,
  type ErrorCode,
  type FmsStatus,
  type Outcome,
  type Question,
  type ServiceReason,
  type ShiftStats,
  type VehicleState,
  type VehicleTask,
} from './types';
import { worldToMap, type WorldMap } from './world/geojson';

/**
 * Was der Disponent vom Anrufer weiß. Felder erscheinen erst, wenn die passende Frage beantwortet
 * ist – Stimme, Ton und Art des Anrufers hört man dagegen sofort.
 */
export interface ReportView {
  readonly kind: CallerKind;
  /** Gesprächston: aufgeregte Anrufer übertreiben, ruhige verharmlosen manchmal. */
  readonly tone: 'panic' | 'calm' | 'normal';
  /** Am anderen Ende ist nur Stille oder Rauschen (Hosentaschenanruf). */
  readonly silent: boolean;
  /** Der Anrufer kichert, im Hintergrund wird gelacht. */
  readonly giggling: boolean;
  readonly address?: {
    readonly streetId: number;
    readonly number: string;
    readonly townId: string | null;
    readonly toTownId: string | null;
  };
  readonly reportKey?: string;
  readonly patient?: { readonly ageGuess: number; readonly sex: 'm' | 'w' };
  readonly conscious?: CallerReport['conscious'];
  readonly breathing?: CallerReport['breathing'];
  /** Leer bei unterdrückter Nummer. */
  readonly callback?: string;
}

export interface CallView {
  readonly id: string;
  readonly receivedAt: SimTime;
  readonly status: 'waiting' | 'talking';
  readonly acceptedAt?: SimTime;
  readonly source: CallSource;
  /** Beantwortete und noch offene Fragen der Abfrage. */
  readonly answered: readonly Question[];
  readonly asked: readonly Question[];
  /** Erst nach Annahme bekannt. */
  readonly report?: ReportView;
}

export interface FindingView {
  /** Leer, wenn es keinen Patienten gibt. */
  readonly diagnosisId: string;
  readonly patient: boolean;
  /** Feuerwehrlage laut Lagemeldung (kann sich ausbreiten). */
  readonly fireScenarioId?: string;
  readonly fireDone?: boolean;
  readonly naca: number;
  readonly needsDoctor: boolean;
  readonly transport: boolean;
  /** Infektionsverdacht: Das Transportmittel muss danach desinfiziert werden. */
  readonly infectious: boolean;
}

/** Transportauftrag, wie ihn die Leitstelle angenommen hat (ADR-0015). */
export interface OrderView {
  readonly templateId: string;
  readonly dueAt: SimTime;
  readonly fromHospitalId?: string;
  readonly toHospitalId?: string;
  readonly toAddressId?: number;
  readonly pickedUpAt?: SimTime;
  readonly infectious: boolean;
}

export interface IncidentView {
  readonly id: string;
  readonly receivedAt: SimTime;
  readonly createdAt: SimTime;
  readonly keywordId: string;
  readonly addressId: number;
  readonly status: 'open' | 'active' | 'closed';
  readonly vehicleIds: readonly string[];
  readonly report: ReportView;
  readonly order?: OrderView;
  readonly doctorRequested: boolean;
  /** Laut Lage fehlen noch Kräfte (Nachforderung). */
  readonly unitsMissing: boolean;
  readonly locating: boolean;
  readonly finding?: FindingView;
  readonly firstArrivalAt?: SimTime;
  readonly hospitalId?: string;
  readonly closedAt?: SimTime;
  readonly outcome?: Outcome;
  readonly errors: readonly ErrorCode[];
}

export interface VehicleView {
  readonly id: string;
  readonly status: FmsStatus;
  readonly task: VehicleTask;
  readonly incidentId: string | null;
  readonly hospitalId: string | null;
  readonly requestSince?: SimTime;
  /** Position in lokalen Metern. */
  readonly x: number;
  readonly y: number;
  readonly moving: boolean;
  readonly emergency: boolean;
  /** Ankunftszeit am aktuellen Fahrtziel. */
  readonly etaAt?: SimTime;
  /** Außer Dienst mit Grund (FMS 6). */
  readonly service?: { readonly reason: ServiceReason; readonly until?: SimTime };
  /** Laut Dienstplan besetzt. */
  readonly onDuty: boolean;
  /** Die Besatzung hat eine Pause beantragt. */
  readonly breakRequested: boolean;
  /** Tankfüllung in Prozent. */
  readonly fuelPercent: number;
}

export interface DepartmentView {
  readonly department: string;
  /** Freie Aufnahmeplätze (undefined = ohne Kapazitätsgrenze). */
  readonly free?: number;
  readonly capacity?: number;
  readonly open: boolean;
  /** Abgemeldet wegen Geräteausfall bis … */
  readonly closedUntil?: SimTime;
}

export interface HospitalView {
  readonly id: string;
  readonly departments: readonly DepartmentView[];
}

export interface GameView {
  readonly time: SimTime;
  readonly calendar: CalendarTime;
  readonly tick: number;
  readonly calls: readonly CallView[];
  readonly incidents: readonly IncidentView[];
  readonly vehicles: readonly VehicleView[];
  readonly hospitals: readonly HospitalView[];
  readonly shift: ShiftStats;
  readonly lastShift: ShiftStats | null;
}

export function buildView(sim: Simulation): GameView {
  const s = sim.raw;
  const graph = sim.world.graph;
  return {
    time: s.time,
    calendar: toCalendar(s.time),
    tick: s.tick,
    calls: s.calls.map((c) => ({
      id: c.id,
      receivedAt: c.receivedAt,
      status: c.status,
      ...(c.acceptedAt !== undefined ? { acceptedAt: c.acceptedAt } : {}),
      source: c.source,
      answered: [...c.answered],
      asked: [...c.asked],
      ...(c.status === 'talking'
        ? { report: reportView(c.report, c.answered, c.kind === 'misdial', c.kind === 'prank') }
        : {}),
    })),
    incidents: s.incidents.map((i) => ({
      id: i.id,
      receivedAt: i.receivedAt,
      createdAt: i.createdAt,
      keywordId: i.keywordId,
      addressId: i.addressId,
      status: i.status,
      vehicleIds: [...i.vehicleIds],
      report: reportView(i.report, QUESTIONS, false, false),
      ...(i.order
        ? {
            order: {
              templateId: i.order.templateId,
              dueAt: i.order.dueAt,
              ...(i.order.fromHospitalId !== undefined
                ? { fromHospitalId: i.order.fromHospitalId }
                : {}),
              ...(i.order.toHospitalId !== undefined ? { toHospitalId: i.order.toHospitalId } : {}),
              ...(i.order.toAddressId !== undefined ? { toAddressId: i.order.toAddressId } : {}),
              ...(i.order.pickedUpAt !== undefined ? { pickedUpAt: i.order.pickedUpAt } : {}),
              // Isolationspflicht steht im Transportschein – beim Auftrag bekannt.
              infectious: i.truth.infectious,
            },
          }
        : {}),
      doctorRequested: i.doctorRequested,
      unitsMissing: i.assessed && i.status !== 'closed' && sim.missingNeeds(i.id).length > 0,
      locating: i.locating,
      errors: [...i.errors],
      ...(i.assessed
        ? {
            finding: {
              diagnosisId: i.truth.diagnosisId,
              patient: i.truth.patient,
              ...(i.truth.fire
                ? { fireScenarioId: i.truth.fire.scenarioId, fireDone: i.truth.fire.done }
                : {}),
              naca: i.truth.naca,
              needsDoctor: i.truth.needsDoctor,
              transport: i.truth.transport,
              infectious: i.truth.infectious,
            },
          }
        : {}),
      ...(i.firstArrivalAt !== undefined ? { firstArrivalAt: i.firstArrivalAt } : {}),
      ...(i.hospitalId !== undefined ? { hospitalId: i.hospitalId } : {}),
      ...(i.closedAt !== undefined ? { closedAt: i.closedAt } : {}),
      ...(i.outcome !== undefined ? { outcome: i.outcome } : {}),
    })),
    vehicles: s.vehicles.map((v) => vehicleView(v, s.time, graph.x, graph.y)),
    hospitals: sim.content.bundle.hospitals.map((h) => {
      const hs = s.hospitals[h.id];
      return {
        id: h.id,
        departments: h.departments.map((dept): DepartmentView => {
          const cap = h.beds[dept];
          const free = hs?.free[dept];
          const closed = hs?.closedUntil[dept];
          const closedNow = closed !== undefined && closed > s.time;
          return {
            department: dept,
            ...(free !== undefined ? { free } : {}),
            ...(cap !== undefined ? { capacity: cap } : {}),
            open: !closedNow && (free === undefined || free > 0),
            ...(closedNow ? { closedUntil: closed } : {}),
          };
        }),
      };
    }),
    shift: s.shift,
    lastShift: s.shiftHistory.at(-1) ?? null,
  };
}

function reportView(
  r: CallerReport,
  answered: readonly Question[],
  silent: boolean,
  giggling: boolean,
): ReportView {
  const has = (q: Question) => answered.includes(q);
  return {
    kind: r.kind,
    tone: r.misjudge > 0 ? 'panic' : r.misjudge < 0 ? 'calm' : 'normal',
    silent,
    giggling,
    ...(has('where') && !silent
      ? {
          address: {
            streetId: r.streetId,
            number: r.number,
            townId: r.townId,
            toTownId: r.toTownId,
          },
        }
      : {}),
    ...(has('what') ? { reportKey: r.reportKey } : {}),
    ...(has('who') && !silent ? { patient: { ageGuess: r.ageGuess, sex: r.sex } } : {}),
    ...(has('conscious') && !silent ? { conscious: r.conscious } : {}),
    ...(has('breathing') && !silent ? { breathing: r.breathing } : {}),
    ...(has('callback') ? { callback: r.callback } : {}),
  };
}

/** Position eines Fahrzeugs entlang seiner Route (lineare Interpolation zwischen Knoten). */
export function vehicleView(
  v: VehicleState,
  time: SimTime,
  xs: Float64Array,
  ys: Float64Array,
): VehicleView {
  let x = xs[v.node] ?? 0;
  let y = ys[v.node] ?? 0;
  let moving = false;
  let etaAt: number | undefined;
  if (v.route && v.route.nodes.length > 1) {
    const elapsed = time - v.route.startedAt;
    const cum = v.route.cumulativeMs;
    const total = cum.at(-1) ?? 0;
    etaAt = v.route.startedAt + total;
    if (elapsed >= total) {
      const last = v.route.nodes.at(-1) ?? v.node;
      x = xs[last] ?? x;
      y = ys[last] ?? y;
    } else {
      moving = true;
      let i = 0;
      while (i + 1 < cum.length && (cum[i + 1] ?? 0) <= elapsed) i++;
      const a = v.route.nodes[i] ?? v.node;
      const b = v.route.nodes[i + 1] ?? a;
      const t0 = cum[i] ?? 0;
      const t1 = cum[i + 1] ?? t0;
      const f = t1 > t0 ? (elapsed - t0) / (t1 - t0) : 0;
      x = (xs[a] ?? 0) + ((xs[b] ?? 0) - (xs[a] ?? 0)) * f;
      y = (ys[a] ?? 0) + ((ys[b] ?? 0) - (ys[a] ?? 0)) * f;
    }
  }
  return {
    id: v.id,
    status: v.status,
    task: v.task,
    incidentId: v.incidentId,
    hospitalId: v.hospitalId,
    ...(v.requestSince !== undefined ? { requestSince: v.requestSince } : {}),
    x,
    y,
    moving,
    emergency: v.route?.emergency ?? false,
    ...(etaAt !== undefined ? { etaAt } : {}),
    ...(v.service
      ? {
          service: {
            reason: v.service.reason,
            ...(v.service.until !== undefined ? { until: v.service.until } : {}),
          },
        }
      : {}),
    onDuty: v.onDuty,
    breakRequested: v.breakRequestedAt !== undefined,
    fuelPercent: Math.round(v.fuel * 100),
  };
}

// ----------------------------------------------------------------------------- Statische Welt

export interface StaticAddress {
  readonly id: number;
  readonly kind: 'house' | 'road';
  readonly streetId: number;
  readonly number: string;
  readonly townId: string;
  readonly toTownId?: string;
  readonly x: number;
  readonly y: number;
}

/** Unveränderliche Daten für die Oberfläche – einmal je Fenster übertragen. */
export interface WorldInfo {
  readonly regionName: string;
  readonly centerName: string;
  readonly geo: ContentBundle['region']['geo'];
  readonly map: WorldMap;
  readonly towns: readonly { id: string; name: string; x: number; y: number }[];
  readonly streets: readonly { id: number; name: string; townId: string | null }[];
  readonly addresses: readonly StaticAddress[];
  readonly vehicleTypes: ContentBundle['vehicleTypes'];
  readonly stations: ContentBundle['stations'];
  readonly hospitals: ContentBundle['hospitals'];
  readonly keywords: ContentBundle['keywords'];
  readonly diagnoses: readonly { id: string; name: string }[];
  readonly fireScenarios: readonly { id: string; name: string; kind: 'brand' | 'th' }[];
  readonly transportOrders: readonly { id: string; name: string }[];
  readonly hilfsfrist: ContentBundle['settings']['hilfsfrist'];
  readonly shift: ContentBundle['settings']['shift'];
}

export function buildWorldInfo(sim: Simulation): WorldInfo {
  const c = sim.content.bundle;
  return {
    regionName: c.region.name,
    centerName: c.region.center,
    geo: c.region.geo,
    map: worldToMap(sim.world),
    towns: sim.world.towns.map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y })),
    streets: sim.world.streets.map((s) => ({ id: s.id, name: s.name, townId: s.townId })),
    addresses: sim.world.addresses.map((a) => ({
      id: a.id,
      kind: a.kind,
      streetId: a.streetId,
      number: a.number,
      townId: a.townId,
      ...(a.toTownId !== undefined ? { toTownId: a.toTownId } : {}),
      x: Math.round(a.x),
      y: Math.round(a.y),
    })),
    vehicleTypes: c.vehicleTypes,
    stations: c.stations,
    hospitals: c.hospitals,
    keywords: c.keywords,
    diagnoses: c.diagnoses.map((d) => ({ id: d.id, name: d.name })),
    fireScenarios: c.fireScenarios.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    transportOrders: c.transportOrders.map((o) => ({ id: o.id, name: o.name })),
    hilfsfrist: c.settings.hilfsfrist,
    shift: c.settings.shift,
  };
}
