import type {
  ContentBundle,
  Diagnosis,
  Hospital,
  Keyword,
  Station,
  VehicleType,
} from '@ls112/content';
import { nearestNode, type Router, type TravelContext } from '@ls112/routing';
import type { Rng } from './rng';
import { toCalendar, type SimTime } from './time';
import type { RngStreamName, ScheduledPayload, SimConfig, SimEvent, SimState } from './types';
import type { World } from './world/types';

/** Schneller Zugriff auf Inhalte per ID, einmal je Simulation aufgebaut. */
export interface ContentIndex {
  readonly bundle: ContentBundle;
  readonly vehicleTypes: ReadonlyMap<string, VehicleType>;
  readonly stations: ReadonlyMap<string, Station>;
  readonly hospitals: ReadonlyMap<string, Hospital>;
  readonly keywords: ReadonlyMap<string, Keyword>;
  readonly diagnoses: ReadonlyMap<string, Diagnosis>;
  readonly diagnosisCumWeights: readonly number[];
  readonly hospitalNode: ReadonlyMap<string, number>;
  readonly stationNode: ReadonlyMap<string, number>;
  readonly population: number;
  /** Fahrzeugtypen, die einen Notarzt mitbringen. */
  readonly doctorTypes: ReadonlySet<string>;
}

export function indexContent(bundle: ContentBundle, world: World): ContentIndex {
  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
  let cum = 0;
  const diagnosisCumWeights = bundle.diagnoses.map((d) => (cum += d.weight));
  const snap = (p: readonly [number, number]) => nearestNode(world.graph, p[0], p[1]);
  return {
    bundle,
    vehicleTypes: byId(bundle.vehicleTypes),
    stations: byId(bundle.stations),
    hospitals: byId(bundle.hospitals),
    keywords: byId(bundle.keywords),
    diagnoses: byId(bundle.diagnoses),
    diagnosisCumWeights,
    hospitalNode: new Map(bundle.hospitals.map((h) => [h.id, snap(h.position)])),
    stationNode: new Map(bundle.stations.map((s) => [s.id, snap(s.position)])),
    population: bundle.region.towns.reduce((s, t) => s + t.population, 0),
    doctorTypes: new Set(bundle.vehicleTypes.filter((t) => t.doctor).map((t) => t.id)),
  };
}

/** Alles, was die Systeme eines Ticks brauchen. Der Zustand wird hier direkt verändert. */
export interface Ctx {
  readonly config: SimConfig;
  readonly content: ContentIndex;
  readonly world: World;
  readonly router: Router;
  readonly state: SimState;
  readonly rng: Readonly<Record<RngStreamName, Rng>>;
  schedule(at: SimTime, payload: ScheduledPayload): void;
  emit(event: SimEvent): void;
  newId(prefix: string): string;
}

export function travelContext(time: SimTime, emergency: boolean): TravelContext {
  const cal = toCalendar(time);
  return { hour: cal.hour, weekend: cal.weekday >= 6, emergency };
}

/** Gleichverteilte Ganzzahl aus einem Bereich [min, max]. */
export function rangeInt(rng: Rng, [min, max]: readonly [number, number]): number {
  return rng.nextInt(Math.round(min), Math.round(max));
}

/** Gewichtete Auswahl über kumulative Gewichte (binäre Suche). */
export function pickCumulative(rng: Rng, cumulative: ArrayLike<number>): number {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const r = rng.nextFloat() * total;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] ?? 0) > r) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function pickWeighted<T extends { weight: number }>(rng: Rng, items: readonly T[]): T {
  let cum = 0;
  const weights = items.map((i) => (cum += i.weight));
  return items[pickCumulative(rng, weights)] as T;
}
