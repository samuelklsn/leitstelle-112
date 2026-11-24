import { ROAD_CLASS_COUNT, type RoadGraph } from './graph';

/**
 * Fahrzeitmodell (ADR-0007). Alle Werte sind Daten und kommen später aus den Inhalten;
 * Herleitung und Quellen: docs/domain/fahrzeiten.md.
 */
export interface TravelModel {
  /** Durchschnittliche Reisegeschwindigkeit ohne Sonderrechte je Straßenklasse (km/h). */
  readonly baseKmh: readonly number[];
  /** Wie stark Verkehr die Klasse bremst (0 = gar nicht, 1 = voll). */
  readonly trafficSensitivity: readonly number[];
  /** Geschwindigkeitsfaktor mit Sonderrechten je Klasse (≥ 1). */
  readonly emergencyFactor: readonly number[];
  /** Verkehrsfaktor je Stunde (Werktag), 1 = frei, < 1 = zäh. */
  readonly weekdayTraffic: readonly number[];
  /** Verkehrsfaktor je Stunde (Samstag, Sonntag, Feiertag). */
  readonly weekendTraffic: readonly number[];
  /** Anteil des Verkehrseinflusses, der trotz Sonderrechten bleibt (0–1). */
  readonly emergencyTrafficShare: number;
}

export interface TravelContext {
  readonly hour: number;
  readonly weekend: boolean;
  readonly emergency: boolean;
  /** Zusätzlicher Faktor durch Wetter (1 = trocken). */
  readonly weather?: number;
}

/** Vorgabewerte für den Vertical Slice (Annahmen, docs/domain/fahrzeiten.md). */
export const DEFAULT_TRAVEL_MODEL: TravelModel = {
  //            Autobahn  B     L     K    innerorts Haupt  Wohn  Zufahrt
  baseKmh: [110, 80, 72, 62, 38, 26, 45],
  trafficSensitivity: [0.6, 0.6, 0.4, 0.3, 1.0, 0.5, 0.6],
  emergencyFactor: [1.08, 1.2, 1.22, 1.22, 1.45, 1.35, 1.2],
  weekdayTraffic: [
    1.05, 1.05, 1.05, 1.05, 1.05, 1.0, 0.92, 0.75, 0.78, 0.9, 0.93, 0.92, 0.88, 0.9, 0.9, 0.85,
    0.78, 0.75, 0.85, 0.93, 0.98, 1.0, 1.02, 1.05,
  ],
  weekendTraffic: [
    1.05, 1.05, 1.05, 1.05, 1.05, 1.05, 1.05, 1.03, 1.0, 0.97, 0.93, 0.9, 0.9, 0.92, 0.92, 0.92,
    0.93, 0.95, 0.97, 1.0, 1.02, 1.03, 1.03, 1.05,
  ],
  emergencyTrafficShare: 0.5,
};

export function validateTravelModel(model: TravelModel): void {
  const arrays: [string, readonly number[], number][] = [
    ['baseKmh', model.baseKmh, ROAD_CLASS_COUNT],
    ['trafficSensitivity', model.trafficSensitivity, ROAD_CLASS_COUNT],
    ['emergencyFactor', model.emergencyFactor, ROAD_CLASS_COUNT],
    ['weekdayTraffic', model.weekdayTraffic, 24],
    ['weekendTraffic', model.weekendTraffic, 24],
  ];
  for (const [name, arr, len] of arrays) {
    if (arr.length !== len || arr.some((v) => !(v > 0) && name !== 'trafficSensitivity')) {
      throw new RangeError(`TravelModel.${name}: ${len.toString()} positive Werte erwartet`);
    }
  }
}

/** Geschwindigkeit (m/s) einer Klasse im gegebenen Kontext. */
export function speedMps(model: TravelModel, roadClass: number, ctx: TravelContext): number {
  const base = (model.baseKmh[roadClass] ?? 30) / 3.6;
  const hourly = (ctx.weekend ? model.weekendTraffic : model.weekdayTraffic)[ctx.hour] ?? 1;
  const sensitivity = model.trafficSensitivity[roadClass] ?? 0;
  const share = ctx.emergency ? model.emergencyTrafficShare : 1;
  const traffic = 1 + sensitivity * share * (hourly - 1);
  const emergency = ctx.emergency ? (model.emergencyFactor[roadClass] ?? 1) : 1;
  return base * traffic * emergency * (ctx.weather ?? 1);
}

/** Fahrzeit je gerichteter Kante in ganzen Millisekunden (deterministisch). */
export function computeEdgeTimes(
  graph: RoadGraph,
  model: TravelModel,
  ctx: TravelContext,
): Uint32Array {
  const speeds = new Float64Array(ROAD_CLASS_COUNT);
  for (let c = 0; c < ROAD_CLASS_COUNT; c++) speeds[c] = speedMps(model, c, ctx);
  const times = new Uint32Array(graph.edgeCount);
  for (let e = 0; e < graph.edgeCount; e++) {
    const v = speeds[graph.edgeClass[e] ?? 0] ?? 1;
    times[e] = Math.max(1, Math.round(((graph.edgeLength[e] ?? 1) / v) * 1000));
  }
  return times;
}
