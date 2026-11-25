/**
 * Welt aus einem Regionspaket (ADR-0020): Straßennetz, Straßen und Adressen kommen fertig aus dem
 * Region-Builder (z. B. aus OpenStreetMap). Hier wird nur zusammengesetzt und geprüft – ohne
 * Zufall, damit die Welt auf jedem Rechner gleich ist.
 */
import type { RegionConfig } from '@ls112/content';
import { buildGraph, type RoadClass } from '@ls112/routing';
import type { World, WorldAddress, WorldSegment, WorldStreet, WorldTown } from './types';

type Prebuilt = NonNullable<RegionConfig['prebuilt']>;

/** Bewohner je Adresse: Einwohner des Ortes gleichmäßig auf seine Adressen verteilt. */
function houseWeights(addresses: readonly WorldAddress[], towns: readonly WorldTown[]) {
  const population = new Map(towns.map((t) => [t.id, t.population]));
  const perTown = new Map<string, number>();
  for (const a of addresses)
    if (a.kind === 'house') perTown.set(a.townId, (perTown.get(a.townId) ?? 0) + 1);
  const ids: number[] = [];
  const weights: number[] = [];
  let cumulative = 0;
  for (const a of addresses) {
    if (a.kind !== 'house') continue;
    cumulative += (population.get(a.townId) ?? 0) / Math.max(1, perTown.get(a.townId) ?? 1);
    ids.push(a.id);
    weights.push(cumulative);
  }
  return { houseIds: Uint32Array.from(ids), houseWeights: Float64Array.from(weights) };
}

export function buildPrebuiltWorld(region: RegionConfig, data: Prebuilt): World {
  const n = data.nodes.length;
  for (const [from, to, , street] of data.segments) {
    if (from >= n || to >= n)
      throw new RangeError('Regionspaket: Segment verweist auf unbekannten Knoten');
    if (street >= data.streets.length)
      throw new RangeError('Regionspaket: Segment verweist auf unbekannte Straße');
  }
  const graph = buildGraph(
    data.nodes.map(([x, y]) => ({ x, y })),
    data.segments.map(([from, to, roadClass, , oneway]) => ({
      from,
      to,
      roadClass: roadClass as RoadClass,
      oneway: oneway === 1,
    })),
  );
  const segments: WorldSegment[] = data.segments.map(([from, to, roadClass, streetId]) => ({
    from,
    to,
    roadClass: roadClass as RoadClass,
    streetId,
  }));
  const streets: WorldStreet[] = data.streets.map((s, id) => ({
    id,
    name: s.name,
    townId: s.town,
    roadClass: s.roadClass as RoadClass,
  }));
  const addresses: WorldAddress[] = [];
  for (const [streetId, number, townId, x, y, node] of data.addresses) {
    if (node >= n) throw new RangeError('Regionspaket: Adresse verweist auf unbekannten Knoten');
    addresses.push({ id: addresses.length, kind: 'house', streetId, number, townId, x, y, node });
  }
  const roadAddressIds: number[] = [];
  for (const [streetId, townId, toTownId, node] of data.roadSections) {
    if (node >= n) continue;
    roadAddressIds.push(addresses.length);
    addresses.push({
      id: addresses.length,
      kind: 'road',
      streetId,
      number: '',
      townId,
      toTownId,
      x: data.nodes[node]?.[0] ?? 0,
      y: data.nodes[node]?.[1] ?? 0,
      node,
    });
  }
  const towns: WorldTown[] = region.towns.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    x: t.x,
    y: t.y,
    radius: t.radius,
    population: t.population,
  }));
  return {
    region,
    graph,
    segments,
    streets,
    addresses,
    towns,
    ...houseWeights(addresses, towns),
    roadAddressIds: Uint32Array.from(roadAddressIds),
  };
}
