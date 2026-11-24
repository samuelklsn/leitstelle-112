/**
 * Ansicht für die Oberfläche. Enthält nur, was ein Disponent wissen kann: die *gemeldete* Lage,
 * Rückmeldungen der Einsatzkräfte und Fahrzeugpositionen. Die wahre Lage bleibt verborgen,
 * bis die Einsatzkräfte sie vor Ort erkennen (ADR-0014).
 */
import type { ContentBundle } from '@ls112/content';
import type { Simulation } from './simulation';
import { toCalendar, type CalendarTime, type SimTime } from './time';
import type {
  CallerKind,
  ErrorCode,
  FmsStatus,
  Outcome,
  ShiftStats,
  VehicleState,
  VehicleTask,
} from './types';
import { worldToMap, type WorldMap } from './world/geojson';

export interface ReportView {
  readonly kind: CallerKind;
  readonly reportKey: string;
  readonly streetId: number;
  readonly number: string;
  readonly townId: string | null;
  readonly toTownId: string | null;
  readonly callback: string;
  readonly ageGuess: number;
  readonly sex: 'm' | 'w';
  /** Gesprächston: aufgeregte Anrufer übertreiben, ruhige verharmlosen manchmal. */
  readonly tone: 'panic' | 'calm' | 'normal';
}

export interface CallView {
  readonly id: string;
  readonly receivedAt: SimTime;
  readonly status: 'waiting' | 'talking';
  readonly acceptedAt?: SimTime;
  /** Erst nach Annahme bekannt. */
  readonly report?: ReportView;
}

export interface FindingView {
  readonly diagnosisId: string;
  readonly naca: number;
  readonly needsDoctor: boolean;
  readonly transport: boolean;
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
  readonly doctorRequested: boolean;
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
}

export interface GameView {
  readonly time: SimTime;
  readonly calendar: CalendarTime;
  readonly tick: number;
  readonly calls: readonly CallView[];
  readonly incidents: readonly IncidentView[];
  readonly vehicles: readonly VehicleView[];
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
      ...(c.status === 'talking' ? { report: reportView(c.report) } : {}),
    })),
    incidents: s.incidents.map((i) => ({
      id: i.id,
      receivedAt: i.receivedAt,
      createdAt: i.createdAt,
      keywordId: i.keywordId,
      addressId: i.addressId,
      status: i.status,
      vehicleIds: [...i.vehicleIds],
      report: reportView(i.report),
      doctorRequested: i.doctorRequested,
      locating: i.locating,
      errors: [...i.errors],
      ...(i.assessed
        ? {
            finding: {
              diagnosisId: i.truth.diagnosisId,
              naca: i.truth.naca,
              needsDoctor: i.truth.needsDoctor,
              transport: i.truth.transport,
            },
          }
        : {}),
      ...(i.firstArrivalAt !== undefined ? { firstArrivalAt: i.firstArrivalAt } : {}),
      ...(i.hospitalId !== undefined ? { hospitalId: i.hospitalId } : {}),
      ...(i.closedAt !== undefined ? { closedAt: i.closedAt } : {}),
      ...(i.outcome !== undefined ? { outcome: i.outcome } : {}),
    })),
    vehicles: s.vehicles.map((v) => vehicleView(v, s.time, graph.x, graph.y)),
    shift: s.shift,
    lastShift: s.shiftHistory.at(-1) ?? null,
  };
}

function reportView(r: Simulation['raw']['calls'][number]['report']): ReportView {
  return {
    kind: r.kind,
    reportKey: r.reportKey,
    streetId: r.streetId,
    number: r.number,
    townId: r.townId,
    toTownId: r.toTownId,
    callback: r.callback,
    ageGuess: r.ageGuess,
    sex: r.sex,
    tone: r.misjudge > 0 ? 'panic' : r.misjudge < 0 ? 'calm' : 'normal',
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
    hilfsfrist: c.settings.hilfsfrist,
    shift: c.settings.shift,
  };
}
