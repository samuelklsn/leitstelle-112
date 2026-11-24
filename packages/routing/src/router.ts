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
      this.cache.set(key, times);
    }
    return times;
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
