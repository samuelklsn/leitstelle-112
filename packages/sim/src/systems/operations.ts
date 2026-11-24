import { UNREACHABLE } from '@ls112/routing';
import { rangeInt, travelContext, type Ctx } from '../context';
import { MS_PER_MINUTE, toCalendar, type SimTime } from '../time';
import type {
  ErrorCode,
  FmsStatus,
  IncidentState,
  RadioMessage,
  RejectReason,
  RouteState,
  VehicleState,
  VehicleTask,
} from '../types';
import { countError } from './calls';
import { closeIncident } from './outcome';

/** Ab dieser Abweichung finden die Einsatzkräfte den Patienten nicht ohne Rückruf (m). */
const FIND_RADIUS_M = 150;
/** Erstbefund nach Eintreffen (Sekunden). */
const ASSESSMENT_SECONDS: readonly [number, number] = [90, 210];
/** Ein angeforderter Notarzt braucht nach Eintreffen noch so lange bis zur Transportfähigkeit. */
const DOCTOR_TREATMENT_MS = 10 * MS_PER_MINUTE;
/** Übergabe NEF/Notarzt in der Klinik (Minuten). */
const DOCTOR_HANDOVER_MINUTES: readonly [number, number] = [8, 12];
/** Ein anderes Fahrzeug wäre mindestens so viel schneller gewesen → Dispositionsfehler. */
const NEAREST_TOLERANCE_MS = 3 * MS_PER_MINUTE;
/** Zwischen Einsatzanlage und Alarmierung sollte nicht mehr Zeit vergehen. */
const DISPATCH_TARGET_MS = 2 * MS_PER_MINUTE;

// ---------------------------------------------------------------------------- Hilfsfunktionen

export function findIncident(ctx: Ctx, id: string): IncidentState | undefined {
  return ctx.state.incidents.find((i) => i.id === id);
}

export function findVehicle(ctx: Ctx, id: string): VehicleState | undefined {
  return ctx.state.vehicles.find((v) => v.id === id);
}

export function isDoctor(ctx: Ctx, v: VehicleState): boolean {
  return ctx.content.doctorTypes.has(v.typeId);
}

export function canTransport(ctx: Ctx, v: VehicleState): boolean {
  return ctx.content.vehicleTypes.get(v.typeId)?.canTransport ?? false;
}

export function isAvailable(v: VehicleState): boolean {
  return v.incidentId === null && (v.status === 1 || v.status === 2);
}

function radio(ctx: Ctx, v: VehicleState, message: RadioMessage): void {
  ctx.emit({
    type: 'radio',
    at: ctx.state.time,
    vehicleId: v.id,
    status: v.status,
    message,
    incidentId: v.incidentId,
  });
}

function setStatus(
  ctx: Ctx,
  v: VehicleState,
  status: FmsStatus,
  message: RadioMessage = 'status',
): void {
  v.status = status;
  radio(ctx, v, message);
}

function newTask(v: VehicleState, task: VehicleTask): number {
  v.task = task;
  v.taskSeq++;
  return v.taskSeq;
}

/** Knoten, an dem sich ein fahrendes Fahrzeug gerade befindet (zuletzt passierter Knoten). */
export function currentNode(v: VehicleState, time: SimTime): number {
  if (!v.route) return v.node;
  const elapsed = time - v.route.startedAt;
  let node = v.route.nodes[0] ?? v.node;
  for (let i = 0; i < v.route.nodes.length; i++) {
    if ((v.route.cumulativeMs[i] ?? 0) <= elapsed) node = v.route.nodes[i] ?? node;
    else break;
  }
  return node;
}

export function incidentNode(ctx: Ctx, incident: IncidentState): number {
  return ctx.world.addresses[incident.addressId]?.node ?? 0;
}

/**
 * Startet eine Fahrt und plant die Ankunft. Ist das Fahrzeug gerade unterwegs, fährt es bis zur
 * nächsten Kreuzung weiter und biegt dort ab – kein Zurückspringen auf der Karte, und ein
 * Wendemanöver mitten auf der Strecke gibt es auch in der Realität nicht.
 */
function drive(
  ctx: Ctx,
  v: VehicleState,
  target: number,
  emergency: boolean,
  task: VehicleTask,
): void {
  const now = ctx.state.time;
  const seq = newTask(v, task);
  const travel = travelContext(now, emergency);
  const partial = partialEdge(v, now);
  let route: RouteState;
  if (partial) {
    const times = ctx.router.edgeTimes(travel);
    const edgeMs = edgeTime(ctx, times, partial.from, partial.to);
    const rest = ctx.router.route(partial.to, target, travel);
    const tail = rest ?? { nodes: [partial.to], cumulativeMs: [0] };
    route = {
      nodes: [partial.from, ...tail.nodes],
      cumulativeMs: [0, ...tail.cumulativeMs.map((t) => t + edgeMs)],
      startedAt: now - Math.round(partial.fraction * edgeMs),
      emergency,
    };
    v.node = partial.from;
  } else {
    const from = currentNode(v, now);
    const r = ctx.router.route(from, target, travel);
    route = r
      ? { nodes: r.nodes, cumulativeMs: r.cumulativeMs, startedAt: now, emergency }
      : { nodes: [from], cumulativeMs: [0], startedAt: now, emergency };
    v.node = from;
  }
  v.route = route;
  const arrival = route.startedAt + (route.cumulativeMs.at(-1) ?? 0);
  ctx.schedule(Math.max(now, arrival), { kind: 'vehicle/arrive', vehicleId: v.id, seq });
}

/** Kante, auf der sich ein fahrendes Fahrzeug gerade befindet, und der zurückgelegte Anteil. */
function partialEdge(
  v: VehicleState,
  time: SimTime,
): { from: number; to: number; fraction: number } | undefined {
  const r = v.route;
  if (!r || r.nodes.length < 2) return undefined;
  const elapsed = time - r.startedAt;
  const total = r.cumulativeMs.at(-1) ?? 0;
  if (elapsed <= 0 || elapsed >= total) return undefined;
  let i = 0;
  while (i + 1 < r.cumulativeMs.length && (r.cumulativeMs[i + 1] ?? 0) <= elapsed) i++;
  const t0 = r.cumulativeMs[i] ?? 0;
  const t1 = r.cumulativeMs[i + 1] ?? t0;
  if (t1 <= t0) return undefined;
  return {
    from: r.nodes[i] ?? v.node,
    to: r.nodes[i + 1] ?? v.node,
    fraction: (elapsed - t0) / (t1 - t0),
  };
}

function edgeTime(ctx: Ctx, times: Uint32Array, from: number, to: number): number {
  const g = ctx.world.graph;
  let best = Number.POSITIVE_INFINITY;
  for (let k = g.outOffsets[from] ?? 0; k < (g.outOffsets[from + 1] ?? 0); k++) {
    const e = g.outEdges[k] ?? 0;
    if (g.edgeTo[e] === to) best = Math.min(best, times[e] ?? best);
  }
  return Number.isFinite(best) ? best : 1000;
}

function markBusy(v: VehicleState, time: SimTime): void {
  v.busySince ??= time;
}

function markFree(v: VehicleState, time: SimTime): void {
  if (v.busySince !== undefined) {
    v.busyMs += time - v.busySince;
    delete v.busySince;
  }
}

function addIncidentError(ctx: Ctx, incident: IncidentState, code: ErrorCode): void {
  if (incident.errors.includes(code)) return;
  incident.errors.push(code);
  countError(ctx, code);
}

// ---------------------------------------------------------------------------- Einsatzanlage

export function createIncident(
  ctx: Ctx,
  callId: string,
  addressId: number,
  keywordId: string,
): RejectReason | undefined {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (!call) return 'unknownCall';
  if (call.status !== 'talking') return 'callNotTalking';
  if (!ctx.world.addresses[addressId]) return 'unknownAddress';
  if (!ctx.content.keywords.has(keywordId)) return 'unknownKeyword';
  ctx.state.calls = ctx.state.calls.filter((c) => c.id !== callId);
  const incident: IncidentState = {
    id: ctx.newId('E'),
    callId,
    receivedAt: call.receivedAt,
    createdAt: ctx.state.time,
    keywordId,
    addressId,
    truth: call.truth,
    report: call.report,
    status: 'open',
    vehicleIds: [],
    assessed: false,
    doctorRequested: false,
    locating: false,
    errors: [],
  };
  const keyword = ctx.content.keywords.get(keywordId);
  if (keyword?.aao.some((a) => ctx.content.doctorTypes.has(a.type))) {
    incident.doctorNeededSince = ctx.state.time;
    incident.doctorWasAvailable = anyDoctorAvailable(ctx);
  }
  ctx.state.incidents.push(incident);
  ctx.state.shift.incidents++;
  ctx.emit({ type: 'incident/created', at: ctx.state.time, incidentId: incident.id });
  return undefined;
}

// ---------------------------------------------------------------------------- Vorschläge

export interface VehicleSuggestion {
  readonly vehicleId: string;
  /** Geschätzte Zeit bis zum Eintreffen inkl. Ausrückzeit (ms); undefined = nicht verfügbar. */
  readonly etaMs: number | undefined;
  readonly available: boolean;
  /** Von der AAO vorgeschlagen. */
  readonly recommended: boolean;
}

/**
 * Fahrzeugvorschlag nach AAO und echter Fahrzeit: Ein Rückwärts-Dijkstra vom Einsatzort liefert
 * die Anfahrtszeiten aller Fahrzeuge in einem Durchlauf (ADR-0007).
 */
export function suggestVehicles(ctx: Ctx, incidentId: string): VehicleSuggestion[] {
  const incident = findIncident(ctx, incidentId);
  if (!incident) return [];
  const keyword = ctx.content.keywords.get(incident.keywordId);
  const tree = ctx.router.timesTo(
    incidentNode(ctx, incident),
    travelContext(ctx.state.time, keyword?.emergency ?? true),
  );
  const night = isNight(ctx.state.time);
  const t = ctx.content.bundle.settings.times;
  const eta = (v: VehicleState): number | undefined => {
    if (!isAvailable(v)) return undefined;
    const drive = tree.dist[currentNode(v, ctx.state.time)] ?? UNREACHABLE;
    if (drive === UNREACHABLE) return undefined;
    const turnout =
      v.status === 2
        ? night
          ? t.turnoutNightSeconds
          : t.turnoutDaySeconds
        : t.turnoutMobileSeconds;
    return drive + ((turnout[0] + turnout[1]) / 2) * 1000;
  };
  const list = ctx.state.vehicles.map((v) => ({ v, eta: eta(v) }));
  const recommended = new Set<string>();
  const need = missingUnits(ctx, incident, keyword?.aao ?? []);
  for (const [type, count] of need) {
    list
      .filter((x) => x.v.typeId === type && x.eta !== undefined)
      .sort((a, b) => (a.eta ?? 0) - (b.eta ?? 0) || a.v.id.localeCompare(b.v.id))
      .slice(0, Math.max(0, count))
      .forEach((x) => recommended.add(x.v.id));
  }
  return list
    .map((x) => ({
      vehicleId: x.v.id,
      etaMs: x.eta,
      available: x.eta !== undefined,
      recommended: recommended.has(x.v.id),
    }))
    .sort(
      (a, b) =>
        (a.etaMs ?? Infinity) - (b.etaMs ?? Infinity) || a.vehicleId.localeCompare(b.vehicleId),
    );
}

/**
 * Welche Fahrzeugtypen dem Einsatz noch fehlen – abhängig von der Phase:
 * vor dem Erstbefund gilt die AAO, danach nur noch der tatsächliche Bedarf
 * (Nachforderung Notarzt, fehlendes Transportmittel). Nach Transportbeginn: nichts mehr.
 */
function missingUnits(
  ctx: Ctx,
  incident: IncidentState,
  aao: readonly { type: string; count: number }[],
): Map<string, number> {
  const need = new Map<string, number>();
  if (incident.status === 'closed' || incident.hospitalId !== undefined) return need;
  const assigned = incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .filter((v): v is VehicleState => !!v);
  if (!incident.assessed) {
    for (const a of aao) need.set(a.type, a.count);
    if (incident.doctorRequested) {
      for (const type of ctx.content.doctorTypes) need.set(type, Math.max(need.get(type) ?? 0, 1));
    }
  } else {
    const firstTransport = ctx.content.bundle.vehicleTypes.find((t) => t.canTransport)?.id;
    const firstDoctor = [...ctx.content.doctorTypes][0];
    if (incident.truth.transport && firstTransport) need.set(firstTransport, 1);
    if (incident.truth.needsDoctor && firstDoctor) need.set(firstDoctor, 1);
    // Ein beliebiges Transportmittel bzw. ein beliebiger Notarzt deckt den Bedarf.
    for (const v of assigned) {
      if (canTransport(ctx, v) && firstTransport) need.set(firstTransport, 0);
      if (isDoctor(ctx, v) && firstDoctor) need.set(firstDoctor, 0);
    }
    return need;
  }
  for (const v of assigned) need.set(v.typeId, (need.get(v.typeId) ?? 0) - 1);
  return need;
}

export interface HospitalSuggestion {
  readonly hospitalId: string;
  readonly etaMs: number;
  /** Hat die benötigte Fachabteilung (sofern bekannt). */
  readonly suitable: boolean;
  readonly recommended: boolean;
}

export function suggestHospitals(ctx: Ctx, vehicleId: string): HospitalSuggestion[] {
  const v = findVehicle(ctx, vehicleId);
  const incident = v?.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!v || !incident) return [];
  const dept = ctx.content.diagnoses.get(incident.truth.diagnosisId)?.department;
  const emergency = transportIsEmergency(ctx, incident);
  const tree = ctx.router.timesFrom(
    currentNode(v, ctx.state.time),
    travelContext(ctx.state.time, emergency),
  );
  const list = ctx.content.bundle.hospitals.map((h) => ({
    hospitalId: h.id,
    etaMs: tree.dist[ctx.content.hospitalNode.get(h.id) ?? 0] ?? UNREACHABLE,
    suitable: dept === undefined || h.departments.includes(dept),
  }));
  list.sort((a, b) => Number(b.suitable) - Number(a.suitable) || a.etaMs - b.etaMs);
  return list.map((h, i) => ({ ...h, recommended: i === 0 }));
}

function isNight(time: SimTime): boolean {
  const { hour } = toCalendar(time);
  return hour >= 22 || hour < 6;
}

function transportIsEmergency(ctx: Ctx, incident: IncidentState): boolean {
  const tracer = ctx.content.diagnoses.get(incident.truth.diagnosisId)?.tracer ?? 'none';
  return incident.truth.naca >= 4 || tracer !== 'none';
}

// ---------------------------------------------------------------------------- Alarmierung

export function dispatch(
  ctx: Ctx,
  incidentId: string,
  vehicleIds: readonly string[],
): RejectReason | undefined {
  const incident = findIncident(ctx, incidentId);
  if (!incident) return 'unknownIncident';
  if (incident.status === 'closed') return 'incidentClosed';
  const vehicles = vehicleIds.map((id) => findVehicle(ctx, id));
  if (vehicles.some((v) => v === undefined)) return 'unknownVehicle';
  if (vehicles.some((v) => v && !isAvailable(v))) return 'vehicleBusy';

  // Dispositionsqualität: War für denselben Typ ein deutlich schnelleres Fahrzeug frei?
  const suggestions = suggestVehicles(ctx, incidentId);
  for (const v of vehicles as VehicleState[]) {
    const mine = suggestions.find((s) => s.vehicleId === v.id)?.etaMs;
    const best = suggestions.find(
      (s) => s.available && findVehicle(ctx, s.vehicleId)?.typeId === v.typeId,
    )?.etaMs;
    if (mine !== undefined && best !== undefined && mine > best + NEAREST_TOLERANCE_MS) {
      addIncidentError(ctx, incident, 'notNearestVehicle');
    }
  }
  if (incident.firstAlarmAt === undefined) {
    incident.firstAlarmAt = ctx.state.time;
    if (ctx.state.time - incident.createdAt > DISPATCH_TARGET_MS)
      addIncidentError(ctx, incident, 'slowDispatch');
  }

  const t = ctx.content.bundle.settings.times;
  const night = isNight(ctx.state.time);
  if ((vehicles as VehicleState[]).some((v) => isDoctor(ctx, v)))
    checkDoctorDispatch(ctx, incident);
  for (const v of vehicles as VehicleState[]) {
    v.incidentId = incident.id;
    incident.vehicleIds.push(v.id);
    markBusy(v, ctx.state.time);
    const range =
      v.status === 2
        ? night
          ? t.turnoutNightSeconds
          : t.turnoutDaySeconds
        : t.turnoutMobileSeconds;
    // Ein fahrendes Fahrzeug rollt während der kurzen Reaktionszeit auf seiner Strecke weiter;
    // die geplante Ankunft der alten Fahrt verfällt über die neue Aufgabennummer.
    const seq = newTask(v, 'turnout');
    radio(ctx, v, 'alarmed');
    ctx.schedule(ctx.state.time + rangeInt(ctx.rng.crews, range) * 1000, {
      kind: 'vehicle/turnoutDone',
      vehicleId: v.id,
      seq,
    });
  }
  incident.status = 'active';
  return undefined;
}

// ---------------------------------------------------------------------------- Ablauf je Fahrzeug

export function onTurnoutDone(ctx: Ctx, v: VehicleState): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!incident) return;
  const emergency = ctx.content.keywords.get(incident.keywordId)?.emergency ?? true;
  setStatus(ctx, v, 3);
  drive(ctx, v, incidentNode(ctx, incident), emergency, 'toScene');
}

export function onArrive(ctx: Ctx, v: VehicleState): void {
  const target = v.route?.nodes.at(-1) ?? v.node;
  v.node = target;
  v.route = null;
  switch (v.task) {
    case 'toScene':
      arriveAtScene(ctx, v);
      return;
    case 'toHospital':
      arriveAtHospital(ctx, v);
      return;
    case 'returning':
      newTask(v, 'idle');
      if (v.node === v.homeNode) setStatus(ctx, v, 2);
      return;
    default:
      return;
  }
}

function arriveAtScene(ctx: Ctx, v: VehicleState): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!incident) return;
  newTask(v, 'onScene');
  setStatus(ctx, v, 4, 'arrived');

  // Falsche Adresse? Dann Rückruf beim Anrufer, bevor es weitergeht.
  const chosen = ctx.world.addresses[incident.addressId];
  const real = ctx.world.addresses[incident.truth.addressId];
  if (chosen && real && incident.addressId !== incident.truth.addressId) {
    const dx = chosen.x - real.x;
    const dy = chosen.y - real.y;
    if (dx * dx + dy * dy > FIND_RADIUS_M * FIND_RADIUS_M) {
      if (!incident.locating) {
        incident.locating = true;
        radio(ctx, v, 'wrongLocation');
        addIncidentError(ctx, incident, 'wrongLocation');
        const delay =
          rangeInt(ctx.rng.crews, ctx.content.bundle.settings.times.callbackSeconds) * 1000;
        ctx.schedule(ctx.state.time + delay, {
          kind: 'incident/callbackDone',
          incidentId: incident.id,
        });
      }
      return;
    }
  }
  if (incident.locating) return;

  incident.firstArrivalAt ??= ctx.state.time;
  if (isDoctor(ctx, v)) {
    incident.doctorArrivalAt ??= ctx.state.time;
    if (incident.assessed && !incident.truth.needsDoctor) {
      releaseVehicle(ctx, v, 'doctorNotNeeded');
      return;
    }
  }
  if (!incident.assessed && !hasAssessmentPending(ctx, incident, v)) {
    const seq = v.taskSeq;
    const delay = rangeInt(ctx.rng.crews, ASSESSMENT_SECONDS) * 1000;
    ctx.schedule(ctx.state.time + delay, { kind: 'vehicle/assessed', vehicleId: v.id, seq });
  }
  scheduleSceneDone(ctx, incident);
}

/** Nur das zuerst eingetroffene Fahrzeug meldet den Erstbefund. */
function hasAssessmentPending(ctx: Ctx, incident: IncidentState, self: VehicleState): boolean {
  return incident.vehicleIds.some((id) => {
    const o = findVehicle(ctx, id);
    return o !== undefined && o !== self && o.task === 'onScene' && o.status === 4;
  });
}

/** Rückruf erfolgreich: richtige Adresse übernehmen, alle Fahrzeuge dorthin umleiten. */
export function onCallbackDone(ctx: Ctx, incidentId: string): void {
  const incident = findIncident(ctx, incidentId);
  if (!incident || incident.status === 'closed') return;
  incident.addressId = incident.truth.addressId;
  incident.locating = false;
  const emergency = ctx.content.keywords.get(incident.keywordId)?.emergency ?? true;
  for (const id of incident.vehicleIds) {
    const v = findVehicle(ctx, id);
    if (v && (v.task === 'onScene' || v.task === 'toScene')) {
      radio(ctx, v, 'locationFound');
      v.status = 3;
      drive(ctx, v, incidentNode(ctx, incident), emergency, 'toScene');
    }
  }
}

/** Erstbefund: Nachforderung Notarzt, Abbestellen überzähliger Kräfte, kein Patient. */
export function onAssessed(ctx: Ctx, v: VehicleState): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!incident || incident.assessed) return;
  incident.assessed = true;
  const d = ctx.content.diagnoses.get(incident.truth.diagnosisId);

  if (d?.transport === 0 && !incident.truth.transport) {
    // Kein Patient vor Ort (z. B. bereits weg, Fehlalarm in guter Absicht).
    radio(ctx, v, 'noPatient');
    for (const id of [...incident.vehicleIds]) {
      const o = findVehicle(ctx, id);
      if (o) releaseVehicle(ctx, o, 'released');
    }
    return;
  }

  const assigned = incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .filter((x): x is VehicleState => !!x);
  const doctorAssigned = assigned.some((o) => isDoctor(ctx, o));
  if (incident.truth.transport && !assigned.some((o) => canTransport(ctx, o))) {
    radio(ctx, v, 'requestTransport');
  }
  if (incident.truth.needsDoctor && !doctorAssigned) {
    incident.doctorRequested = true;
    incident.doctorNeededSince = ctx.state.time;
    incident.doctorWasAvailable = anyDoctorAvailable(ctx);
    radio(ctx, v, 'requestDoctor');
  }
  if (!incident.truth.needsDoctor) {
    for (const o of assigned) {
      if (isDoctor(ctx, o)) releaseVehicle(ctx, o, 'doctorNotNeeded');
    }
  }
  // Nur ein Patient: überzählige Transportmittel werden abbestellt (das zuerst eingetroffene bleibt).
  const transporters = assigned.filter((o) => canTransport(ctx, o));
  const keep = transporters.find((o) => o.task === 'onScene') ?? transporters[0];
  for (const o of transporters) {
    if (o !== keep) releaseVehicle(ctx, o, 'secondUnitNotNeeded');
  }
  scheduleSceneDone(ctx, incident);
}

/**
 * Plant das Behandlungsende vor Ort für das transportierende Fahrzeug. Braucht der Patient einen
 * Notarzt, ist er erst nach dessen Behandlung transportfähig.
 */
function scheduleSceneDone(ctx: Ctx, incident: IncidentState): void {
  if (incident.treatmentDoneAt !== undefined || !incident.assessed || incident.locating) return;
  const rtw = incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .find((o): o is VehicleState => !!o && canTransport(ctx, o) && o.task === 'onScene');
  if (!rtw || incident.firstArrivalAt === undefined) return;
  if (incident.truth.needsDoctor && incident.doctorArrivalAt === undefined) return;
  const at = Math.max(
    incident.firstArrivalAt + incident.truth.onSceneMs,
    (incident.doctorArrivalAt ?? 0) + (incident.truth.needsDoctor ? DOCTOR_TREATMENT_MS : 0),
    ctx.state.time + 60_000,
  );
  incident.treatmentDoneAt = at;
  ctx.schedule(at, { kind: 'vehicle/sceneDone', vehicleId: rtw.id, seq: rtw.taskSeq });
}

export function onSceneDone(ctx: Ctx, v: VehicleState): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!incident) return;
  if (!incident.truth.transport) {
    radio(ctx, v, 'noTransport');
    for (const id of [...incident.vehicleIds]) {
      const o = findVehicle(ctx, id);
      if (o) releaseVehicle(ctx, o, 'released');
    }
    return;
  }
  const seq = newTask(v, 'awaitDestination');
  v.requestSince = ctx.state.time;
  setStatus(ctx, v, 5, 'requestDestination');
  ctx.schedule(
    ctx.state.time + ctx.content.bundle.settings.times.destinationTimeoutSeconds * 1000,
    {
      kind: 'vehicle/destTimeout',
      vehicleId: v.id,
      seq,
    },
  );
}

export function assignDestination(
  ctx: Ctx,
  vehicleId: string,
  hospitalId: string,
): RejectReason | undefined {
  const v = findVehicle(ctx, vehicleId);
  if (!v) return 'unknownVehicle';
  if (v.task !== 'awaitDestination') return 'notAwaitingDestination';
  if (!ctx.content.hospitals.has(hospitalId)) return 'unknownHospital';
  startTransport(ctx, v, hospitalId);
  return undefined;
}

export function onDestinationTimeout(ctx: Ctx, v: VehicleState): void {
  if (v.task !== 'awaitDestination') return;
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!incident) return;
  // Die Besatzung entscheidet selbst: nächstgelegene geeignete Klinik.
  const best = suggestHospitals(ctx, v.id)[0];
  if (!best) return;
  addIncidentError(ctx, incident, 'destinationTimeout');
  radio(ctx, v, 'destinationSelf');
  startTransport(ctx, v, best.hospitalId);
}

function startTransport(ctx: Ctx, v: VehicleState, hospitalId: string): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!incident) return;
  const hospital = ctx.content.hospitals.get(hospitalId);
  const dept = ctx.content.diagnoses.get(incident.truth.diagnosisId)?.department;
  if (hospital && dept && !hospital.departments.includes(dept))
    addIncidentError(ctx, incident, 'unsuitableHospital');
  incident.hospitalId = hospitalId;
  delete v.requestSince;
  v.hospitalId = hospitalId;
  const target = ctx.content.hospitalNode.get(hospitalId) ?? v.node;
  const emergency = transportIsEmergency(ctx, incident);
  v.status = 7;
  drive(ctx, v, target, emergency, 'toHospital');
  radio(ctx, v, 'status');

  // Notarzt: begleitet bei schweren Fällen den Transport, sonst wird er frei.
  for (const id of [...incident.vehicleIds]) {
    const o = findVehicle(ctx, id);
    if (!o || o === v) continue;
    if (
      isDoctor(ctx, o) &&
      o.task === 'onScene' &&
      incident.truth.needsDoctor &&
      incident.truth.naca >= 4
    ) {
      o.hospitalId = hospitalId;
      o.status = 7;
      drive(ctx, o, target, emergency, 'toHospital');
      radio(ctx, o, 'accompany');
    } else if (o.task === 'onScene' || o.task === 'turnout' || o.task === 'toScene') {
      releaseVehicle(ctx, o, 'released');
    }
  }
}

function arriveAtHospital(ctx: Ctx, v: VehicleState): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  const seq = newTask(v, 'handover');
  setStatus(ctx, v, 8);
  if (incident && canTransport(ctx, v)) incident.hospitalArrivalAt ??= ctx.state.time;
  const range = isDoctor(ctx, v)
    ? DOCTOR_HANDOVER_MINUTES
    : ctx.content.bundle.settings.times.handoverMinutes;
  ctx.schedule(ctx.state.time + rangeInt(ctx.rng.crews, range) * MS_PER_MINUTE, {
    kind: 'vehicle/handoverDone',
    vehicleId: v.id,
    seq,
  });
}

export function onHandoverDone(ctx: Ctx, v: VehicleState): void {
  releaseVehicle(ctx, v, 'status');
}

/** Fahrzeug aus dem Einsatz lösen: Status 1, Rückfahrt zur Wache. Schließt ggf. den Einsatz. */
export function releaseVehicle(ctx: Ctx, v: VehicleState, message: RadioMessage): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (incident) incident.vehicleIds = incident.vehicleIds.filter((id) => id !== v.id);
  v.incidentId = null;
  v.hospitalId = null;
  delete v.requestSince;
  markFree(v, ctx.state.time);
  v.status = 1;
  radio(ctx, v, message);
  drive(ctx, v, v.homeNode, false, 'returning');
  if (incident && incident.vehicleIds.length === 0 && incident.status === 'active') {
    const finished =
      incident.hospitalArrivalAt !== undefined ||
      (incident.assessed && !incidentNeedsTransport(incident));
    if (finished || (incident.assessed && !incident.truth.transport)) closeIncident(ctx, incident);
    else incident.status = 'open';
  }
}

function incidentNeedsTransport(incident: IncidentState): boolean {
  return incident.truth.transport;
}

/** Spieler bestellt ein Fahrzeug ab (nur vor dem Transport). */
export function releaseCommand(ctx: Ctx, vehicleId: string): RejectReason | undefined {
  const v = findVehicle(ctx, vehicleId);
  if (!v) return 'unknownVehicle';
  if (v.incidentId === null || !['turnout', 'toScene', 'onScene'].includes(v.task))
    return 'notReleasable';
  const incident = findIncident(ctx, v.incidentId);
  releaseVehicle(ctx, v, 'released');
  if (incident) {
    // Wurde das behandelnde Fahrzeug abgezogen, muss die Behandlung neu geplant werden.
    delete incident.treatmentDoneAt;
    scheduleSceneDone(ctx, incident);
  }
  return undefined;
}

/** Ein nachgeforderter Notarzt sollte innerhalb dieser Zeit alarmiert sein. */
const DOCTOR_DISPATCH_TARGET_MS = 3 * MS_PER_MINUTE;

/**
 * Fehler „Notarzt zu spät" nur, wenn der Disponent ihn zu spät *alarmiert* hat, obwohl ein Notarzt
 * frei war. War keiner frei, ist das ein Strukturproblem des Bereichs, kein Dispositionsfehler.
 */
function checkDoctorDispatch(ctx: Ctx, incident: IncidentState): void {
  if (incident.doctorNeededSince === undefined) return;
  if (
    ctx.state.time - incident.doctorNeededSince > DOCTOR_DISPATCH_TARGET_MS &&
    incident.doctorWasAvailable
  ) {
    addIncidentError(ctx, incident, 'doctorLate');
  }
  delete incident.doctorNeededSince;
}

function anyDoctorAvailable(ctx: Ctx): boolean {
  return ctx.state.vehicles.some((v) => isDoctor(ctx, v) && isAvailable(v));
}
