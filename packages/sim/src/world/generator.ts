import type { RegionConfig, Town } from '@ls112/content';
import { RoadClass, buildGraph } from '@ls112/routing';
import { Rng } from '../rng';
import { crossesPolyline, degToRad, detCos, detSin, dist, normalize, type Vec } from './geometry';
import { STREET_NAMES } from './street-names';
import type { World, WorldAddress, WorldSegment, WorldStreet, WorldTown } from './types';

const ROAD_CLASS_BY_NAME = {
  bundesstrasse: RoadClass.Primary,
  landesstrasse: RoadClass.Secondary,
  kreisstrasse: RoadClass.Tertiary,
} as const;

/** Abstand zwischen Hausnummern entlang einer Straße (m) und Versatz zur Straßenmitte. */
const HOUSE_SPACING_M = 28;
const HOUSE_OFFSET_M = 14;
/** Maximale Segmentlänge überörtlicher Straßen bzw. der Autobahn (m). */
const ROAD_SEGMENT_M = 300;
const MOTORWAY_SEGMENT_M = 500;
/** Anteil wegfallender Nebenstraßen-Segmente, damit Orte nicht wie Schachbretter wirken. */
const DROP_RESIDENTIAL = 0.07;

interface Builder {
  nodes: Vec[];
  nodeTown: (string | null)[];
  segments: WorldSegment[];
  streets: WorldStreet[];
}

interface TownGrid {
  town: Town;
  nodeIds: number[];
  /** Straßensegmente je Straße in Rasterreihenfolge (für die Hausnummern). */
  streetSegments: Map<number, number[]>;
}

/**
 * Erzeugt die Welt deterministisch aus der Regionskonfiguration: gleicher Seed, gleiche Welt –
 * auf jedem Rechner. Das Ergebnis enthält den Routinggraphen, Straßen und Adressen.
 */
export function generateWorld(region: RegionConfig): World {
  const b: Builder = { nodes: [], nodeTown: [], segments: [], streets: [] };
  const river: Vec[] = region.river?.points.map((p) => [p[0], p[1]] as Vec) ?? [];

  const grids = region.towns.map((town) => buildTown(b, town, region.seed, river));
  const gridById = new Map(grids.map((g) => [g.town.id, g]));
  const roadChunks: { streetId: number; nodes: number[]; fromTown: string; toTown: string }[] = [];

  for (const road of region.roads) {
    const streetId = addStreet(b, road.name, null, ROAD_CLASS_BY_NAME[road.roadClass]);
    const rng = Rng.stream(region.seed, `road:${road.name}`);
    // Pfad an Orten aufteilen: jeder Abschnitt verbindet zwei Ortsränder.
    let chunk: (string | Vec)[] = [];
    for (const p of road.path) {
      const point = typeof p === 'string' ? p : ([p[0], p[1]] as Vec);
      chunk.push(point);
      if (typeof point === 'string' && chunk.length > 1) {
        const nodes = layRoad(
          b,
          chunk,
          gridById,
          streetId,
          ROAD_CLASS_BY_NAME[road.roadClass],
          rng,
          ROAD_SEGMENT_M,
        );
        const first = chunk[0];
        roadChunks.push({
          streetId,
          nodes,
          fromTown: typeof first === 'string' ? first : point,
          toTown: point,
        });
        chunk = [point];
      }
    }
  }

  if (region.motorway) {
    const mw = region.motorway;
    const streetId = addStreet(b, mw.name, null, RoadClass.Motorway);
    const rng = Rng.stream(region.seed, `motorway:${mw.name}`);
    const nodes = layRoad(
      b,
      mw.points.map((p) => [p[0], p[1]] as Vec),
      gridById,
      streetId,
      RoadClass.Motorway,
      rng,
      MOTORWAY_SEGMENT_M,
      0,
    );
    for (const exit of mw.exits) {
      const at: Vec = [exit.at[0], exit.at[1]];
      let best = nodes[0] ?? 0;
      for (const n of nodes)
        if (dist(b.nodes[n] as Vec, at) < dist(b.nodes[best] as Vec, at)) best = n;
      const exitStreet = addStreet(b, exit.roadName, null, ROAD_CLASS_BY_NAME[exit.roadClass]);
      const exitRng = Rng.stream(region.seed, `exit:${exit.name}`);
      const chunkNodes = layRoad(
        b,
        [best, exit.to],
        gridById,
        exitStreet,
        ROAD_CLASS_BY_NAME[exit.roadClass],
        exitRng,
        ROAD_SEGMENT_M,
      );
      roadChunks.push({
        streetId: exitStreet,
        nodes: chunkNodes,
        fromTown: exit.to,
        toTown: exit.to,
      });
    }
  }

  // Nur die größte zusammenhängende Komponente behalten – abgehängte Reststücke (z. B. durch den
  // Fluss abgeschnittene Rasterteile ohne Brücke) wären für Fahrzeuge unerreichbar.
  const keep = largestComponent(b.nodes.length, b.segments);
  const remap = new Int32Array(b.nodes.length).fill(-1);
  const nodes: Vec[] = [];
  const nodeTown: (string | null)[] = [];
  for (let i = 0; i < b.nodes.length; i++) {
    if (keep[i]) {
      remap[i] = nodes.length;
      nodes.push(b.nodes[i] as Vec);
      nodeTown.push(b.nodeTown[i] ?? null);
    }
  }
  const segments: WorldSegment[] = [];
  const segmentRemap = new Int32Array(b.segments.length).fill(-1);
  b.segments.forEach((s, i) => {
    const from = remap[s.from] ?? -1;
    const to = remap[s.to] ?? -1;
    if (from >= 0 && to >= 0) {
      segmentRemap[i] = segments.length;
      segments.push({ ...s, from, to });
    }
  });

  const graph = buildGraph(
    nodes.map(([x, y]) => ({ x, y })),
    segments.map((s) => ({ from: s.from, to: s.to, roadClass: s.roadClass })),
  );

  const addresses: WorldAddress[] = [];
  const houseIds: number[] = [];
  const houseWeights: number[] = [];
  let cumulative = 0;
  for (const grid of grids) {
    const first = addresses.length;
    for (const [streetId, segIds] of grid.streetSegments) {
      let odd = 1;
      let even = 2;
      for (const original of segIds) {
        const si = segmentRemap[original] ?? -1;
        const seg = si >= 0 ? segments[si] : undefined;
        if (!seg) continue;
        const a = nodes[seg.from] as Vec;
        const c = nodes[seg.to] as Vec;
        const len = dist(a, c);
        const count = Math.max(1, Math.floor(len / HOUSE_SPACING_M));
        const [dx, dy] = normalize([c[0] - a[0], c[1] - a[1]]);
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          const px = a[0] + (c[0] - a[0]) * t;
          const py = a[1] + (c[1] - a[1]) * t;
          const node = t < 0.5 ? seg.from : seg.to;
          for (const side of [1, -1] as const) {
            const num = side === 1 ? odd : even;
            addresses.push({
              id: addresses.length,
              kind: 'house',
              streetId,
              number: num.toString(),
              townId: grid.town.id,
              x: px - dy * HOUSE_OFFSET_M * side,
              y: py + dx * HOUSE_OFFSET_M * side,
              node,
            });
            if (side === 1) odd += 2;
            else even += 2;
          }
        }
      }
    }
    const houses = addresses.length - first;
    const perHouse = houses > 0 ? grid.town.population / houses : 0;
    for (let id = first; id < addresses.length; id++) {
      cumulative += perHouse;
      houseIds.push(id);
      houseWeights.push(cumulative);
    }
  }

  const roadAddressIds: number[] = [];
  for (const chunk of roadChunks) {
    const mapped = chunk.nodes.map((n) => remap[n] ?? -1).filter((n) => n >= 0);
    const mid = mapped[Math.floor(mapped.length / 2)];
    if (mid === undefined || chunk.fromTown === chunk.toTown) continue;
    const [x, y] = nodes[mid] as Vec;
    roadAddressIds.push(addresses.length);
    addresses.push({
      id: addresses.length,
      kind: 'road',
      streetId: chunk.streetId,
      number: '',
      townId: chunk.fromTown,
      toTownId: chunk.toTown,
      x,
      y,
      node: mid,
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
    streets: b.streets,
    addresses,
    towns,
    houseWeights: Float64Array.from(houseWeights),
    houseIds: Uint32Array.from(houseIds),
    roadAddressIds: Uint32Array.from(roadAddressIds),
  };
}

function addStreet(b: Builder, name: string, townId: string | null, roadClass: RoadClass): number {
  const id = b.streets.length;
  b.streets.push({ id, name, townId, roadClass });
  return id;
}

function addNode(b: Builder, p: Vec, townId: string | null): number {
  b.nodes.push(p);
  b.nodeTown.push(townId);
  return b.nodes.length - 1;
}

/**
 * Ortsnetz als gedrehtes, leicht verrauschtes Raster mit unregelmäßigem Rand. Die beiden
 * Mittelachsen sind innerörtliche Hauptstraßen; den Fluss queren nur Hauptachsen und jede
 * n-te Querstraße (Brücken).
 */
function buildTown(b: Builder, town: Town, seed: number, river: readonly Vec[]): TownGrid {
  const rng = Rng.stream(seed, `town:${town.id}`);
  const angle = degToRad(town.rotationDeg);
  const cos = detCos(angle);
  const sin = detSin(angle);
  const bs = town.blockSize;
  const n = Math.ceil(town.radius / bs) + 1;
  const index = new Map<string, number>();
  const nodeIds: number[] = [];

  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      // Unregelmäßiger Ortsrand: Grenzradius je Rasterpunkt zwischen 80 % und 115 %.
      const limit = town.radius * (0.8 + 0.35 * rng.nextFloat());
      const axis = i === 0 || j === 0;
      const jitter = bs * (axis ? 0.04 : 0.13);
      const u = i * bs + (rng.nextFloat() * 2 - 1) * jitter;
      const v = j * bs + (rng.nextFloat() * 2 - 1) * jitter;
      if (u * u + v * v > limit * limit && !(axis && u * u + v * v <= town.radius * town.radius))
        continue;
      const p: Vec = [town.x + u * cos - v * sin, town.y + u * sin + v * cos];
      const id = addNode(b, p, town.id);
      index.set(`${i.toString()},${j.toString()}`, id);
      nodeIds.push(id);
    }
  }

  const names = shuffledNames(rng);
  const streetIds = new Map<string, number>();
  const streetFor = (key: string, isRow: boolean, line: number): number => {
    let id = streetIds.get(key);
    if (id === undefined) {
      const main = line === 0;
      const name = main ? town.mainStreets[isRow ? 0 : 1] : (names.pop() ?? `Weg ${key}`);
      id = addStreet(b, name, town.id, main ? RoadClass.UrbanMain : RoadClass.Residential);
      streetIds.set(key, id);
    }
    return id;
  };

  const streetSegments = new Map<number, number[]>();
  const link = (a: number | undefined, c: number | undefined, isRow: boolean, line: number) => {
    if (a === undefined || c === undefined) return;
    const main = line === 0;
    const drop = rng.chance(DROP_RESIDENTIAL);
    if (!main && drop) return;
    const pa = b.nodes[a] as Vec;
    const pc = b.nodes[c] as Vec;
    if (
      river.length > 1 &&
      crossesPolyline(pa, pc, river) &&
      !main &&
      line % town.bridgeEvery !== 0
    ) {
      return;
    }
    const streetId = streetFor(`${isRow ? 'r' : 'c'}${line.toString()}`, isRow, line);
    const segId = b.segments.length;
    b.segments.push({
      from: a,
      to: c,
      roadClass: main ? RoadClass.UrbanMain : RoadClass.Residential,
      streetId,
    });
    const list = streetSegments.get(streetId) ?? [];
    list.push(segId);
    streetSegments.set(streetId, list);
  };

  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const here = index.get(`${i.toString()},${j.toString()}`);
      link(here, index.get(`${(i + 1).toString()},${j.toString()}`), true, j);
      link(here, index.get(`${i.toString()},${(j + 1).toString()}`), false, i);
    }
  }
  // Überörtliche Straßen nur an das zusammenhängende Kernnetz des Orts anschließen – ein durch
  // weggefallene Segmente isolierter Randknoten würde sonst die ganze Landstraße abhängen.
  const townSegments = [...streetSegments.values()]
    .flat()
    .map((s) => b.segments[s] as WorldSegment);
  const core = largestComponentOf(nodeIds, townSegments);
  return { town, nodeIds: nodeIds.filter((id) => core.has(id)), streetSegments };
}

function largestComponentOf(
  nodeIds: readonly number[],
  segments: readonly WorldSegment[],
): Set<number> {
  const adj = new Map<number, number[]>(nodeIds.map((id) => [id, []]));
  for (const s of segments) {
    adj.get(s.from)?.push(s.to);
    adj.get(s.to)?.push(s.from);
  }
  let best = new Set<number>();
  const seen = new Set<number>();
  for (const start of nodeIds) {
    if (seen.has(start)) continue;
    const comp = new Set<number>([start]);
    seen.add(start);
    const stack = [start];
    while (stack.length > 0) {
      const u = stack.pop() as number;
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          comp.add(v);
          stack.push(v);
        }
      }
    }
    if (comp.size > best.size) best = comp;
  }
  return best;
}

function shuffledNames(rng: Rng): string[] {
  const names = [...STREET_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const k = rng.nextInt(0, i);
    const tmp = names[i] as string;
    names[i] = names[k] as string;
    names[k] = tmp;
  }
  return names;
}

/**
 * Legt eine Straße entlang von Stützpunkten an. Orts-IDs werden zum Ortsrandknoten in Richtung
 * des Nachbarpunkts aufgelöst, Knotennummern direkt verwendet. Liefert alle Knoten der Straße.
 */
function layRoad(
  b: Builder,
  path: readonly (string | Vec | number)[],
  grids: ReadonlyMap<string, TownGrid>,
  streetId: number,
  roadClass: RoadClass,
  rng: Rng,
  maxSegment: number,
  wobble = 35,
): number[] {
  const position = (k: number): Vec => {
    const p = path[k];
    if (typeof p === 'number') return b.nodes[p] as Vec;
    if (typeof p === 'string') {
      const t = grids.get(p)?.town;
      return t ? [t.x, t.y] : [0, 0];
    }
    return p as Vec;
  };
  const resolve = (k: number): number | Vec => {
    const p = path[k];
    if (typeof p === 'number') return p;
    if (typeof p !== 'string') return p as Vec;
    const grid = grids.get(p);
    if (!grid) throw new RangeError(`Unbekannter Ort ${p}`);
    const neighbour = position(k === 0 ? 1 : k - 1);
    const [dx, dy] = normalize([neighbour[0] - grid.town.x, neighbour[1] - grid.town.y]);
    const target: Vec = [
      grid.town.x + dx * grid.town.radius * 1.3,
      grid.town.y + dy * grid.town.radius * 1.3,
    ];
    let best = grid.nodeIds[0] ?? 0;
    for (const id of grid.nodeIds)
      if (dist(b.nodes[id] as Vec, target) < dist(b.nodes[best] as Vec, target)) best = id;
    return best;
  };

  const anchors = path.map((_, k) => resolve(k));
  const result: number[] = [];
  let prev: number | undefined;
  anchors.forEach((anchor) => {
    const p = typeof anchor === 'number' ? (b.nodes[anchor] as Vec) : anchor;
    if (prev === undefined) {
      prev = typeof anchor === 'number' ? anchor : addNode(b, p, null);
      result.push(prev);
      return;
    }
    const from = b.nodes[prev] as Vec;
    const pieces = Math.max(1, Math.ceil(dist(from, p) / maxSegment));
    const [dx, dy] = normalize([p[0] - from[0], p[1] - from[1]]);
    for (let s = 1; s <= pieces; s++) {
      let id: number;
      if (s === pieces) {
        id = typeof anchor === 'number' ? anchor : addNode(b, p, null);
      } else {
        const t = s / pieces;
        // Leichter Querversatz, damit Landstraßen nicht wie mit dem Lineal gezogen wirken.
        const off = (rng.nextFloat() * 2 - 1) * wobble;
        id = addNode(
          b,
          [from[0] + (p[0] - from[0]) * t - dy * off, from[1] + (p[1] - from[1]) * t + dx * off],
          null,
        );
      }
      b.segments.push({ from: prev, to: id, roadClass, streetId });
      result.push(id);
      prev = id;
    }
  });
  return result;
}

function largestComponent(n: number, segments: readonly WorldSegment[]): Uint8Array {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const s of segments) {
    adj[s.from]?.push(s.to);
    adj[s.to]?.push(s.from);
  }
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < n; start++) {
    if ((comp[start] ?? -1) >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [start];
    comp[start] = id;
    while (stack.length > 0) {
      const u = stack.pop() as number;
      size++;
      for (const v of adj[u] ?? []) {
        if ((comp[v] ?? -1) < 0) {
          comp[v] = id;
          stack.push(v);
        }
      }
    }
    sizes.push(size);
  }
  let best = 0;
  sizes.forEach((s, i) => {
    if (s > (sizes[best] ?? 0)) best = i;
  });
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = comp[i] === best ? 1 : 0;
  return keep;
}
