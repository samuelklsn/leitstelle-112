import { RoadClass } from '@ls112/routing';
import { degToRad, detCos, detSin, type Vec } from './geometry';
import type { World } from './types';

/** Minimale GeoJSON-Typen – genug für MapLibre, ohne zusätzliche Abhängigkeit. */
export interface GeoFeature {
  readonly type: 'Feature';
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  readonly geometry:
    | { readonly type: 'Point'; readonly coordinates: readonly [number, number] }
    | { readonly type: 'LineString'; readonly coordinates: readonly (readonly [number, number])[] }
    | {
        readonly type: 'Polygon';
        readonly coordinates: readonly (readonly (readonly [number, number])[])[];
      };
}

export interface GeoCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoFeature[];
}

export interface WorldMap {
  readonly bounds: readonly [[number, number], [number, number]];
  readonly roads: GeoCollection;
  readonly areas: GeoCollection;
  readonly water: GeoCollection;
  readonly labels: GeoCollection;
  readonly attribution: string | null;
}

/** Umrechnung lokaler Meter in Länge/Breite (lineare Näherung, genügt für einen Landkreis). */
export function toLonLat(world: World, x: number, y: number): [number, number] {
  const g = world.region.geo;
  return [round6(g.originLon + x / g.metersPerDegLon), round6(g.originLat + y / g.metersPerDegLat)];
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

const CLASS_NAMES: Record<number, string> = {
  [RoadClass.Motorway]: 'motorway',
  [RoadClass.Primary]: 'primary',
  [RoadClass.Secondary]: 'secondary',
  [RoadClass.Tertiary]: 'tertiary',
  [RoadClass.UrbanMain]: 'urban_main',
  [RoadClass.Residential]: 'residential',
  [RoadClass.Link]: 'link',
};

/** Statische Kartendaten der Welt (einmal je Fenster übertragen). */
export function worldToMap(world: World): WorldMap {
  const ll = (p: Vec) => toLonLat(world, p[0], p[1]);
  const node = (i: number): Vec => [world.graph.x[i] ?? 0, world.graph.y[i] ?? 0];

  const roads: GeoFeature[] = world.segments.map((s) => ({
    type: 'Feature',
    properties: {
      cls: CLASS_NAMES[s.roadClass] ?? 'residential',
      name: world.streets[s.streetId]?.name ?? '',
    },
    geometry: { type: 'LineString', coordinates: [ll(node(s.from)), ll(node(s.to))] },
  }));

  const circle = (cx: number, cy: number, r: number): [number, number][] => {
    const ring: [number, number][] = [];
    for (let k = 0; k <= 32; k++) {
      const a = degToRad((k % 32) * 11.25);
      ring.push(ll([cx + detCos(a) * r, cy + detSin(a) * r]));
    }
    return ring;
  };

  const areas: GeoFeature[] = [
    ...world.region.forests.map((f): GeoFeature => ({
      type: 'Feature',
      properties: { kind: 'forest', name: f.name ?? '' },
      geometry: {
        type: 'Polygon',
        coordinates: [[...f.points, f.points[0] ?? [0, 0]].map((p) => ll([p[0], p[1]]))],
      },
    })),
    ...world.towns.map((t): GeoFeature => ({
      type: 'Feature',
      properties: { kind: 'town', name: t.name },
      geometry: { type: 'Polygon', coordinates: [circle(t.x, t.y, t.radius * 1.02)] },
    })),
  ];

  const water: GeoFeature[] = world.region.river
    ? [
        {
          type: 'Feature',
          properties: {
            kind: 'river',
            name: world.region.river.name,
            width: world.region.river.width,
          },
          geometry: {
            type: 'LineString',
            coordinates: world.region.river.points.map((p) => ll([p[0], p[1]])),
          },
        },
      ]
    : [];

  const labels: GeoFeature[] = world.towns.map((t) => ({
    type: 'Feature',
    properties: { kind: t.kind, name: t.name, population: t.population },
    geometry: { type: 'Point', coordinates: ll([t.x, t.y]) },
  }));

  const { width, height } = world.region.size;
  return {
    bounds: [ll([0, 0]), ll([width, height])],
    roads: { type: 'FeatureCollection', features: roads },
    areas: { type: 'FeatureCollection', features: areas },
    water: { type: 'FeatureCollection', features: water },
    labels: { type: 'FeatureCollection', features: labels },
    attribution: world.region.attribution ?? null,
  };
}
