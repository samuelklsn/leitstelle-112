import type { RoadGraph } from './graph';

export const UNREACHABLE = Number.POSITIVE_INFINITY;

/**
 * Binärer Min-Heap für (Distanz, Knoten). Gleichstände entscheidet die Knotennummer –
 * so ist auch die Wahl zwischen gleich schnellen Routen deterministisch.
 */
class NodeHeap {
  private dist: number[] = [];
  private node: number[] = [];

  get size(): number {
    return this.node.length;
  }

  push(d: number, v: number): void {
    this.dist.push(d);
    this.node.push(v);
    let i = this.node.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.dist[0] ?? 0, this.node[0] ?? 0];
    const lastD = this.dist.pop() ?? 0;
    const lastN = this.node.pop() ?? 0;
    if (this.node.length > 0) {
      this.dist[0] = lastD;
      this.node[0] = lastN;
      let i = 0;
      const n = this.node.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.less(l, m)) m = l;
        if (r < n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const da = this.dist[a] ?? 0;
    const db = this.dist[b] ?? 0;
    return da < db || (da === db && (this.node[a] ?? 0) < (this.node[b] ?? 0));
  }

  private swap(a: number, b: number): void {
    const d = this.dist[a] ?? 0;
    this.dist[a] = this.dist[b] ?? 0;
    this.dist[b] = d;
    const v = this.node[a] ?? 0;
    this.node[a] = this.node[b] ?? 0;
    this.node[b] = v;
  }
}

export interface ShortestPathTree {
  /** Fahrzeit in ms je Knoten, {@link UNREACHABLE} wenn nicht erreichbar. */
  readonly dist: Float64Array;
  /** Kante, über die der Knoten erreicht wurde (-1 für Quelle/unerreichbar). */
  readonly via: Int32Array;
}

/**
 * Dijkstra von einer Quelle. Mit `reverse` wird auf eingehenden Kanten gesucht: `dist[v]` ist dann
 * die Fahrzeit *von v zur Quelle* – ein Durchlauf liefert so die Anfahrtszeiten aller Fahrzeuge zu
 * einem Einsatzort (One-to-Many, ADR-0007).
 */
export function dijkstra(
  graph: RoadGraph,
  edgeTimes: Uint32Array,
  source: number,
  options: { reverse?: boolean; target?: number; maxTimeMs?: number } = {},
): ShortestPathTree {
  const n = graph.nodeCount;
  const dist = new Float64Array(n).fill(UNREACHABLE);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const offsets = options.reverse ? graph.inOffsets : graph.outOffsets;
  const list = options.reverse ? graph.inEdges : graph.outEdges;
  const other = options.reverse ? graph.edgeFrom : graph.edgeTo;
  const limit = options.maxTimeMs ?? UNREACHABLE;

  dist[source] = 0;
  const heap = new NodeHeap();
  heap.push(0, source);
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === options.target || d > limit) break;
    const end = offsets[u + 1] ?? 0;
    for (let i = offsets[u] ?? 0; i < end; i++) {
      const e = list[i] ?? 0;
      const v = other[e] ?? 0;
      if (done[v]) continue;
      const nd = d + (edgeTimes[e] ?? 0);
      const cur = dist[v] ?? UNREACHABLE;
      if (nd < cur || (nd === cur && e < (via[v] ?? 0))) {
        dist[v] = nd;
        via[v] = e;
        heap.push(nd, v);
      }
    }
  }
  return { dist, via };
}

export interface Route {
  /** Knotenfolge vom Start zum Ziel. */
  readonly nodes: readonly number[];
  readonly edges: readonly number[];
  /** Kumulierte Fahrzeit in ms bis zu jedem Knoten (erstes Element 0). */
  readonly cumulativeMs: readonly number[];
  readonly totalMs: number;
  readonly lengthM: number;
}

/** Schnellste Route von `from` nach `to` oder `undefined`, wenn unerreichbar. */
export function route(
  graph: RoadGraph,
  edgeTimes: Uint32Array,
  from: number,
  to: number,
): Route | undefined {
  if (from === to) return { nodes: [from], edges: [], cumulativeMs: [0], totalMs: 0, lengthM: 0 };
  const tree = dijkstra(graph, edgeTimes, from, { target: to });
  if ((tree.dist[to] ?? UNREACHABLE) === UNREACHABLE) return undefined;
  const edges: number[] = [];
  for (let v = to; v !== from;) {
    const e = tree.via[v] ?? -1;
    if (e < 0) return undefined;
    edges.push(e);
    v = graph.edgeFrom[e] ?? 0;
  }
  edges.reverse();
  const nodes = [from];
  const cumulativeMs = [0];
  let t = 0;
  let len = 0;
  for (const e of edges) {
    t += edgeTimes[e] ?? 0;
    len += graph.edgeLength[e] ?? 0;
    nodes.push(graph.edgeTo[e] ?? 0);
    cumulativeMs.push(t);
  }
  return { nodes, edges, cumulativeMs, totalMs: t, lengthM: len };
}
