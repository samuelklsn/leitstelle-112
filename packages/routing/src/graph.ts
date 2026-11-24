/**
 * Gerichteter Straßengraph im CSR-Format (Compressed Sparse Row) auf Typed Arrays (ADR-0007).
 * Koordinaten sind ebene Meter im lokalen System der Region.
 */

/** Straßenklassen, angelehnt an die deutsche Straßensystematik. */
export const RoadClass = {
  /** Bundesautobahn */
  Motorway: 0,
  /** Bundesstraße */
  Primary: 1,
  /** Landesstraße */
  Secondary: 2,
  /** Kreisstraße */
  Tertiary: 3,
  /** Innerörtliche Hauptstraße */
  UrbanMain: 4,
  /** Wohn- und Nebenstraße */
  Residential: 5,
  /** Anschlussstelle, Zufahrt */
  Link: 6,
} as const;
export type RoadClass = (typeof RoadClass)[keyof typeof RoadClass];
export const ROAD_CLASS_COUNT = 7;

export interface GraphNodeInput {
  readonly x: number;
  readonly y: number;
}

export interface GraphEdgeInput {
  readonly from: number;
  readonly to: number;
  readonly roadClass: RoadClass;
  /** Nur in Richtung from → to befahrbar. */
  readonly oneway?: boolean;
  /** Optionale Länge in Metern; sonst euklidisch aus den Koordinaten. */
  readonly length?: number;
}

export interface RoadGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly edgeFrom: Uint32Array;
  readonly edgeTo: Uint32Array;
  /** Länge in ganzen Metern (mindestens 1). */
  readonly edgeLength: Uint32Array;
  readonly edgeClass: Uint8Array;
  /** Vorwärts-CSR: ausgehende Kanten je Knoten. */
  readonly outOffsets: Uint32Array;
  readonly outEdges: Uint32Array;
  /** Rückwärts-CSR: eingehende Kanten je Knoten (für One-to-Many zum Ziel). */
  readonly inOffsets: Uint32Array;
  readonly inEdges: Uint32Array;
}

/**
 * Baut den Graphen. Ungerichtete Eingabekanten werden zu zwei gerichteten Kanten.
 * Die Reihenfolge der Kanten ist stabil (Eingabereihenfolge), das Ergebnis also deterministisch.
 */
export function buildGraph(
  nodes: readonly GraphNodeInput[],
  edges: readonly GraphEdgeInput[],
): RoadGraph {
  const n = nodes.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  nodes.forEach((node, i) => {
    x[i] = node.x;
    y[i] = node.y;
  });

  const directed: { from: number; to: number; cls: number; len: number }[] = [];
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (e.from < 0 || e.to < 0 || e.from >= n || e.to >= n) {
      throw new RangeError(`Kante verweist auf unbekannten Knoten (${e.from} → ${e.to})`);
    }
    const len = Math.max(1, Math.round(e.length ?? distance(x, y, e.from, e.to)));
    directed.push({ from: e.from, to: e.to, cls: e.roadClass, len });
    if (!e.oneway) directed.push({ from: e.to, to: e.from, cls: e.roadClass, len });
  }

  const m = directed.length;
  const edgeFrom = new Uint32Array(m);
  const edgeTo = new Uint32Array(m);
  const edgeLength = new Uint32Array(m);
  const edgeClass = new Uint8Array(m);
  directed.forEach((d, i) => {
    edgeFrom[i] = d.from;
    edgeTo[i] = d.to;
    edgeLength[i] = d.len;
    edgeClass[i] = d.cls;
  });

  const [outOffsets, outEdges] = csr(n, edgeFrom);
  const [inOffsets, inEdges] = csr(n, edgeTo);
  return {
    nodeCount: n,
    edgeCount: m,
    x,
    y,
    edgeFrom,
    edgeTo,
    edgeLength,
    edgeClass,
    outOffsets,
    outEdges,
    inOffsets,
    inEdges,
  };
}

function csr(n: number, key: Uint32Array): [Uint32Array, Uint32Array] {
  const offsets = new Uint32Array(n + 1);
  for (const k of key) offsets[k + 1] = (offsets[k + 1] ?? 0) + 1;
  for (let i = 0; i < n; i++) offsets[i + 1] = (offsets[i + 1] ?? 0) + (offsets[i] ?? 0);
  const cursor = offsets.slice(0, n);
  const list = new Uint32Array(key.length);
  for (let e = 0; e < key.length; e++) {
    const k = key[e] ?? 0;
    const pos = cursor[k] ?? 0;
    list[pos] = e;
    cursor[k] = pos + 1;
  }
  return [offsets, list];
}

/**
 * Euklidischer Abstand. `Math.sqrt` ist nach IEEE 754 exakt gerundet und damit auf allen
 * Engines bitgleich – im Gegensatz zu sin/cos/log (ADR-0004).
 */
export function distance(x: Float64Array, y: Float64Array, a: number, b: number): number {
  const dx = (x[a] ?? 0) - (x[b] ?? 0);
  const dy = (y[a] ?? 0) - (y[b] ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Nächster Knoten zu einem Punkt (lineare Suche; Regionen im Slice haben wenige Tausend Knoten). */
export function nearestNode(
  graph: RoadGraph,
  px: number,
  py: number,
  filter?: (node: number) => boolean,
): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < graph.nodeCount; i++) {
    if (filter && !filter(i)) continue;
    const dx = (graph.x[i] ?? 0) - px;
    const dy = (graph.y[i] ?? 0) - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) throw new RangeError('Graph ohne passende Knoten');
  return best;
}
