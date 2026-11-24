/**
 * Gemeinsame Bausteine für Fahrzeuge: Einordnung (RD, Feuerwehr, Transportklasse), Funk,
 * Status, Fahrten und Kraftstoff. Genutzt von Einsatzablauf und Logistik.
 */
import { MS_PER_HOUR } from '../time';
import { travelContext, type Ctx } from '../context';
import type { SimTime } from '../time';
import type { FmsStatus, RadioMessage, RouteState, VehicleState, VehicleTask } from '../types';

export function findVehicle(ctx: Ctx, id: string): VehicleState | undefined {
  return ctx.state.vehicles.find((v) => v.id === id);
}

export function isDoctor(ctx: Ctx, v: VehicleState): boolean {
  return ctx.content.doctorTypes.has(v.typeId);
}

/** Kann überhaupt Patienten transportieren (RTW, KTW, ITW, NAW). */
export function canTransport(ctx: Ctx, v: VehicleState): boolean {
  return ctx.content.vehicleTypes.get(v.typeId)?.canTransport ?? false;
}

export type TransportClass = 'notfall' | 'krankentransport' | 'intensiv';

export function transportClassOf(ctx: Ctx, typeId: string): TransportClass | undefined {
  const t = ctx.content.vehicleTypes.get(typeId);
  if (!t?.canTransport) return undefined;
  return t.transportClass ?? 'notfall';
}

/** Darf Notfallpatienten transportieren und zählt für die Hilfsfrist (RTW, NAW). */
export function isEmergencyTransport(ctx: Ctx, v: VehicleState): boolean {
  return transportClassOf(ctx, v.typeId) === 'notfall';
}

/** Reines Notarzt-Zubringerfahrzeug (NEF) – nicht der NAW, der selbst transportiert. */
export function isDoctorOnly(ctx: Ctx, v: VehicleState): boolean {
  return isDoctor(ctx, v) && !canTransport(ctx, v);
}

/** Feuerwehrfahrzeug = weder Transportmittel noch Notarzt. */
export function isFireUnit(ctx: Ctx, v: VehicleState): boolean {
  return !canTransport(ctx, v) && !isDoctor(ctx, v);
}

/** Rettungsdienst-Fahrzeug (RTW, NEF, KTW …). */
export function isRdUnit(ctx: Ctx, v: VehicleState): boolean {
  return !isFireUnit(ctx, v);
}

export function isAvailable(v: VehicleState): boolean {
  return v.incidentId === null && (v.status === 1 || v.status === 2);
}

export function radio(ctx: Ctx, v: VehicleState, message: RadioMessage): void {
  ctx.emit({
    type: 'radio',
    at: ctx.state.time,
    vehicleId: v.id,
    status: v.status,
    message,
    incidentId: v.incidentId,
  });
}

export function setStatus(
  ctx: Ctx,
  v: VehicleState,
  status: FmsStatus,
  message: RadioMessage = 'status',
): void {
  v.status = status;
  radio(ctx, v, message);
}

export function newTask(v: VehicleState, task: VehicleTask): number {
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

/**
 * Kraftstoff: Die gefahrene Zeit der laufenden Route wird abgebucht, bevor sie endet oder ersetzt
 * wird. Fahrzeit statt Strecke genügt – Einsatzfahrten sind ohnehin kurz und innerörtlich.
 */
export function accountDriving(ctx: Ctx, v: VehicleState, time: SimTime): void {
  const r = v.route;
  if (!r) return;
  const driven = Math.min(Math.max(0, time - r.startedAt), r.cumulativeMs.at(-1) ?? 0);
  const hours = ctx.content.bundle.settings.logistics.fuelHours;
  v.fuel = Math.max(0, v.fuel - driven / (hours * MS_PER_HOUR));
}

/**
 * Startet eine Fahrt und plant die Ankunft. Ist das Fahrzeug gerade unterwegs, fährt es bis zur
 * nächsten Kreuzung weiter und biegt dort ab – kein Zurückspringen auf der Karte, und ein
 * Wendemanöver mitten auf der Strecke gibt es auch in der Realität nicht.
 */
export function drive(
  ctx: Ctx,
  v: VehicleState,
  target: number,
  emergency: boolean,
  task: VehicleTask,
): void {
  const now = ctx.state.time;
  accountDriving(ctx, v, now);
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

export function markBusy(v: VehicleState, time: SimTime): void {
  v.busySince ??= time;
}

export function markFree(v: VehicleState, time: SimTime): void {
  if (v.busySince !== undefined) {
    v.busyMs += time - v.busySince;
    delete v.busySince;
  }
}
