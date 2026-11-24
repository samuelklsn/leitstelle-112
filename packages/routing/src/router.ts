import type { RoadGraph } from './graph';
import { dijkstra, route, type Route, type ShortestPathTree } from './dijkstra';
import {
  computeEdgeTimes,
  validateTravelModel,
  type TravelContext,
  type TravelModel,
} from './travel-model';

/**
 * Bequeme Fassade: hält Kantenzeiten je Kontext im Cache (Stunde × Wochenende × Sonderrechte),
 * damit nicht jede Anfrage alle Kanten neu bewertet.
 */
export class Router {
  private readonly cache = new Map<string, Uint32Array>();
  /** Gesperrte Kanten (Baustellen, Veranstaltungen) und ihr Zeitfaktor. */
  private penalties: readonly number[] = [];
  private penaltyFactor = 1;

  constructor(
    readonly graph: RoadGraph,
    readonly model: TravelModel,
  ) {
    validateTravelModel(model);
  }

  edgeTimes(ctx: TravelContext): Uint32Array {
    const key = `${ctx.hour.toString()}|${ctx.weekend ? 1 : 0}|${ctx.emergency ? 1 : 0}|${(ctx.weather ?? 1).toString()}`;
    let times = this.cache.get(key);
    if (!times) {
      times = computeEdgeTimes(this.graph, this.model, ctx);
      for (const e of this.penalties) {
        const t = times[e];
        if (t !== undefined) times[e] = Math.min(0xffffffff, Math.round(t * this.penaltyFactor));
      }
      this.cache.set(key, times);
    }
    return times;
  }

  /**
   * Sperrungen: Diese Kanten sind um `factor` langsamer – Einsatzfahrzeuge kommen mit Absprache
   * notfalls noch durch, nehmen aber in aller Regel den Umweg. Leert den Cache bei Änderung.
   */
  setPenalties(edges: readonly number[], factor: number): void {
    const sorted = [...edges].sort((a, b) => a - b);
    if (
      factor === this.penaltyFactor &&
      sorted.length === this.penalties.length &&
      sorted.every((e, i) => e === this.penalties[i])
    )
      return;
    this.penalties = sorted;
    this.penaltyFactor = factor;
    this.cache.clear();
  }

  route(from: number, to: number, ctx: TravelContext): Route | undefined {
    return route(this.graph, this.edgeTimes(ctx), from, to);
  }

  /** Fahrzeiten aller Knoten *zum* Ziel (für Fahrzeugvorschläge). */
  timesTo(target: number, ctx: TravelContext): ShortestPathTree {
    return dijkstra(this.graph, this.edgeTimes(ctx), target, { reverse: true });
  }

  /** Fahrzeiten *vom* Start zu allen Knoten (z. B. Zielklinik-Entfernungen). */
  timesFrom(source: number, ctx: TravelContext): ShortestPathTree {
    return dijkstra(this.graph, this.edgeTimes(ctx), source);
  }
}
