/**
 * Szenen-Feed für die 3D-Darstellung (ADR-0022): übersetzt Welt- und Zustandsdaten des Sim-Hosts
 * in ein knappes Format für RealityKit – lokale Meter statt Länge/Breite, Zahlenreihen statt
 * Objekten. Reine Darstellung: Hier wird nichts entschieden, nur umgeformt (Regel 4).
 */
import type { HostState, WorldInfo } from '@ls112/protocol';

/** Straßenklassen wie im Kern (`RoadClass`), als Zahl für Swift. */
const ROAD_CLASS: Record<string, number> = {
  motorway: 0,
  primary: 1,
  secondary: 2,
  tertiary: 3,
  urban_main: 4,
  residential: 5,
  link: 6,
};

export type StationKind = 'rettungswache' | 'notarztstandort' | 'feuerwache' | 'luftrettung';

/** Statische 3D-Welt, einmal je Spiel. */
export interface SceneWorld {
  readonly type: 'world';
  readonly size: readonly [number, number];
  /** Je Straßenabschnitt: Klasse, x1, y1, x2, y2 (Meter). */
  readonly roads: readonly (readonly [number, number, number, number, number])[];
  /** Flüsse als Linienzug mit Breite. */
  readonly rivers: readonly { readonly width: number; readonly points: readonly number[] }[];
  /** Wälder als Polygon (x, y abwechselnd). */
  readonly forests: readonly (readonly number[])[];
  readonly towns: readonly {
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly population: number;
    readonly city: boolean;
  }[];
  /** Wohnhäuser: x, y je Adresse (Gebäude entstehen in Swift daraus). */
  readonly houses: readonly number[];
  readonly stations: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: StationKind;
    readonly x: number;
    readonly y: number;
  }[];
  readonly hospitals: readonly {
    readonly id: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
  }[];
}

export type VehicleClass = 'rtw' | 'ktw' | 'nef' | 'rth' | 'fire' | 'command' | 'other';
export type IncidentClass = 'rd' | 'fire' | 'th' | 'mci';

/** Bewegliche Lage, bis zu 10-mal je Sekunde. */
export interface SceneState {
  readonly type: 'state';
  readonly gameId: number;
  readonly paused: boolean;
  readonly speed: number;
  /** Tageszeit in Stunden (0–24, mit Minuten) – für Sonnenstand und Beleuchtung. */
  readonly hour: number;
  readonly weatherId: string;
  readonly clock: string;
  readonly vehicles: readonly {
    readonly id: string;
    readonly label: string;
    readonly cls: VehicleClass;
    readonly x: number;
    readonly y: number;
    readonly status: number;
    readonly moving: boolean;
    readonly emergency: boolean;
  }[];
  readonly incidents: readonly {
    readonly id: string;
    readonly label: string;
    readonly cls: IncidentClass;
    readonly x: number;
    readonly y: number;
    readonly open: boolean;
  }[];
  /** Wartende Notrufe – im Leitstellenraum blinkt dann das Telefon. */
  readonly waitingCalls: number;
}

/** Länge/Breite zurück in lokale Meter (Umkehrung von `toLonLat` im Kern, lineare Näherung). */
function toMeters(world: WorldInfo, lonLat: readonly number[]): [number, number] {
  const g = world.geo;
  return [
    Math.round(((lonLat[0] ?? 0) - g.originLon) * g.metersPerDegLon),
    Math.round(((lonLat[1] ?? 0) - g.originLat) * g.metersPerDegLat),
  ];
}

type Position = readonly number[];

function lineCoordinates(geometry: { type: string; coordinates: unknown }): Position[] {
  if (geometry.type === 'LineString') return geometry.coordinates as Position[];
  if (geometry.type === 'Polygon') return (geometry.coordinates as Position[][])[0] ?? [];
  return [];
}

export function toSceneWorld(world: WorldInfo): SceneWorld {
  const map = world.map;
  const [min, max] = map.bounds;
  const [w, h] = toMeters(world, max);
  const [x0, y0] = toMeters(world, min);

  const roads = map.roads.features.map((f) => {
    const [a, b] = lineCoordinates(f.geometry);
    const p = toMeters(world, a ?? []);
    const q = toMeters(world, b ?? []);
    const cls = ROAD_CLASS[String(f.properties['cls'])] ?? 5;
    return [cls, p[0], p[1], q[0], q[1]] as const;
  });

  const rivers = map.water.features
    .filter((f) => f.geometry.type === 'LineString')
    .map((f) => ({
      width: Number(f.properties['width'] ?? 20),
      points: lineCoordinates(f.geometry).flatMap((c) => toMeters(world, c)),
    }));

  const forests = map.areas.features
    .filter((f) => f.properties['kind'] === 'forest')
    .map((f) => lineCoordinates(f.geometry).flatMap((c) => toMeters(world, c)));

  const towns = map.labels.features.map((f) => {
    const [x, y] = toMeters(world, f.geometry.coordinates as Position);
    return {
      name: String(f.properties['name'] ?? ''),
      x,
      y,
      population: Number(f.properties['population'] ?? 0),
      city: f.properties['kind'] === 'kreisstadt' || f.properties['kind'] === 'stadt',
    };
  });

  return {
    type: 'world',
    size: [w - x0, h - y0],
    roads,
    rivers,
    forests,
    towns,
    houses: world.addresses.filter((a) => a.kind === 'house').flatMap((a) => [a.x, a.y]),
    stations: world.stations.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      x: s.position[0],
      y: s.position[1],
    })),
    hospitals: world.hospitals.map((hp) => ({
      id: hp.id,
      name: hp.name,
      x: hp.position[0],
      y: hp.position[1],
    })),
  };
}

/** Fahrzeugklasse aus dem Fahrzeugtyp – bestimmt Modell und Lackierung in 3D. */
export function vehicleClass(
  type: WorldInfo['vehicleTypes'][number] | undefined,
  stationKind?: StationKind,
): VehicleClass {
  if (!type) return 'other';
  if (type.air) return 'rth';
  if (type.role === 'orgl' || type.role === 'lna') return 'command';
  if (stationKind === 'feuerwache') return 'fire';
  if (type.doctor && !type.canTransport) return 'nef';
  if (type.transportClass === 'krankentransport') return 'ktw';
  if (type.canTransport) return 'rtw';
  return 'other';
}

/** Einsatzart grob aus dem Stichwort – nur für das Symbol am Einsatzort. */
export function incidentClass(code: string, mci: boolean): IncidentClass {
  if (mci) return 'mci';
  const c = code.trim().toUpperCase();
  if (c.startsWith('TH')) return 'th';
  if (c.startsWith('B') || c.startsWith('F')) return 'fire';
  return 'rd';
}

/** Nachschlagetabellen je Welt – einmal bauen, dann bei jedem Zustand wiederverwenden. */
export function createStateMapper(world: WorldInfo): (host: HostState) => SceneState {
  const types = new Map(world.vehicleTypes.map((t) => [t.id, t]));
  const vehicles = new Map<string, { label: string; cls: VehicleClass }>();
  for (const st of world.stations)
    for (const v of st.vehicles)
      vehicles.set(v.id, {
        label: `${types.get(v.type)?.short ?? ''} ${v.callsign.replace(/^.*?\s(?=\d)/, '')}`.trim(),
        cls: vehicleClass(types.get(v.type), st.kind),
      });
  const addresses = new Map(world.addresses.map((a) => [a.id, a]));
  const keywords = new Map(world.keywords.map((k) => [k.id, k]));

  return (host) => {
    const view = host.view;
    return {
      type: 'state',
      gameId: host.gameId,
      paused: host.paused,
      speed: host.speed,
      hour: view.calendar.hour + view.calendar.minute / 60,
      weatherId: view.world.weatherId,
      clock: `${view.calendar.hour.toString().padStart(2, '0')}:${view.calendar.minute.toString().padStart(2, '0')}`,
      vehicles: view.vehicles
        .filter((v) => v.onDuty || v.moving || v.incidentId !== null)
        .map((v) => {
          const info = vehicles.get(v.id);
          return {
            id: v.id,
            label: info?.label ?? v.id,
            cls: info?.cls ?? 'other',
            x: Math.round(v.x),
            y: Math.round(v.y),
            status: v.status,
            moving: v.moving,
            emergency: v.emergency,
          };
        }),
      incidents: view.incidents
        .filter((i) => i.status !== 'closed')
        .flatMap((i) => {
          const a = addresses.get(i.addressId);
          if (!a) return [];
          const k = keywords.get(i.keywordId);
          return [
            {
              id: i.id,
              label: k?.code ?? '',
              cls: incidentClass(k?.code ?? '', k?.mci === true || i.mci !== undefined),
              x: a.x,
              y: a.y,
              open: i.status === 'open',
            },
          ];
        }),
      waitingCalls: view.calls.filter((c) => c.status === 'waiting').length,
    };
  };
}
