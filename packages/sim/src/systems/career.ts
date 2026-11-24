/**
 * Langzeitspiel (ADR-0018): Laufbahn über viele Schichten und Bedarfsplanung. Gute Schichten
 * bringen Erfahrung und Budget; höhere Stufen übernehmen einen größeren Bereich (mehr Notrufe).
 * Mit Budget und eigener Statistik lassen sich zusätzliche Fahrzeuge beantragen.
 */
import type { Ctx } from '../context';
import type { CareerState, RejectReason, ShiftStats, VehicleState } from '../types';

export function initialCareer(): CareerState {
  return { rank: 0, xp: 0, budget: 0, shifts: 0, extraVehicles: [] };
}

/** Faktor auf das Aufkommen: Wer aufsteigt, übernimmt mehr Fläche und Einwohner. */
export function areaFactor(ctx: Pick<Ctx, 'content' | 'state'>): number {
  const ranks = ctx.content.bundle.settings.career.ranks;
  return ranks[Math.min(ctx.state.career.rank, ranks.length - 1)]?.area ?? 1;
}

/** Schichtende: Erfahrung und Budget gutschreiben, ggf. befördern. */
export function careerAfterShift(ctx: Ctx, shift: ShiftStats): void {
  const c = ctx.state.career;
  const settings = ctx.content.bundle.settings.career;
  const points = Math.max(0, shift.score);
  c.shifts++;
  c.xp += points;
  c.budget += Math.round(points * settings.budgetPerPoint);
  const next = settings.ranks[c.rank + 1];
  if (next && c.xp >= next.xp) {
    c.rank++;
    ctx.emit({ type: 'career/promoted', at: ctx.state.time, rank: c.rank });
  }
}

const KIND_TYPE = {
  rtw: 'base:rtw',
  rtwDay: 'base:rtw',
  ktw: 'base:ktw',
  nef: 'base:nef',
} as const;
const RADIO_CODE: Record<string, number> = { 'base:rtw': 83, 'base:ktw': 85, 'base:nef': 82 };

/**
 * Antrag auf ein zusätzliches Fahrzeug. Begründet ist er, wenn die Fahrzeuge dieses Typs an der
 * Wache in der letzten Schicht stark ausgelastet waren oder die Hilfsfrist verfehlt wurde.
 */
export function requestVehicle(
  ctx: Ctx,
  stationId: string,
  kind: keyof typeof KIND_TYPE,
): RejectReason | VehicleState {
  const station = ctx.content.stations.get(stationId);
  if (!station || station.kind === 'feuerwache' || station.reserve) return 'unknownStation';
  const settings = ctx.content.bundle.settings.career;
  const cost = settings.costs[kind];
  const c = ctx.state.career;
  if (c.budget < cost) return 'noBudget';
  const typeId = KIND_TYPE[kind];
  const last = ctx.state.shiftHistory.at(-1);
  const duration = last?.endedAt !== undefined ? last.endedAt - last.startedAt : 0;
  const ofType = ctx.state.vehicles.filter((v) => v.stationId === stationId && v.typeId === typeId);
  const busy = ofType.map((v) => last?.vehicleBusyMs?.[v.id] ?? 0);
  const utilization =
    duration > 0 && busy.length > 0 ? busy.reduce((a, b) => a + b, 0) / busy.length / duration : 0;
  const quota =
    last && last.hilfsfristMeasured > 0 ? last.hilfsfristMet / last.hilfsfristMeasured : 1;
  const target = ctx.content.bundle.settings.hilfsfrist.targetQuota;
  // Ohne Fahrzeug dieses Typs an der Wache zählt die Hilfsfrist als Begründung.
  const justified =
    (busy.length > 0 && utilization >= settings.justifyUtilization) || quota < target;
  if (!justified) return 'notJustified';
  c.budget -= cost;
  const n = c.extraVehicles.length + 1;
  const prefix = station.vehicles[0]?.callsign.replace(/\s\d+\/\d+-\d+$/, '') ?? 'Rettung';
  const stationNo = /(\d+)\/\d+-\d+$/.exec(station.vehicles[0]?.callsign ?? '')?.[1] ?? '9';
  const extra = {
    id: `plan:${kind}-${n.toString()}`,
    stationId,
    typeId,
    callsign: `${prefix} ${stationNo}/${(RADIO_CODE[typeId] ?? 89).toString()}-${(20 + n).toString()}`,
    ...(kind === 'rtwDay' ? { service: { from: 8, to: 20 } } : {}),
  };
  c.extraVehicles.push(extra);
  const home = ctx.content.stationNode.get(stationId) ?? 0;
  const v: VehicleState = {
    id: extra.id,
    typeId,
    stationId,
    homeNode: home,
    status: 2,
    task: 'idle',
    taskSeq: 0,
    incidentId: null,
    node: home,
    route: null,
    hospitalId: null,
    busyMs: 0,
    fuel: 1,
    onDuty: true,
    crewSince: ctx.state.time,
    breakTakenMs: 0,
  };
  ctx.state.vehicles.push(v);
  ctx.emit({ type: 'planning/approved', at: ctx.state.time, vehicleId: v.id, stationId });
  return v;
}

/** Dienstzeit eines beantragten Fahrzeugs (Tages-RTW). */
export function extraService(
  ctx: Pick<Ctx, 'state'>,
  vehicleId: string,
): { from: number; to: number; weekdaysOnly: boolean; daylight: boolean } | undefined {
  const e = ctx.state.career.extraVehicles.find((x) => x.id === vehicleId);
  return e?.service ? { ...e.service, weekdaysOnly: false, daylight: false } : undefined;
}
