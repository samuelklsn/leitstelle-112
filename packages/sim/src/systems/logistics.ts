/**
 * Rettungsdienst-Logistik (ADR-0015): Aufnahmebereitschaft der Kliniken, Dienstzeiten,
 * Besatzungswechsel und Pausen, Desinfektion, Defekte, Tanken sowie Transportaufträge.
 * Alle Zeiten und Anteile kommen aus den Inhalten (docs/domain/logistik.md).
 */
import { pickCumulative, pickWeighted, rangeInt, type Ctx } from '../context';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, TICK_MS, toCalendar, type SimTime } from '../time';
import type {
  CallerReport,
  HospitalState,
  IncidentState,
  RadioMessage,
  RejectReason,
  ServiceReason,
  TransportOrderState,
  VehicleState,
} from '../types';
import { isRestDay } from '../calendar';
import { countError } from './calls';
import { flyable } from './world';
import { closeIncident } from './outcome';
import {
  drive,
  findVehicle,
  isAir,
  isAvailable,
  isRdUnit,
  newTask,
  radio,
  setStatus,
} from './vehicles';

/** Unter dieser Tankfüllung fährt die Besatzung nach dem Einsatz tanken. */
export const FUEL_LOW = 0.25;
/** Takt, in dem sich die Belegung der Kliniken ändert. */
export const HOSPITAL_UPDATE_MS = 15 * MS_PER_MINUTE;
/** Wartet eine beantragte Pause so lange, erinnert die Besatzung per Funk. */
const BREAK_REMINDER_MS = 90 * MS_PER_MINUTE;
/** Unerledigte Aufträge werden so lange nach dem Termin storniert (anderer Anbieter). */
const ORDER_EXPIRE_MS = 3 * MS_PER_HOUR;
/** Termine liegen auf vollen fünf Minuten. */
const APPOINTMENT_SLOT_MS = 5 * MS_PER_MINUTE;

const START_MESSAGE: Record<ServiceReason, RadioMessage> = {
  disinfection: 'disinfection',
  defect: 'defect',
  refuel: 'refuel',
  break: 'breakStart',
  offDuty: 'offDuty',
  weather: 'grounded',
  external: 'externalMission',
};
const END_MESSAGE: Record<ServiceReason, RadioMessage> = {
  disinfection: 'disinfected',
  defect: 'repaired',
  refuel: 'refueled',
  break: 'breakEnd',
  offDuty: 'onDuty',
  weather: 'flyable',
  external: 'externalBack',
};

// ---------------------------------------------------------------------------- Kliniken

/** Startbelegung: Jede Abteilung hat schon einige Patienten aufgenommen. */
export function initialHospitals(ctx: Ctx): Record<string, HospitalState> {
  const rng = ctx.rng.hospitals;
  const out: Record<string, HospitalState> = {};
  for (const h of ctx.content.bundle.hospitals) {
    const free: Record<string, number> = {};
    for (const [dept, cap] of Object.entries(h.beds)) {
      free[dept] = cap - rng.nextInt(0, Math.floor(cap / 2));
    }
    out[h.id] = { free, closedUntil: {} };
  }
  return out;
}

/** Nimmt die Abteilung gerade Notfallpatienten auf? */
export function isDepartmentOpen(ctx: Ctx, hospitalId: string, dept: string): boolean {
  const s = ctx.state.hospitals[hospitalId];
  if (!s) return true;
  const closed = s.closedUntil[dept];
  if (closed !== undefined && closed > ctx.state.time) return false;
  const free = s.free[dept];
  return free === undefined || free > 0;
}

function emitStatus(
  ctx: Ctx,
  hospitalId: string,
  dept: string,
  open: boolean,
  reason: 'full' | 'closure',
): void {
  ctx.emit({
    type: 'hospital/status',
    at: ctx.state.time,
    hospitalId,
    department: dept,
    open,
    reason,
  });
}

/** Ein Notfallpatient belegt einen Aufnahmeplatz. */
export function occupyBed(ctx: Ctx, hospitalId: string, dept: string): void {
  const s = ctx.state.hospitals[hospitalId];
  const free = s?.free[dept];
  if (!s || free === undefined) return;
  const before = isDepartmentOpen(ctx, hospitalId, dept);
  s.free[dept] = Math.max(0, free - 1);
  if (before && !isDepartmentOpen(ctx, hospitalId, dept))
    emitStatus(ctx, hospitalId, dept, false, 'full');
}

/**
 * Belegung ändert sich: Patienten werden auf Station verlegt (Plätze frei), andere kommen hinzu
 * (Selbsteinweiser, Nachbarbereiche). Selten fällt ein Gerät aus und die Abteilung meldet sich ab.
 */
export function onHospitalUpdate(ctx: Ctx): void {
  const L = ctx.content.bundle.settings.logistics;
  const rng = ctx.rng.hospitals;
  const now = ctx.state.time;
  const { hour } = toCalendar(now);
  const load = ctx.content.bundle.settings.calls.hourlyProfile[hour] ?? 1;
  const steps = MS_PER_HOUR / HOSPITAL_UPDATE_MS;
  for (const h of ctx.content.bundle.hospitals) {
    const s = ctx.state.hospitals[h.id];
    if (!s) continue;
    for (const [dept, cap] of Object.entries(h.beds)) {
      const before = isDepartmentOpen(ctx, h.id, dept);
      let free = s.free[dept] ?? cap;
      const occupied = cap - free;
      for (let i = 0; i < occupied; i++) if (rng.chance(L.bedReleasePerHour / steps)) free++;
      if (rng.chance((L.bedOtherPerHour * load) / steps)) free = Math.max(0, free - 1);
      s.free[dept] = Math.min(cap, free);
      const after = isDepartmentOpen(ctx, h.id, dept);
      if (before !== after) emitStatus(ctx, h.id, dept, after, 'full');
    }
    const depts = Object.keys(h.beds);
    if (depts.length > 0 && rng.chance(L.closurePerDay / (MS_PER_DAY / HOSPITAL_UPDATE_MS))) {
      const dept = rng.pick(depts);
      const until = now + rangeInt(rng, L.closureHours) * MS_PER_HOUR;
      if ((s.closedUntil[dept] ?? 0) <= now) {
        const before = isDepartmentOpen(ctx, h.id, dept);
        s.closedUntil[dept] = until;
        if (before) emitStatus(ctx, h.id, dept, false, 'closure');
        ctx.schedule(until, { kind: 'hospital/reopen', hospitalId: h.id, department: dept });
      }
    }
  }
  ctx.schedule(now + HOSPITAL_UPDATE_MS, { kind: 'hospital/update' });
}

export function onHospitalReopen(ctx: Ctx, hospitalId: string, dept: string): void {
  const s = ctx.state.hospitals[hospitalId];
  const until = s?.closedUntil[dept];
  if (!s || until === undefined || until > ctx.state.time) return;
  // Löschen über eine neue Zuordnung – kein dynamischer delete-Zugriff auf Records.
  s.closedUntil = Object.fromEntries(Object.entries(s.closedUntil).filter(([d]) => d !== dept));
  if (isDepartmentOpen(ctx, hospitalId, dept)) emitStatus(ctx, hospitalId, dept, true, 'closure');
}

// ---------------------------------------------------------------------------- Dienst und Besatzung

/** Ist das Fahrzeug laut Dienstplan zu dieser Zeit besetzt? */
export function inService(ctx: Ctx, vehicleId: string, time: SimTime): boolean {
  const s = ctx.content.vehicleService.get(vehicleId);
  if (!s) return true;
  if (s.weekdaysOnly && isRestDay(ctx.content.bundle.holidays, time)) return false;
  const { from, to } = serviceHours(ctx, s, time);
  const hour = toCalendar(time).hour;
  return hour >= from && hour < to;
}

/** Dienststunden: fest oder – bei der Luftrettung – nach Tageslicht des Monats. */
function serviceHours(
  ctx: Ctx,
  s: { from: number; to: number; daylight: boolean },
  time: SimTime,
): { from: number; to: number } {
  if (!s.daylight) return s;
  const light = ctx.content.bundle.settings.daylight?.[toCalendar(time).month - 1];
  return light ? { from: light[0], to: light[1] } : s;
}

/** Dienstbeginn der Besatzung, die zum Zeitpunkt `time` im Dienst ist. */
function crewStart(ctx: Ctx, vehicleId: string, time: SimTime): SimTime {
  const cal = toCalendar(time);
  const dayStart = time - (cal.hour * 3600 + cal.minute * 60 + cal.second) * 1000;
  const service = ctx.content.vehicleService.get(vehicleId);
  if (service)
    return Math.min(time, dayStart + serviceHours(ctx, service, time).from * MS_PER_HOUR);
  const hours = [...ctx.content.bundle.settings.logistics.crewChangeHours].sort((a, b) => a - b);
  const today = hours.filter((h) => h <= cal.hour).at(-1);
  if (today !== undefined) return dayStart + today * MS_PER_HOUR;
  return dayStart - MS_PER_DAY + (hours.at(-1) ?? 0) * MS_PER_HOUR;
}

/** Logistik-Startwerte eines Fahrzeugs: Tankfüllung, Dienst, Besatzung. */
export function initVehicleLogistics(ctx: Ctx, v: VehicleState): void {
  const now = ctx.state.time;
  v.fuel = 0.45 + 0.55 * ctx.rng.logistics.nextFloat();
  v.onDuty = inService(ctx, v.id, now);
  v.crewSince = crewStart(ctx, v.id, now);
  v.breakTakenMs = 0;
  const grounded = v.onDuty && isAir(ctx, v) && !flyable(ctx);
  if (!v.onDuty || grounded) {
    v.status = 6;
    v.task = 'service';
    v.service = { reason: grounded ? 'weather' : 'offDuty', since: now };
  }
}

/** Einmal je Spielminute: Dienstbeginn und -ende, Besatzungswechsel, Pausenwünsche. */
export function updateLogistics(ctx: Ctx): void {
  const now = ctx.state.time;
  if (now % MS_PER_MINUTE !== 0) return;
  const cal = toCalendar(now);
  const fullHour = cal.minute === 0 && cal.second === 0;
  for (const v of ctx.state.vehicles) {
    // Die Feuerwehr plant ihre Besatzungen selbst; die Leitstelle disponiert nur.
    if (!isRdUnit(ctx, v)) continue;
    if (fullHour) updateDuty(ctx, v, cal.hour);
    if (isAir(ctx, v)) checkAir(ctx, v, fullHour);
    checkBreak(ctx, v);
  }
}

/**
 * Luftrettung: Bei Nebel, Sturm oder Schneefall bleibt der Hubschrauber am Boden. Zu jeder vollen
 * Stunde kann er außerdem zu einem Einsatz außerhalb des Bereichs gerufen werden.
 */
function checkAir(ctx: Ctx, v: VehicleState, fullHour: boolean): void {
  if (!v.onDuty) return;
  if (!flyable(ctx)) {
    if (!v.service && isAvailable(v)) goOutOfService(ctx, v, 'weather');
    return;
  }
  if (v.service?.reason === 'weather') {
    endOpenService(ctx, v, 'flyable');
    return;
  }
  const air = ctx.content.bundle.settings.air;
  if (
    fullHour &&
    !v.service &&
    isAvailable(v) &&
    v.node === v.homeNode &&
    ctx.rng.logistics.chance(air.externalPerHour)
  )
    goOutOfService(ctx, v, 'external');
}

/** Außer Dienst ohne festes Ende beenden (Wetter, Dienstbeginn): wieder einsatzbereit. */
function endOpenService(ctx: Ctx, v: VehicleState, message: RadioMessage): void {
  delete v.service;
  if (v.task === 'toService') {
    // Noch auf dem Heimweg: einfach weiterfahren, aber wieder einsatzbereit.
    v.task = 'returning';
    setStatus(ctx, v, 1, message);
  } else {
    newTask(v, 'idle');
    setStatus(ctx, v, 2, message);
  }
}

function updateDuty(ctx: Ctx, v: VehicleState, hour: number): void {
  const now = ctx.state.time;
  if (ctx.content.vehicleService.has(v.id)) {
    const should = inService(ctx, v.id, now);
    if (should && !v.onDuty) startDuty(ctx, v);
    else if (!should && v.onDuty) endDuty(ctx, v);
  } else if (ctx.content.bundle.settings.logistics.crewChangeHours.includes(hour)) {
    endCrew(ctx, v);
    startCrew(v, now);
  }
}

function startCrew(v: VehicleState, now: SimTime): void {
  v.crewSince = now;
  v.breakTakenMs = 0;
  delete v.breakRequestedAt;
}

/**
 * Schichtende einer Besatzung: Ohne die vorgeschriebene Pause ist das ein Verstoß gegen den
 * Arbeitszeitschutz. Läuft gerade ein Einsatz, macht die alte Besatzung Überstunden.
 */
function endCrew(ctx: Ctx, v: VehicleState): void {
  const L = ctx.content.bundle.settings.logistics;
  const now = ctx.state.time;
  const worked = now - v.crewSince;
  if (worked >= L.breakAfterHours * MS_PER_HOUR && v.breakTakenMs < L.breakMinutes * MS_PER_MINUTE)
    countError(ctx, 'breakMissed');
  if (v.incidentId !== null) v.overtimeSince ??= now;
}

function startDuty(ctx: Ctx, v: VehicleState): void {
  v.onDuty = true;
  startCrew(v, ctx.state.time);
  if (v.service?.reason !== 'offDuty') return;
  if (isAir(ctx, v) && !flyable(ctx)) {
    v.service.reason = 'weather';
    radio(ctx, v, 'grounded');
    return;
  }
  endOpenService(ctx, v, 'onDuty');
}

function endDuty(ctx: Ctx, v: VehicleState): void {
  v.onDuty = false;
  endCrew(ctx, v);
  // Im Einsatz oder in der Desinfektion: erst fertig werden, dann Dienstende.
  if (v.incidentId !== null || v.service) return;
  goOutOfService(ctx, v, 'offDuty');
}

/** Außer Dienst: auf der Wache sofort, sonst erst nach der Rückfahrt (Status 6 unterwegs). */
function goOutOfService(ctx: Ctx, v: VehicleState, reason: ServiceReason): void {
  v.service = { reason, since: ctx.state.time };
  if (!v.route && v.node === v.homeNode) {
    beginService(ctx, v, true);
    return;
  }
  v.status = 6;
  radio(ctx, v, START_MESSAGE[reason]);
  drive(ctx, v, v.homeNode, false, 'toService');
}

export function arriveForService(ctx: Ctx, v: VehicleState): void {
  if (!v.service) {
    newTask(v, 'idle');
    setStatus(ctx, v, 2);
    return;
  }
  beginService(ctx, v, false);
}

function serviceDuration(ctx: Ctx, reason: ServiceReason): number | undefined {
  const L = ctx.content.bundle.settings.logistics;
  const rng = ctx.rng.logistics;
  switch (reason) {
    case 'disinfection':
      return rangeInt(rng, L.disinfectionMinutes) * MS_PER_MINUTE;
    case 'defect':
      return rangeInt(rng, L.defectHours) * MS_PER_HOUR;
    case 'refuel':
      return rangeInt(rng, L.refuelMinutes) * MS_PER_MINUTE;
    case 'break':
      return L.breakMinutes * MS_PER_MINUTE;
    case 'external':
      return rangeInt(rng, ctx.content.bundle.settings.air.externalMinutes) * MS_PER_MINUTE;
    case 'offDuty':
    case 'weather':
      return undefined;
  }
}

function beginService(ctx: Ctx, v: VehicleState, announce: boolean): void {
  const service = v.service;
  if (!service) return;
  const seq = newTask(v, 'service');
  service.since = ctx.state.time;
  v.status = 6;
  if (announce) radio(ctx, v, START_MESSAGE[service.reason]);
  const duration = serviceDuration(ctx, service.reason);
  if (duration === undefined) return;
  service.until = ctx.state.time + duration;
  ctx.schedule(service.until, { kind: 'vehicle/serviceDone', vehicleId: v.id, seq });
}

export function onServiceDone(ctx: Ctx, v: VehicleState): void {
  const service = v.service;
  if (!service) return;
  if (service.reason === 'refuel') v.fuel = 1;
  if (service.reason === 'break') v.breakTakenMs += ctx.state.time - service.since;
  delete v.service;
  if (!v.onDuty) {
    goOutOfService(ctx, v, 'offDuty');
    return;
  }
  if (isAir(ctx, v) && !flyable(ctx)) {
    goOutOfService(ctx, v, 'weather');
    return;
  }
  newTask(v, 'idle');
  setStatus(ctx, v, 2, END_MESSAGE[service.reason]);
}

/**
 * Nach dem Einsatz: Defekt, Desinfektion, Dienstende oder Tanken? Gibt true zurück, wenn das
 * Fahrzeug außer Dienst geht – sonst fährt es normal zur Wache.
 */
export function afterMission(ctx: Ctx, v: VehicleState, disinfect: boolean): boolean {
  if (!isRdUnit(ctx, v)) return false;
  const now = ctx.state.time;
  if (v.overtimeSince !== undefined) {
    ctx.state.shift.overtimeMs += now - v.overtimeSince;
    delete v.overtimeSince;
  }
  const L = ctx.content.bundle.settings.logistics;
  let reason: ServiceReason | undefined;
  if (ctx.rng.logistics.chance(L.defectPerMission)) reason = 'defect';
  else if (disinfect) reason = 'disinfection';
  else if (!v.onDuty) reason = 'offDuty';
  else if (isAir(ctx, v) && !flyable(ctx)) reason = 'weather';
  else if (v.fuel < FUEL_LOW) reason = 'refuel';
  if (!reason) return false;
  goOutOfService(ctx, v, reason);
  return true;
}

function checkBreak(ctx: Ctx, v: VehicleState): void {
  if (!v.onDuty || v.service || !isAvailable(v)) return;
  const L = ctx.content.bundle.settings.logistics;
  const now = ctx.state.time;
  const due =
    now - v.crewSince >= L.breakAfterHours * MS_PER_HOUR &&
    v.breakTakenMs < L.breakMinutes * MS_PER_MINUTE;
  if (!due) return;
  if (v.breakRequestedAt === undefined || now - v.breakRequestedAt >= BREAK_REMINDER_MS) {
    v.breakRequestedAt = now;
    radio(ctx, v, 'requestBreak');
  }
}

/** Disponent genehmigt die beantragte Pause (auf der Wache, Status 6). */
export function grantBreak(ctx: Ctx, vehicleId: string): RejectReason | undefined {
  const v = findVehicle(ctx, vehicleId);
  if (!v) return 'unknownVehicle';
  if (v.breakRequestedAt === undefined || v.service || !v.onDuty) return 'noBreakDue';
  if (!isAvailable(v)) return 'vehicleBusy';
  delete v.breakRequestedAt;
  goOutOfService(ctx, v, 'break');
  return undefined;
}

/** Pause vorzeitig beenden: Das Fahrzeug ist sofort wieder einsatzbereit. */
export function resumeFromBreak(ctx: Ctx, vehicleId: string): RejectReason | undefined {
  const v = findVehicle(ctx, vehicleId);
  if (!v) return 'unknownVehicle';
  if (v.service?.reason !== 'break') return 'notOnBreak';
  const now = ctx.state.time;
  if (v.task === 'service') {
    v.breakTakenMs += now - v.service.since;
    delete v.service;
    newTask(v, 'idle');
    setStatus(ctx, v, 2, 'breakEnd');
  } else {
    delete v.service;
    v.task = 'returning';
    setStatus(ctx, v, 1, 'breakEnd');
  }
  return undefined;
}

// ---------------------------------------------------------------------------- Transportaufträge

/** Pünktlich abgeholt: spätestens Termin plus Toleranz. */
export function orderPickupOnTime(ctx: Ctx, order: TransportOrderState, at: SimTime): boolean {
  const tolerance = ctx.content.bundle.settings.transports.toleranceMinutes * MS_PER_MINUTE;
  return at <= order.dueAt + tolerance;
}

/** Aufträge als Bernoulli-Prozess je Tick, wie Notrufe – nur mit eigenem Tagesprofil. */
export function generateOrders(ctx: Ctx): void {
  const t = ctx.content.bundle.settings.transports;
  if (t.ratePer100k <= 0 || ctx.content.bundle.transportOrders.length === 0) return;
  if (ctx.config.tutorial) return;
  const { hour } = toCalendar(ctx.state.time);
  const perHour = (t.ratePer100k * ctx.content.population * ctx.config.callRateFactor) / 100_000;
  const rest = isRestDay(ctx.content.bundle.holidays, ctx.state.time) ? t.restDayFactor : 1;
  const p = (perHour * (t.hourlyProfile[hour] ?? 1) * rest * TICK_MS) / MS_PER_HOUR;
  if (ctx.rng.orders.chance(p)) createOrder(ctx);
}

/** Vorbestellte Aufträge zum Spielbeginn (nicht im Training). */
export function seedPreBookedOrders(ctx: Ctx): void {
  const t = ctx.content.bundle.settings.transports;
  if (ctx.config.tutorial || ctx.content.bundle.transportOrders.length === 0) return;
  for (let i = 0; i < t.preBooked; i++) {
    const lead = rangeInt(ctx.rng.orders, t.preBookedMinutes) * MS_PER_MINUTE;
    createOrder(ctx, undefined, lead);
  }
}

export function createOrder(ctx: Ctx, templateId?: string, leadMs?: number): IncidentState {
  const rng = ctx.rng.orders;
  const now = ctx.state.time;
  const tpl =
    (templateId !== undefined ? ctx.content.transportOrders.get(templateId) : undefined) ??
    pickWeighted(rng, ctx.content.bundle.transportOrders);
  const from = tpl.fromHospitals.length > 0 ? rng.pick(tpl.fromHospitals) : undefined;
  const targets = tpl.toHospitals.filter((h) => h !== from);
  const to = targets.length > 0 ? rng.pick(targets) : undefined;
  const home = ctx.world.houseIds[pickCumulative(rng, ctx.world.houseWeights)] ?? 0;
  const pickup = from !== undefined ? (ctx.content.hospitalAddress.get(from) ?? home) : home;
  const lead = leadMs ?? rangeInt(rng, tpl.leadMinutes) * MS_PER_MINUTE;
  const dueAt = Math.ceil((now + lead) / APPOINTMENT_SLOT_MS) * APPOINTMENT_SLOT_MS;
  const age = rangeInt(rng, tpl.ageRange);
  const sex = rng.chance(0.5) ? 'w' : 'm';
  const address = ctx.world.addresses[pickup];
  const report: CallerReport = {
    kind: 'caregiver',
    reportKey: 'order',
    streetId: address?.streetId ?? 0,
    number: address?.number ?? '',
    townId: address?.townId ?? null,
    toTownId: address?.toTownId ?? null,
    callback: '',
    ageGuess: age,
    sex,
    misjudge: 0,
    conscious: 'yes',
    breathing: 'normal',
  };
  const order: TransportOrderState = {
    templateId: tpl.id,
    dueAt,
    ...(from !== undefined ? { fromHospitalId: from } : {}),
    ...(to !== undefined ? { toHospitalId: to } : { toAddressId: home }),
    handoverMs: rangeInt(rng, tpl.handoverMinutes) * MS_PER_MINUTE,
  };
  const incident: IncidentState = {
    id: ctx.newId('T'),
    callId: '',
    receivedAt: now,
    createdAt: now,
    keywordId: tpl.keyword,
    addressId: pickup,
    truth: {
      diagnosisId: '',
      addressId: pickup,
      patient: true,
      age,
      sex,
      naca: rangeInt(rng, tpl.naca),
      needsDoctor: false,
      transport: true,
      onSceneMs: rangeInt(rng, tpl.pickupMinutes) * MS_PER_MINUTE,
      infectious: rng.chance(tpl.infectious),
    },
    report,
    callKind: 'order',
    order,
    status: 'open',
    vehicleIds: [],
    assessed: false,
    doctorRequested: false,
    locating: false,
    errors: [],
  };
  ctx.state.incidents.push(incident);
  ctx.state.shift.ordersReceived++;
  ctx.emit({ type: 'incident/created', at: now, incidentId: incident.id });
  ctx.schedule(dueAt + ORDER_EXPIRE_MS, { kind: 'order/expire', incidentId: incident.id });
  return incident;
}

/** Niemand kam: Der Auftrag geht an einen anderen Anbieter, der Patient wartete vergeblich. */
export function onOrderExpire(ctx: Ctx, incidentId: string): void {
  const incident = ctx.state.incidents.find((i) => i.id === incidentId);
  if (!incident || incident.status !== 'open' || incident.vehicleIds.length > 0) return;
  if (incident.order?.pickedUpAt !== undefined) return;
  if (!incident.errors.includes('transportLate')) {
    incident.errors.push('transportLate');
    countError(ctx, 'transportLate');
  }
  closeIncident(ctx, incident);
}
