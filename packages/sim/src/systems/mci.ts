/**
 * Massenanfall von Verletzten und Großlagen (ADR-0017): viele Patienten an einer Einsatzstelle,
 * Sichtung, Ladeplätze, Bereitstellungsraum, Patientenverteilung auf die Kliniken.
 *
 * Der Einsatzablauf (Alarm, Anfahrt, Transport, Übergabe) bleibt in `operations.ts`. Dieses Modul
 * entscheidet nur, was an der Einsatzstelle mit den Patienten passiert.
 */
import type { MciScenario } from '@ls112/content';
import { pickWeighted, rangeInt, type Ctx } from '../context';
import { MS_PER_DAY, MS_PER_MINUTE, TICK_MS } from '../time';
import type {
  IncidentState,
  MciPatient,
  MciTruth,
  TriageCategory,
  Truth,
  VehicleState,
} from '../types';
import { isDepartmentOpen } from './logistics';
import {
  canTransport,
  findVehicle,
  isAir,
  isDoctor,
  isRdUnit,
  radio,
  transportClassOf,
} from './vehicles';

export type Role = 'lna' | 'orgl' | 'gwsan';

export function roleOf(ctx: Ctx, v: VehicleState): Role | undefined {
  return ctx.content.vehicleTypes.get(v.typeId)?.role;
}

/** Sichten darf jeder Arzt – der Leitende Notarzt ist dafür da. */
function canTriage(ctx: Ctx, v: VehicleState): boolean {
  return isDoctor(ctx, v) || roleOf(ctx, v) === 'lna';
}

function onScene(ctx: Ctx, incident: IncidentState): VehicleState[] {
  return incident.vehicleIds
    .map((id) => findVehicle(ctx, id))
    .filter((v): v is VehicleState => !!v && v.task === 'onScene');
}

export function patientOf(incident: IncidentState, v: VehicleState): MciPatient | undefined {
  return v.mciPatientId !== undefined
    ? incident.truth.mci?.patients.find((p) => p.id === v.mciPatientId)
    : undefined;
}

// ---------------------------------------------------------------------------- Entstehung

/** Szenario nach Gewicht und Wetter (Massenkarambolage vor allem bei Nebel und Glätte). */
export function pickMciScenario(ctx: Ctx): MciScenario | undefined {
  const list = ctx.content.bundle.mciScenarios;
  if (list.length === 0) return undefined;
  const weather = ctx.state.world.weatherId;
  const items = list.map((s) => ({ s, weight: s.weight * (s.weather[weather] ?? 1) }));
  return pickWeighted(ctx.rng.patients, items).s;
}

const TRIAGE_DIAG: Record<TriageCategory, 'red' | 'yellow' | 'green'> = {
  1: 'red',
  2: 'yellow',
  3: 'green',
  4: 'red',
};

/** Die wahre Lage einer Großlage: Patienten mit Kategorie, Krankheitsbild und Transportbedarf. */
export function createMciTruth(ctx: Ctx, addressId: number, scenario: MciScenario): Truth {
  const rng = ctx.rng.patients;
  const count = rangeInt(rng, scenario.casualties);
  const t = scenario.triage;
  const categories = [
    { c: 1 as const, weight: t.red },
    { c: 2 as const, weight: t.yellow },
    { c: 3 as const, weight: t.green },
    { c: 4 as const, weight: t.black },
  ].filter((x) => x.weight > 0);
  const patients: MciPatient[] = [];
  for (let i = 0; i < count; i++) {
    const triage = pickWeighted(rng, categories).c;
    const list = scenario.diagnoses[TRIAGE_DIAG[triage]];
    const needsTransport =
      triage === 1 || triage === 2 || (triage === 3 && rng.chance(scenario.greenTransport));
    patients.push({
      id: (i + 1).toString(),
      triage,
      diagnosisId: rng.pick(list),
      needsTransport,
      state: 'waiting',
    });
  }
  // Mindestens ein Schwerverletzter – sonst wäre es keine Großlage.
  const first = patients[0];
  if (first && !patients.some((p) => p.triage === 1)) {
    patients[0] = {
      ...first,
      triage: 1,
      needsTransport: true,
      diagnosisId: rng.pick(scenario.diagnoses.red),
    };
  }
  const mci: MciTruth = {
    scenarioId: scenario.id,
    patients,
    autoDistribute: false,
    staging: false,
  };
  return {
    diagnosisId: '',
    addressId,
    patient: true,
    age: 40,
    sex: 'm',
    naca: 5,
    needsDoctor: true,
    transport: true,
    onSceneMs: 0,
    infectious: false,
    ...(scenario.fire
      ? {
          fire: {
            scenarioId: scenario.id,
            originalScenarioId: scenario.id,
            escalations: 0,
            done: false,
          },
        }
      : {}),
    mci,
  };
}

/** Großlagen sind selten: Wahrscheinlichkeit je Tick aus der Tagesrate. */
export function mciDueNow(ctx: Ctx): boolean {
  const perDay = ctx.content.bundle.settings.mci.perDay * ctx.config.callRateFactor;
  if (perDay <= 0 || ctx.config.tutorial || ctx.content.bundle.mciScenarios.length === 0)
    return false;
  return ctx.rng.calls.chance((perDay * TICK_MS) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------- Ablauf vor Ort

function scheduleTriage(ctx: Ctx, incident: IncidentState, range: readonly [number, number]): void {
  const mci = incident.truth.mci;
  if (!mci || mci.triagedAt !== undefined) return;
  const due = ctx.state.time + rangeInt(ctx.rng.crews, range) * MS_PER_MINUTE;
  if (mci.triageDue !== undefined && mci.triageDue <= due) return;
  mci.triageDue = due;
  ctx.schedule(due, { kind: 'mci/triage', incidentId: incident.id });
}

/** Erste Lagemeldung: geschätzte Zahl der Betroffenen, Sichtung beginnt. */
export function mciOnAssessed(ctx: Ctx, incident: IncidentState, v: VehicleState): void {
  radio(ctx, v, 'mciReport');
  const s = ctx.content.bundle.settings.mci;
  const doctor = onScene(ctx, incident).some((o) => canTriage(ctx, o));
  scheduleTriage(ctx, incident, doctor ? s.triageDoctorMinutes : s.triageCrewMinutes);
}

/** Ein Fahrzeug trifft ein: Arzt beschleunigt die Sichtung, Transportmittel bekommen Patienten. */
export function mciOnArrive(ctx: Ctx, incident: IncidentState, v: VehicleState): void {
  if (incident.assessed && canTriage(ctx, v))
    scheduleTriage(ctx, incident, ctx.content.bundle.settings.mci.triageDoctorMinutes);
  if (roleOf(ctx, v) === 'orgl' && incident.truth.mci?.staging) radio(ctx, v, 'stagingReady');
  mciAssign(ctx, incident);
}

export function onMciTriage(ctx: Ctx, incident: IncidentState): void {
  const mci = incident.truth.mci;
  if (!mci || mci.triagedAt !== undefined || mci.triageDue === undefined) return;
  if (ctx.state.time < mci.triageDue) return;
  mci.triagedAt = ctx.state.time;
  for (const p of mci.patients) if (p.triage === 4) p.state = 'deceased';
  const reporter =
    onScene(ctx, incident).find((o) => roleOf(ctx, o) === 'lna') ?? onScene(ctx, incident)[0];
  if (reporter) radio(ctx, reporter, 'triageDone');
  // Leichtverletzte ohne Transportbedarf werden vor Ort versorgt – mit GW-San schneller.
  const s = ctx.content.bundle.settings.mci;
  const gwsan = onScene(ctx, incident).some((o) => roleOf(ctx, o) === 'gwsan');
  const minutes = rangeInt(ctx.rng.crews, s.onSiteMinutes) * (gwsan ? 0.6 : 1);
  mci.onSiteDue = ctx.state.time + Math.round(minutes) * MS_PER_MINUTE;
  ctx.schedule(mci.onSiteDue, { kind: 'mci/onSite', incidentId: incident.id });
  mciAssign(ctx, incident);
}

/** Leichtverletzte vor Ort versorgt – sofern noch jemand vom Rettungsdienst vor Ort ist. */
export function onMciOnSite(ctx: Ctx, incident: IncidentState): boolean {
  const mci = incident.truth.mci;
  if (!mci || mci.onSiteDue === undefined || ctx.state.time < mci.onSiteDue) return false;
  const crew = onScene(ctx, incident).find((o) => isRdUnit(ctx, o));
  if (!crew) {
    mci.onSiteDue = ctx.state.time + 10 * MS_PER_MINUTE;
    ctx.schedule(mci.onSiteDue, { kind: 'mci/onSite', incidentId: incident.id });
    return false;
  }
  let any = false;
  for (const p of mci.patients) {
    if (p.triage === 3 && !p.needsTransport && p.state === 'waiting') {
      p.state = 'onSite';
      any = true;
    }
  }
  if (any) radio(ctx, crew, 'greenTreated');
  return true;
}

/** Wer darf welchen Patienten fahren? KTW nur Leichtverletzte, RTH bevorzugt Schwerverletzte. */
function suits(ctx: Ctx, v: VehicleState, p: MciPatient, doctorOnScene: boolean): boolean {
  if (!p.needsTransport || p.state !== 'waiting') return false;
  if (p.triage === 1 && !doctorOnScene) return false;
  const cls = transportClassOf(ctx, v.typeId);
  if (cls === 'krankentransport') return p.triage === 3;
  if (isAir(ctx, v)) return p.triage <= 2;
  return cls !== undefined;
}

/**
 * Freie Transportmittel an der Einsatzstelle übernehmen die dringendsten Patienten. Ohne
 * Bereitstellungsraum stauen sich Fahrzeuge an den Ladeplätzen und brauchen länger.
 */
export function mciAssign(ctx: Ctx, incident: IncidentState): void {
  const mci = incident.truth.mci;
  if (!mci || mci.triagedAt === undefined) return;
  const s = ctx.content.bundle.settings.mci;
  const here = onScene(ctx, incident);
  const doctorOnScene = here.some((o) => isDoctor(ctx, o));
  const orgl = here.some((o) => roleOf(ctx, o) === 'orgl');
  let loading = mci.patients.filter((p) => p.state === 'loading').length;
  const waiting = [...mci.patients].sort((a, b) => a.triage - b.triage);
  for (const v of here) {
    if (!canTransport(ctx, v) || v.mciPatientId !== undefined) continue;
    const p = waiting.find((x) => suits(ctx, v, x, doctorOnScene));
    if (!p) continue;
    p.state = 'loading';
    p.vehicleId = v.id;
    v.mciPatientId = p.id;
    const range = p.triage === 1 ? s.loadRed : p.triage === 2 ? s.loadYellow : s.loadGreen;
    let minutes = rangeInt(ctx.rng.crews, range);
    if (mci.staging && orgl) minutes += s.stagingMinutes;
    else if (loading >= s.loadingSlots)
      minutes += s.congestionMinutes * (loading - s.loadingSlots + 1);
    loading++;
    ctx.schedule(ctx.state.time + minutes * MS_PER_MINUTE, {
      kind: 'vehicle/sceneDone',
      vehicleId: v.id,
      seq: v.taskSeq,
    });
  }
}

/** Patient geladen, Transport beginnt. */
export function mciLoaded(incident: IncidentState, v: VehicleState): MciPatient | undefined {
  const p = patientOf(incident, v);
  if (p) p.state = 'transport';
  return p;
}

/** Fahrzeug wird abgezogen: Ein noch nicht geladener Patient wartet wieder. */
export function mciRelease(incident: IncidentState, v: VehicleState): void {
  const p = patientOf(incident, v);
  if (p && p.state === 'loading') {
    p.state = 'waiting';
    delete p.vehicleId;
  }
  delete v.mciPatientId;
}

export function mciDelivered(
  ctx: Ctx,
  incident: IncidentState,
  v: VehicleState,
): MciPatient | undefined {
  const p = patientOf(incident, v);
  if (!p) return undefined;
  p.state = 'delivered';
  p.deliveredAt = ctx.state.time;
  if (v.hospitalId) p.hospitalId = v.hospitalId;
  return p;
}

/** Alle Patienten versorgt: im Krankenhaus, vor Ort behandelt oder verstorben. */
export function mciDone(mci: MciTruth): boolean {
  return mci.patients.every(
    (p) => p.state === 'delivered' || p.state === 'onSite' || p.state === 'deceased',
  );
}

/**
 * Patientenverteilung nach Kapazität: geeignete Klinik mit freien Plätzen, die noch am wenigsten
 * Patienten dieser Lage bekommen hat – sonst die nächste geeignete.
 */
export function mciChooseHospital(
  ctx: Ctx,
  incident: IncidentState,
  patient: MciPatient,
  etaMs: (hospitalId: string) => number,
): string | undefined {
  const dept = ctx.content.diagnoses.get(patient.diagnosisId)?.department;
  const suitable = ctx.content.bundle.hospitals.filter(
    (h) => dept === undefined || h.departments.includes(dept),
  );
  if (suitable.length === 0) return ctx.content.bundle.hospitals[0]?.id;
  const assigned = (id: string) =>
    incident.truth.mci?.patients.filter((p) => p.hospitalId === id).length ?? 0;
  const ranked = [...suitable].sort((a, b) => {
    const openA = dept === undefined || isDepartmentOpen(ctx, a.id, dept);
    const openB = dept === undefined || isDepartmentOpen(ctx, b.id, dept);
    return (
      Number(openB) - Number(openA) ||
      // Schwerverletzte zuerst in die nächste Klinik, alle anderen verteilen.
      (patient.triage === 1 ? 0 : assigned(a.id) - assigned(b.id)) ||
      etaMs(a.id) - etaMs(b.id)
    );
  });
  return ranked[0]?.id;
}

/** Kräftebedarf nach der Lagemeldung: Transportmittel, Ärzte, Führung, Behandlungsplatz. */
export function mciNeeds(
  ctx: Ctx,
  incident: IncidentState,
  assigned: readonly VehicleState[],
): { type: string; count: number; alternatives: string[] }[] {
  const mci = incident.truth.mci;
  if (!mci) return [];
  const pts = mci.patients;
  const pending = pts.filter((p) => p.needsTransport && p.state === 'waiting');
  const critical = pending.filter((p) => p.triage <= 2).length;
  const green = pending.length - critical;
  const free = assigned.filter((v) => canTransport(ctx, v) && v.mciPatientId === undefined);
  const freeKtw = free.filter((v) => transportClassOf(ctx, v.typeId) === 'krankentransport').length;
  const freeEmergency = free.length - freeKtw;
  const types = ctx.content.bundle.vehicleTypes;
  const emergencyTypes = types
    .filter((t) => t.canTransport && (t.transportClass ?? 'notfall') === 'notfall' && !t.air)
    .map((t) => t.id);
  const ktwTypes = types.filter((t) => t.transportClass === 'krankentransport').map((t) => t.id);
  const doctorTypes = [...ctx.content.doctorTypes];
  const roleType = (r: Role) => types.find((t) => t.role === r)?.id;
  const needs: { type: string; count: number; alternatives: string[] }[] = [];
  const rtw = Math.min(6, Math.max(0, critical - freeEmergency));
  if (rtw > 0 && emergencyTypes[0])
    needs.push({ type: emergencyTypes[0], count: rtw, alternatives: emergencyTypes.slice(1) });
  const ktw = Math.min(4, Math.max(0, green - freeKtw - Math.max(0, freeEmergency - critical)));
  if (ktw > 0 && ktwTypes[0])
    needs.push({
      type: ktwTypes[0],
      count: ktw,
      alternatives: [...ktwTypes.slice(1), ...emergencyTypes],
    });
  const redLeft = pts.filter(
    (p) => p.triage === 1 && (p.state === 'waiting' || p.state === 'loading'),
  ).length;
  const doctors = assigned.filter((v) => isDoctor(ctx, v)).length;
  const wantDoctors = redLeft > 0 ? Math.min(3, Math.ceil(redLeft / 3)) : 0;
  if (wantDoctors > doctors && doctorTypes[0])
    needs.push({
      type: doctorTypes[0],
      count: wantDoctors - doctors,
      alternatives: doctorTypes.slice(1),
    });
  const has = (r: Role) => assigned.some((v) => roleOf(ctx, v) === r);
  const lna = roleType('lna');
  if (lna && pts.length >= 5 && mci.triagedAt === undefined && !has('lna'))
    needs.push({ type: lna, count: 1, alternatives: [] });
  const orgl = roleType('orgl');
  if (orgl && pts.length >= 10 && !mciDone(mci) && !has('orgl'))
    needs.push({ type: orgl, count: 1, alternatives: [] });
  const gwsan = roleType('gwsan');
  const onSiteGreen = pts.filter(
    (p) => p.triage === 3 && !p.needsTransport && p.state === 'waiting',
  );
  if (gwsan && onSiteGreen.length >= 5 && !has('gwsan'))
    needs.push({ type: gwsan, count: 1, alternatives: [] });
  return needs;
}

/** Spieler schaltet Patientenverteilung oder Bereitstellungsraum. */
export function setMciOption(
  incident: IncidentState | undefined,
  option: 'autoDistribute' | 'staging',
  on: boolean,
): 'unknownIncident' | 'notMci' | undefined {
  if (!incident) return 'unknownIncident';
  const mci = incident.truth.mci;
  if (!mci) return 'notMci';
  mci[option] = on;
  return undefined;
}
