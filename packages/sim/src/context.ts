import type {
  ContentBundle,
  Diagnosis,
  FireScenario,
  Hospital,
  Keyword,
  Service,
  Station,
  TransportOrder,
  VehicleType,
  Weather,
  WorldEvent,
} from '@ls112/content';
import { nearestNode, type Router, type TravelContext } from '@ls112/routing';
import { isRestDay } from './calendar';
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
  readonly fireScenarios: ReadonlyMap<string, FireScenario>;
  readonly fireCumWeights: readonly number[];
  /** Wachenspezifische Ausrückzeiten (Freiwillige Feuerwehr). */
  readonly stationTurnout: ReadonlyMap<
    string,
    { day: readonly [number, number]; night: readonly [number, number] }
  >;
  readonly hospitalNode: ReadonlyMap<string, number>;
  readonly stationNode: ReadonlyMap<string, number>;
  readonly population: number;
  /** Fahrzeugtypen, die einen Notarzt mitbringen. */
  readonly doctorTypes: ReadonlySet<string>;
  readonly transportOrders: ReadonlyMap<string, TransportOrder>;
  /** Dienstzeiten je Fahrzeug (nur Fahrzeuge, die nicht rund um die Uhr besetzt sind). */
  readonly vehicleService: ReadonlyMap<string, Service>;
  /** Nächste Adresse je Klinik – Abholort bei Verlegungen und Entlassungen. */
  readonly hospitalAddress: ReadonlyMap<string, number>;
  readonly weather: ReadonlyMap<string, Weather>;
  readonly worldEvents: ReadonlyMap<string, WorldEvent>;
  /** Hausadressen je Ort (Einsatzorte bei Ereignissen wie dem Volksfest). */
  readonly townHouses: ReadonlyMap<string, readonly number[]>;
}

export function indexContent(bundle: ContentBundle, world: World): ContentIndex {
  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
  let cum = 0;
  // Krankheitsbilder, die nur als Verletzte einer Feuerwehrlage vorkommen, zählen nicht mit.
  const diagnosisCumWeights = bundle.diagnoses.map((d) => (cum += d.onlyAsCasualty ? 0 : d.weight));
  let fireCum = 0;
  const fireCumWeights = bundle.fireScenarios.map((s) => (fireCum += s.weight));
  const snap = (p: readonly [number, number]) => nearestNode(world.graph, p[0], p[1]);
  return {
    bundle,
    vehicleTypes: byId(bundle.vehicleTypes),
    stations: byId(bundle.stations),
    hospitals: byId(bundle.hospitals),
    keywords: byId(bundle.keywords),
    diagnoses: byId(bundle.diagnoses),
    diagnosisCumWeights,
    fireScenarios: byId(bundle.fireScenarios),
    fireCumWeights,
    stationTurnout: new Map(
      bundle.stations.flatMap((s) => (s.turnout ? [[s.id, s.turnout] as const] : [])),
    ),
    hospitalNode: new Map(bundle.hospitals.map((h) => [h.id, snap(h.position)])),
    stationNode: new Map(bundle.stations.map((s) => [s.id, snap(s.position)])),
    population: bundle.region.towns.reduce((s, t) => s + t.population, 0),
    doctorTypes: new Set(bundle.vehicleTypes.filter((t) => t.doctor).map((t) => t.id)),
    transportOrders: byId(bundle.transportOrders),
    vehicleService: new Map(
      bundle.stations.flatMap((s) =>
        s.vehicles.flatMap((v) => (v.service ? [[v.id, v.service] as const] : [])),
      ),
    ),
    hospitalAddress: new Map(
      bundle.hospitals.map((h) => [h.id, nearestAddress(world, h.position)] as const),
    ),
    weather: byId(bundle.weather),
    worldEvents: byId(bundle.worldEvents),
    townHouses: housesByTown(world),
  };
}

function housesByTown(world: World): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const a of world.addresses) {
    if (a.kind !== 'house') continue;
    const list = out.get(a.townId) ?? [];
    list.push(a.id);
    out.set(a.townId, list);
  }
  return out;
}

function nearestAddress(world: World, [x, y]: readonly [number, number]): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (const a of world.addresses) {
    if (a.kind !== 'house') continue;
    const d = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
    if (d < bestD) {
      bestD = d;
      best = a.id;
    }
  }
  return best;
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

/**
 * Verkehrslage für eine Fahrt jetzt: Uhrzeit, Ruhetag (Wochenende, Feiertag), Sonderrechte und
 * Wetter. Der Wetterfaktor wird gerundet, damit der Kantenzeit-Cache klein bleibt.
 */
export function travelContext(
  ctx: Pick<Ctx, 'content' | 'state'>,
  emergency: boolean,
): TravelContext {
  const time = ctx.state.time;
  const cal = toCalendar(time);
  const weather = ctx.content.weather.get(ctx.state.world.weatherId)?.speed ?? 1;
  return {
    hour: cal.hour,
    weekend: isRestDay(ctx.content.bundle.holidays, time),
    emergency,
    weather: Math.round(weather * 100) / 100,
  };
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
