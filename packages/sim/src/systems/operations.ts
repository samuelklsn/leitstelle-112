import { UNREACHABLE } from '@ls112/routing';
import { rangeInt, travelContext, type Ctx } from '../context';
import { MS_PER_MINUTE, toCalendar, type SimTime } from '../time';
import type { ErrorCode, IncidentState, RadioMessage, RejectReason, VehicleState } from '../types';
import { countError } from './calls';
import {
  afterMission,
  arriveForService,
  isDepartmentOpen,
  occupyBed,
  orderPickupOnTime,
} from './logistics';
import { closeIncident } from './outcome';
import {
  accountDriving,
  airMs,
  canTransport,
  currentNode,
  drive,
  findVehicle,
  isAvailable,
  isDoctor,
  isDoctorOnly,
  isEmergencyTransport,
  isAir,
  isFireUnit,
  isRdUnit,
  markBusy,
  markFree,
  newTask,
  radio,
  setStatus,
  transportClassOf,
} from './vehicles';

export {
  canTransport,
  currentNode,
  findVehicle,
  isAvailable,
  isDoctor,
  isFireUnit,
} from './vehicles';

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
/** Rangfolge der Transportklassen: Wer höher steht, darf auch Aufträge darunter fahren. */
const CLASS_RANK = { krankentransport: 1, notfall: 2, intensiv: 3 } as const;
/** Ab diesem NACA-Wert nimmt jede geeignete Klinik auf, auch wenn sie abgemeldet ist. */
const VITAL_NACA = 5;

// ---------------------------------------------------------------------------- Hilfsfunktionen

export function findIncident(ctx: Ctx, id: string): IncidentState | undefined {
  return ctx.state.incidents.find((i) => i.id === id);
}

export interface Need {
  readonly type: string;
  readonly count: number;
  readonly alternatives: readonly string[];
}

/** Deckt ein Fahrzeug den Bedarf (Typ oder Ersatztyp)? */
function fits(need: Need, v: VehicleState): boolean {
  return v.typeId === need.type || need.alternatives.includes(v.typeId);
}

/**
 * Zieht vorhandene Fahrzeuge vom Bedarf ab. Jedes Fahrzeug zählt nur einmal – exakte Typen werden
 * zuerst verbraucht, damit ein HLF nicht für einen LF-Bedarf „verschwendet" wird.
 */
export function subtractUnits(needs: readonly Need[], vehicles: readonly VehicleState[]): Need[] {
  const pool = [...vehicles];
  const rest: Need[] = [];
  for (const need of needs) {
    let missing = need.count;
    for (const pass of [true, false]) {
      for (let i = pool.length - 1; i >= 0 && missing > 0; i--) {
        const v = pool[i];
        if (!v) continue;
        if (pass ? v.typeId === need.type : fits(need, v)) {
          pool.splice(i, 1);
          missing--;
        }
      }
    }
    if (missing > 0) rest.push({ ...need, count: missing });
  }
  return rest;
}

export function incidentNode(ctx: Ctx, incident: IncidentState): number {
  return ctx.world.addresses[incident.addressId]?.node ?? 0;
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
    callKind: call.kind,
    ...(call.duplicateOf !== undefined ? { duplicateOf: call.duplicateOf } : {}),
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
    travelContext(ctx, keyword?.emergency ?? true),
  );
  const eta = (v: VehicleState): number | undefined => {
    if (!isAvailable(v)) return undefined;
    const from = currentNode(v, ctx.state.time);
    const drive = isAir(ctx, v)
      ? airMs(ctx, from, incidentNode(ctx, incident))
      : (tree.dist[from] ?? UNREACHABLE);
    if (drive === UNREACHABLE) return undefined;
    const turnout = turnoutRange(ctx, v);
    return drive + ((turnout[0] + turnout[1]) / 2) * 1000;
  };
  const list = ctx.state.vehicles.map((v) => ({ v, eta: eta(v) }));
  const recommended = new Set<string>();
  for (const need of missingNeeds(ctx, incident)) {
    list
      .filter((x) => x.eta !== undefined && !recommended.has(x.v.id) && fits(need, x.v))
      .sort((a, b) => (a.eta ?? 0) - (b.eta ?? 0) || a.v.id.localeCompare(b.v.id))
      .slice(0, need.count)
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
 * Was dem Einsatz noch fehlt – abhängig von der Phase: vor der Lagemeldung gilt die AAO, danach
 * der tatsächliche Bedarf (Notarzt, Transportmittel, Kräfte für die Feuerwehrlage).
 */
export function missingNeeds(ctx: Ctx, incident: IncidentState): Need[] {
  if (incident.status === 'closed') return [];
  const assigned = incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .filter((v): v is VehicleState => !!v);
  const needs: Need[] = [];
  const truth = incident.truth;
  if (incident.order) {
    // Transportauftrag: ein Fahrzeug laut AAO, bis der Patient übernommen ist.
    if (incident.order.pickedUpAt !== undefined || assigned.some((v) => canTransport(ctx, v)))
      return [];
    return subtractUnits(ctx.content.keywords.get(incident.keywordId)?.aao ?? [], assigned);
  }
  if (!incident.assessed) {
    needs.push(...(ctx.content.keywords.get(incident.keywordId)?.aao ?? []));
    if (incident.doctorRequested) {
      const doctor = [...ctx.content.doctorTypes][0];
      if (doctor) needs.push({ type: doctor, count: 1, alternatives: [] });
    }
    return subtractUnits(needs, assigned);
  }
  // Rettungsdienst: ein Transportmittel bzw. ein Notarzt deckt den Bedarf – bis der Transport läuft.
  if (truth.patient && incident.hospitalId === undefined) {
    const transport = ctx.content.bundle.vehicleTypes
      .filter((x) => transportClassOf(ctx, x.id) === 'notfall')
      .map((x) => x.id);
    const doctors = [...ctx.content.doctorTypes];
    if (truth.transport && transport[0] && !assigned.some((v) => isEmergencyTransport(ctx, v))) {
      needs.push({ type: transport[0], count: 1, alternatives: transport.slice(1) });
    }
    if (truth.needsDoctor && doctors[0] && !assigned.some((v) => isDoctor(ctx, v))) {
      needs.push({ type: doctors[0], count: 1, alternatives: doctors.slice(1) });
    }
  }
  // Feuerwehr: Kräftebedarf der aktuellen (ggf. ausgebreiteten) Lage.
  if (truth.fire && !truth.fire.done) {
    const scenario = ctx.content.fireScenarios.get(truth.fire.scenarioId);
    const fireUnits = assigned.filter((v) => isFireUnit(ctx, v));
    needs.push(...subtractUnits(scenario?.needs ?? [], fireUnits));
  }
  return needs;
}

export interface HospitalSuggestion {
  readonly hospitalId: string;
  readonly etaMs: number;
  /** Hat die benötigte Fachabteilung (sofern bekannt). */
  readonly suitable: boolean;
  /** Abteilung nimmt auf (nicht abgemeldet). */
  readonly open: boolean;
  readonly recommended: boolean;
}

export function suggestHospitals(ctx: Ctx, vehicleId: string): HospitalSuggestion[] {
  const v = findVehicle(ctx, vehicleId);
  const incident = v?.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!v || !incident) return [];
  const dept = ctx.content.diagnoses.get(incident.truth.diagnosisId)?.department;
  const emergency = transportIsEmergency(ctx, incident);
  const tree = ctx.router.timesFrom(currentNode(v, ctx.state.time), travelContext(ctx, emergency));
  // Bei vitaler Bedrohung gilt die Aufnahmepflicht – dann zählt nur die nächste geeignete Klinik.
  const vital = incident.truth.naca >= VITAL_NACA;
  const from = currentNode(v, ctx.state.time);
  const list = ctx.content.bundle.hospitals.map((h) => ({
    hospitalId: h.id,
    etaMs: isAir(ctx, v)
      ? airMs(ctx, from, ctx.content.hospitalNode.get(h.id) ?? 0)
      : (tree.dist[ctx.content.hospitalNode.get(h.id) ?? 0] ?? UNREACHABLE),
    suitable: dept === undefined || h.departments.includes(dept),
    open: dept === undefined || isDepartmentOpen(ctx, h.id, dept),
  }));
  list.sort(
    (a, b) =>
      Number(b.suitable) - Number(a.suitable) ||
      (vital ? 0 : Number(b.open) - Number(a.open)) ||
      a.etaMs - b.etaMs,
  );
  return list.map((h, i) => ({ ...h, recommended: i === 0 }));
}

/** Ausrückzeit: wachenspezifisch (Freiwillige Feuerwehr) oder aus den Einstellungen. */
function turnoutRange(ctx: Ctx, v: VehicleState): readonly [number, number] {
  const t = ctx.content.bundle.settings.times;
  const night = isNight(ctx.state.time);
  // Hubschrauber: Triebwerke anlassen und abheben, auch nach dem Wiederauftanken.
  if (isAir(ctx, v))
    return v.status === 2 ? ctx.content.bundle.settings.air.liftoffSeconds : [30, 60];
  if (v.status !== 2) return t.turnoutMobileSeconds;
  const own = ctx.content.stationTurnout.get(v.stationId);
  if (own) return night ? own.night : own.day;
  return night ? t.turnoutNightSeconds : t.turnoutDaySeconds;
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
    // Aufträge mit Termin werden bewusst später disponiert – das ist kein Fehler.
    if (!incident.order && ctx.state.time - incident.createdAt > DISPATCH_TARGET_MS)
      addIncidentError(ctx, incident, 'slowDispatch');
  }

  if ((vehicles as VehicleState[]).some((v) => isDoctor(ctx, v)))
    checkDoctorDispatch(ctx, incident);
  for (const v of vehicles as VehicleState[]) {
    v.incidentId = incident.id;
    incident.vehicleIds.push(v.id);
    markBusy(v, ctx.state.time);
    const range = turnoutRange(ctx, v);
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
  accountDriving(ctx, v, ctx.state.time);
  v.node = target;
  v.route = null;
  switch (v.task) {
    case 'toService':
      arriveForService(ctx, v);
      return;
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
  if (incident.order) {
    arriveForPickup(ctx, incident, v);
    return;
  }

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

  // KTW und ITW sind keine Rettungsmittel im Sinne der Hilfsfrist.
  const counts = !canTransport(ctx, v) || isEmergencyTransport(ctx, v);
  if (incident.firstArrivalAt === undefined && counts) {
    incident.firstArrivalAt = ctx.state.time;
    deteriorate(ctx, incident);
  }
  if (isFireUnit(ctx, v)) incident.firstFireArrivalAt ??= ctx.state.time;
  if (isDoctor(ctx, v)) {
    incident.doctorArrivalAt ??= ctx.state.time;
    if (isDoctorOnly(ctx, v) && incident.assessed && !incident.truth.needsDoctor) {
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
  checkFireWork(ctx, incident);
}

/**
 * Transportauftrag: Der Patient ist zum Termin fertig. Wer zu früh kommt, wartet; wer zu spät
 * kommt, macht einen Fehler. Die Klasse des Fahrzeugs muss zum Auftrag passen.
 */
function arriveForPickup(ctx: Ctx, incident: IncidentState, v: VehicleState): void {
  const order = incident.order;
  if (!order) return;
  if (!canTransport(ctx, v) || incident.firstArrivalAt !== undefined) {
    releaseVehicle(ctx, v, 'secondUnitNotNeeded');
    return;
  }
  incident.firstArrivalAt = ctx.state.time;
  incident.assessed = true;
  if (!orderPickupOnTime(ctx, order, ctx.state.time))
    addIncidentError(ctx, incident, 'transportLate');
  const need = ctx.content.keywords.get(incident.keywordId)?.aao[0]?.type;
  const required = need ? transportClassOf(ctx, need) : undefined;
  const own = transportClassOf(ctx, v.typeId);
  if (required && own && CLASS_RANK[own] < CLASS_RANK[required])
    addIncidentError(ctx, incident, 'unsuitableTransport');
  const at = Math.max(ctx.state.time, order.dueAt) + incident.truth.onSceneMs;
  incident.treatmentDoneAt = at;
  ctx.schedule(at, { kind: 'vehicle/sceneDone', vehicleId: v.id, seq: v.taskSeq });
}

/**
 * Lageentwicklung beim Patienten: Wer lange auf Hilfe wartet, dem geht es schlechter. Ab der
 * Hilfsfrist steigt die Wahrscheinlichkeit, dass sich der Zustand um eine NACA-Stufe verschlechtert.
 */
function deteriorate(ctx: Ctx, incident: IncidentState): void {
  const truth = incident.truth;
  if (!truth.patient || truth.naca >= 7) return;
  const waitedMin = (ctx.state.time - incident.receivedAt) / MS_PER_MINUTE;
  const over = waitedMin - ctx.content.bundle.settings.hilfsfrist.minutes;
  if (over <= 0) return;
  if (ctx.rng.outcome.chance(Math.min(0.6, over / 30))) {
    truth.naca += 1;
    if (truth.naca >= 5) truth.needsDoctor = true;
  }
}

/** Feuerwehr: Abarbeitung beginnt, sobald alle nötigen Kräfte vor Ort sind. */
function checkFireWork(ctx: Ctx, incident: IncidentState): void {
  const fire = incident.truth.fire;
  if (!fire || fire.done || fire.workUntil !== undefined || !incident.assessed) return;
  const scenario = ctx.content.fireScenarios.get(fire.scenarioId);
  if (!scenario) return;
  const onScene = incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .filter((o): o is VehicleState => !!o && o.task === 'onScene' && isFireUnit(ctx, o));
  if (subtractUnits(scenario.needs, onScene).length > 0) return;
  fire.workUntil = ctx.state.time + rangeInt(ctx.rng.crews, scenario.workMinutes) * MS_PER_MINUTE;
  ctx.schedule(fire.workUntil, {
    kind: 'fire/done',
    incidentId: incident.id,
    escalations: fire.escalations,
  });
}

/** Feuer aus bzw. Einsatzstelle abgearbeitet: Feuerwehr rückt ein. */
export function onFireDone(ctx: Ctx, incidentId: string, escalations: number): void {
  const incident = findIncident(ctx, incidentId);
  const fire = incident?.truth.fire;
  if (!incident || !fire || fire.done || fire.escalations !== escalations) return;
  fire.done = true;
  const units = incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .filter((o): o is VehicleState => !!o && isFireUnit(ctx, o));
  const reporter = units.find((o) => o.task === 'onScene');
  if (reporter) radio(ctx, reporter, 'fireUnderControl');
  for (const o of units) releaseVehicle(ctx, o, 'released');
  // Eingeklemmte Person ist befreit: Jetzt kann der Rettungsdienst transportieren.
  scheduleSceneDone(ctx, incident);
  maybeClose(ctx, incident);
}

/**
 * Ausbreitung: Ist bis jetzt kein Feuerwehrfahrzeug vor Ort, wird aus dem Küchenbrand ein
 * Wohnungsbrand, aus dem Wohnungsbrand ein Dachstuhlbrand (ADR-0014, Lageentwicklung).
 */
export function onFireEscalate(ctx: Ctx, callId: string): void {
  const incident = ctx.state.incidents.find((i) => i.callId === callId);
  const call = ctx.state.calls.find((c) => c.id === callId);
  const truth = incident?.truth ?? call?.truth;
  const fire = truth?.fire;
  if (!fire || fire.done) return;
  if (incident?.status === 'closed' || incident?.firstFireArrivalAt !== undefined) return;
  if (!incident && !call) return;
  const from = ctx.content.fireScenarios.get(fire.scenarioId);
  const to = from?.escalation ? ctx.content.fireScenarios.get(from.escalation.to) : undefined;
  if (!to) return;
  fire.scenarioId = to.id;
  fire.escalations++;
  delete fire.workUntil;
  if (incident) {
    addIncidentError(ctx, incident, 'fireSpread');
    const witness = incident.vehicleIds
      .map((id) => findVehicle(ctx, id))
      .find((o) => o?.task === 'onScene');
    if (witness) radio(ctx, witness, 'fireSpread');
  } else {
    countError(ctx, 'fireSpread');
  }
  if (to.escalation) {
    const after = rangeInt(ctx.rng.patients, to.escalation.after) * MS_PER_MINUTE;
    ctx.schedule(ctx.state.time + after, { kind: 'fire/escalate', callId });
  }
}

function releaseAll(ctx: Ctx, incident: IncidentState): void {
  for (const id of [...incident.vehicleIds]) {
    const o = findVehicle(ctx, id);
    if (o) releaseVehicle(ctx, o, 'released');
  }
  if (incident.status !== 'closed') closeIncident(ctx, incident);
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

  // Doppelt angelegt: Die Kollegen des ersten Einsatzes sind längst da.
  if (incident.duplicateOf !== undefined) {
    radio(ctx, v, 'alreadyHandled');
    addIncidentError(ctx, incident, 'duplicateIncident');
    releaseAll(ctx, incident);
    return;
  }
  // Scherz-, Fehl- oder Auskunftsanruf als Einsatz: vor Ort ist niemand.
  if (incident.callKind !== 'emergency') {
    radio(ctx, v, 'noPatient');
    addIncidentError(
      ctx,
      incident,
      incident.callKind === 'prank' ? 'prankDispatched' : 'nonEmergencyDispatched',
    );
    releaseAll(ctx, incident);
    return;
  }

  const fire = incident.truth.fire;
  if (fire) {
    // Lagemeldung der Feuerwehr bzw. des ersten Fahrzeugs: was brennt, was fehlt.
    const scenario = ctx.content.fireScenarios.get(fire.scenarioId);
    const units = incident.vehicleIds
      .map((id) => findVehicle(ctx, id))
      .filter((o): o is VehicleState => !!o && isFireUnit(ctx, o));
    const missing = subtractUnits(scenario?.needs ?? [], units);
    radio(ctx, v, missing.length > 0 ? 'requestUnits' : 'fireReport');
    if (!incident.truth.patient) {
      // Niemand verletzt: Rettungsdienst wird nicht gebraucht.
      for (const id of [...incident.vehicleIds]) {
        const o = findVehicle(ctx, id);
        if (o && isRdUnit(ctx, o)) releaseVehicle(ctx, o, 'released');
      }
      checkFireWork(ctx, incident);
      maybeClose(ctx, incident);
      return;
    }
    checkFireWork(ctx, incident);
  }

  if (!fire && d?.transport === 0 && !incident.truth.transport) {
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
  if (incident.truth.transport && !assigned.some((o) => isEmergencyTransport(ctx, o))) {
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
      if (isDoctorOnly(ctx, o)) releaseVehicle(ctx, o, 'doctorNotNeeded');
    }
  }
  // Nur ein Patient: überzählige Transportmittel werden abbestellt (das zuerst eingetroffene bleibt).
  // Ein RTW am Boden transportiert vorrangig; NAW und RTH bleiben, solange ihr Notarzt gebraucht
  // wird, sonst werden sie frei, wenn ein RTW da ist.
  const transporters = assigned.filter((o) => isEmergencyTransport(ctx, o));
  const ground = transporters.filter((o) => !isDoctor(ctx, o));
  const keep =
    ground.find((o) => o.task === 'onScene') ??
    ground[0] ??
    transporters.find((o) => o.task === 'onScene') ??
    transporters[0];
  for (const o of transporters) {
    if (o === keep) continue;
    if (isDoctor(ctx, o)) {
      if (!incident.truth.needsDoctor) releaseVehicle(ctx, o, 'doctorNotNeeded');
    } else {
      releaseVehicle(ctx, o, 'secondUnitNotNeeded');
    }
  }
  scheduleSceneDone(ctx, incident);
}

/**
 * Plant das Behandlungsende vor Ort für das transportierende Fahrzeug. Braucht der Patient einen
 * Notarzt, ist er erst nach dessen Behandlung transportfähig.
 */
function scheduleSceneDone(ctx: Ctx, incident: IncidentState): void {
  if (incident.treatmentDoneAt !== undefined || !incident.assessed || incident.locating) return;
  if (!incident.truth.patient) return;
  // Eingeklemmte Person: Erst nach der technischen Rettung transportfähig.
  const fire = incident.truth.fire;
  if (fire && !fire.done && ctx.content.fireScenarios.get(fire.scenarioId)?.kind === 'th') return;
  // Transportiert wird bevorzugt bodengebunden; NAW/RTH nur, wenn kein RTW vor Ort ist.
  const onScene = incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .filter((o): o is VehicleState => !!o && isEmergencyTransport(ctx, o) && o.task === 'onScene');
  const rtw = onScene.find((o) => !isDoctor(ctx, o)) ?? onScene[0];
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
  if (incident.order) {
    startOrderTransport(ctx, incident, v);
    return;
  }
  if (!incident.truth.transport) {
    radio(ctx, v, 'noTransport');
    for (const id of [...incident.vehicleIds]) {
      const o = findVehicle(ctx, id);
      if (o && isRdUnit(ctx, o)) releaseVehicle(ctx, o, 'released');
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

/** Auftrag: Patient übernommen, direkt zum vereinbarten Ziel (Klinik oder Wohnadresse). */
function startOrderTransport(ctx: Ctx, incident: IncidentState, v: VehicleState): void {
  const order = incident.order;
  if (!order) return;
  order.pickedUpAt = ctx.state.time;
  radio(ctx, v, 'patientPickedUp');
  if (order.toHospitalId !== undefined) {
    startTransport(ctx, v, order.toHospitalId);
    return;
  }
  const target = ctx.world.addresses[order.toAddressId ?? incident.addressId]?.node ?? v.node;
  v.status = 7;
  drive(ctx, v, target, false, 'toHospital');
  radio(ctx, v, 'status');
}

function startTransport(ctx: Ctx, v: VehicleState, hospitalId: string): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (!incident) return;
  const hospital = ctx.content.hospitals.get(hospitalId);
  const dept = ctx.content.diagnoses.get(incident.truth.diagnosisId)?.department;
  if (hospital && dept && !hospital.departments.includes(dept))
    addIncidentError(ctx, incident, 'unsuitableHospital');
  // Abgemeldete Abteilung angefahren, obwohl eine andere geeignete Klinik aufnahmebereit war.
  if (
    hospital &&
    dept &&
    hospital.departments.includes(dept) &&
    !isDepartmentOpen(ctx, hospitalId, dept) &&
    incident.truth.naca < VITAL_NACA &&
    ctx.content.bundle.hospitals.some(
      (h) =>
        h.id !== hospitalId && h.departments.includes(dept) && isDepartmentOpen(ctx, h.id, dept),
    )
  ) {
    addIncidentError(ctx, incident, 'hospitalClosed');
  }
  incident.hospitalId = hospitalId;
  delete v.requestSince;
  v.hospitalId = hospitalId;
  const target = ctx.content.hospitalNode.get(hospitalId) ?? v.node;
  // Aufträge fahren ohne Sonderrechte; Verlegungen sind geplant.
  const emergency = !incident.order && transportIsEmergency(ctx, incident);
  v.status = 7;
  drive(ctx, v, target, emergency, 'toHospital');
  radio(ctx, v, 'status');

  // Notarzt: begleitet bei schweren Fällen den Transport, sonst wird er frei.
  for (const id of [...incident.vehicleIds]) {
    const o = findVehicle(ctx, id);
    if (!o || o === v) continue;
    // Auch der Notarzt aus NAW oder RTH begleitet – der Hubschrauber fliegt zur Klinik nach.
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
    } else if (
      isRdUnit(ctx, o) &&
      (o.task === 'onScene' || o.task === 'turnout' || o.task === 'toScene')
    ) {
      releaseVehicle(ctx, o, 'released');
    }
  }
}

function arriveAtHospital(ctx: Ctx, v: VehicleState): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  const seq = newTask(v, 'handover');
  setStatus(ctx, v, 8);
  if (incident && canTransport(ctx, v) && incident.hospitalArrivalAt === undefined) {
    incident.hospitalArrivalAt = ctx.state.time;
    // Ein Notfallpatient belegt einen Aufnahmeplatz der Fachabteilung.
    const dept = ctx.content.diagnoses.get(incident.truth.diagnosisId)?.department;
    if (!incident.order && v.hospitalId && dept) occupyBed(ctx, v.hospitalId, dept);
  }
  const handoverMs = incident?.order
    ? incident.order.handoverMs
    : rangeInt(
        ctx.rng.crews,
        isDoctorOnly(ctx, v)
          ? DOCTOR_HANDOVER_MINUTES
          : ctx.content.bundle.settings.times.handoverMinutes,
      ) * MS_PER_MINUTE;
  ctx.schedule(ctx.state.time + handoverMs, {
    kind: 'vehicle/handoverDone',
    vehicleId: v.id,
    seq,
  });
}

export function onHandoverDone(ctx: Ctx, v: VehicleState): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  // Nach einem Infektionstransport muss das Fahrzeug auf der Wache desinfiziert werden.
  const disinfect = !!incident?.truth.infectious && canTransport(ctx, v);
  releaseVehicle(ctx, v, 'status', disinfect);
}

/**
 * Fahrzeug aus dem Einsatz lösen: Status 1, Rückfahrt zur Wache – oder außer Dienst
 * (Desinfektion, Defekt, Tanken, Dienstende). Schließt ggf. den Einsatz.
 */
export function releaseVehicle(
  ctx: Ctx,
  v: VehicleState,
  message: RadioMessage,
  disinfect = false,
): void {
  const incident = v.incidentId ? findIncident(ctx, v.incidentId) : undefined;
  if (incident) incident.vehicleIds = incident.vehicleIds.filter((id) => id !== v.id);
  v.incidentId = null;
  v.hospitalId = null;
  delete v.requestSince;
  markFree(v, ctx.state.time);
  v.status = 1;
  radio(ctx, v, message);
  if (!afterMission(ctx, v, disinfect)) drive(ctx, v, v.homeNode, false, 'returning');
  if (incident) maybeClose(ctx, incident);
}

/**
 * Ein Einsatz ist erledigt, wenn kein Fahrzeug mehr gebunden ist, der Patient versorgt bzw. in
 * der Klinik ist und die Feuerwehrlage abgearbeitet ist. Fehlt noch etwas, ist er wieder offen.
 */
function maybeClose(ctx: Ctx, incident: IncidentState): void {
  if (incident.vehicleIds.length > 0 || incident.status !== 'active') return;
  const t = incident.truth;
  const patientDone =
    !t.patient ||
    incident.hospitalArrivalAt !== undefined ||
    (incident.assessed && !t.transport && !incident.order);
  const fireDone = !t.fire || t.fire.done;
  if (incident.assessed && patientDone && fireDone) closeIncident(ctx, incident);
  else incident.status = 'open';
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
