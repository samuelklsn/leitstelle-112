import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RoadClass, buildGraph, type GraphEdgeInput, type RoadGraph } from './graph';
import { UNREACHABLE, dijkstra, route } from './dijkstra';
import { DEFAULT_TRAVEL_MODEL, computeEdgeTimes, speedMps } from './travel-model';
import { Router } from './router';

const ctx = { hour: 12, weekend: false, emergency: false };

/** Gitter w × h mit 100 m Kantenlänge, optional mit zufälligen Einbahnstraßen/Klassen. */
function grid(w: number, h: number, edgeMods: readonly number[] = []): RoadGraph {
  const nodes = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) nodes.push({ x: i * 100, y: j * 100 });
  const edges: GraphEdgeInput[] = [];
  let k = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const id = j * w + i;
      const mod = edgeMods[k++ % Math.max(1, edgeMods.length)] ?? 0;
      const roadClass = (mod % 7) as RoadClass;
      if (i + 1 < w) edges.push({ from: id, to: id + 1, roadClass, oneway: mod % 5 === 4 });
      if (j + 1 < h) edges.push({ from: id, to: id + w, roadClass: RoadClass.Residential });
    }
  }
  return buildGraph(nodes, edges);
}

const gridArb = fc
  .record({
    w: fc.integer({ min: 2, max: 9 }),
    h: fc.integer({ min: 2, max: 9 }),
    mods: fc.array(fc.integer({ min: 0, max: 34 }), { minLength: 1, maxLength: 30 }),
  })
  .map(({ w, h, mods }) => grid(w, h, mods));

describe('buildGraph', () => {
  it('legt für ungerichtete Kanten zwei Richtungen an, für Einbahnstraßen eine', () => {
    const g = buildGraph(
      [
        { x: 0, y: 0 },
        { x: 300, y: 400 },
        { x: 0, y: 100 },
      ],
      [
        { from: 0, to: 1, roadClass: RoadClass.Primary },
        { from: 1, to: 2, roadClass: RoadClass.Residential, oneway: true },
      ],
    );
    expect(g.edgeCount).toBe(3);
    expect(g.edgeLength[0]).toBe(500);
    expect(Array.from(g.outEdges.slice(g.outOffsets[2], g.outOffsets[3]))).toEqual([]);
    expect(Array.from(g.inEdges.slice(g.inOffsets[2], g.inOffsets[3]))).toEqual([2]);
  });

  it('lehnt Kanten zu unbekannten Knoten ab', () => {
    expect(() => buildGraph([{ x: 0, y: 0 }], [{ from: 0, to: 5, roadClass: 0 }])).toThrow(
      RangeError,
    );
  });
});

describe('Fahrzeitmodell', () => {
  it('Sonderrechte machen jede Klasse schneller, innerorts am stärksten', () => {
    for (let c = 0; c < 7; c++) {
      expect(speedMps(DEFAULT_TRAVEL_MODEL, c, { ...ctx, emergency: true })).toBeGreaterThan(
        speedMps(DEFAULT_TRAVEL_MODEL, c, ctx),
      );
    }
    const gain = (c: number) =>
      speedMps(DEFAULT_TRAVEL_MODEL, c, { ...ctx, emergency: true }) /
      speedMps(DEFAULT_TRAVEL_MODEL, c, ctx);
    expect(gain(RoadClass.UrbanMain)).toBeGreaterThan(gain(RoadClass.Motorway));
  });

  it('Berufsverkehr bremst innerorts stärker als nachts', () => {
    const rush = speedMps(DEFAULT_TRAVEL_MODEL, RoadClass.UrbanMain, { ...ctx, hour: 8 });
    const night = speedMps(DEFAULT_TRAVEL_MODEL, RoadClass.UrbanMain, { ...ctx, hour: 3 });
    expect(night).toBeGreaterThan(rush * 1.2);
  });

  it('Kantenzeiten sind positive ganze Millisekunden', () => {
    const g = grid(4, 4, [0, 1, 2, 3, 4, 5, 6]);
    const t = computeEdgeTimes(g, DEFAULT_TRAVEL_MODEL, ctx);
    for (const v of t) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe('Dijkstra und Routen', () => {
  it('Dreiecksungleichung: d(a,c) ≤ d(a,b) + d(b,c)', () => {
    fc.assert(
      fc.property(gridArb, fc.nat(), fc.nat(), fc.nat(), (g, a0, b0, c0) => {
        const times = computeEdgeTimes(g, DEFAULT_TRAVEL_MODEL, ctx);
        const [a, b, c] = [a0 % g.nodeCount, b0 % g.nodeCount, c0 % g.nodeCount];
        const da = dijkstra(g, times, a).dist;
        const db = dijkstra(g, times, b).dist;
        const ab = da[b] ?? UNREACHABLE;
        const bc = db[c] ?? UNREACHABLE;
        if (ab !== UNREACHABLE && bc !== UNREACHABLE) {
          expect(da[c] ?? UNREACHABLE).toBeLessThanOrEqual(ab + bc);
        }
      }),
    );
  });

  it('Rückwärtssuche liefert dieselben Zeiten wie Einzelsuchen (One-to-Many)', () => {
    fc.assert(
      fc.property(gridArb, fc.nat(), (g, t0) => {
        const times = computeEdgeTimes(g, DEFAULT_TRAVEL_MODEL, ctx);
        const target = t0 % g.nodeCount;
        const back = dijkstra(g, times, target, { reverse: true }).dist;
        for (let s = 0; s < g.nodeCount; s++) {
          expect(back[s]).toBe(dijkstra(g, times, s).dist[target]);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('Route ist zusammenhängend und ihre Zeit entspricht der kürzesten Distanz', () => {
    fc.assert(
      fc.property(gridArb, fc.nat(), fc.nat(), (g, a0, b0) => {
        const times = computeEdgeTimes(g, DEFAULT_TRAVEL_MODEL, ctx);
        const [a, b] = [a0 % g.nodeCount, b0 % g.nodeCount];
        const r = route(g, times, a, b);
        const d = dijkstra(g, times, a).dist[b] ?? UNREACHABLE;
        if (d === UNREACHABLE) {
          expect(r).toBeUndefined();
          return;
        }
        expect(r).toBeDefined();
        if (!r) return;
        expect(r.totalMs).toBe(d);
        expect(r.nodes[0]).toBe(a);
        expect(r.nodes.at(-1)).toBe(b);
        r.edges.forEach((e, i) => {
          expect(g.edgeFrom[e]).toBe(r.nodes[i]);
          expect(g.edgeTo[e]).toBe(r.nodes[i + 1]);
        });
        expect(r.cumulativeMs.at(-1)).toBe(r.totalMs);
      }),
    );
  });

  it('Einbahnstraßen werden nur in Fahrtrichtung befahren', () => {
    const g = buildGraph(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [{ from: 0, to: 1, roadClass: RoadClass.Residential, oneway: true }],
    );
    const times = computeEdgeTimes(g, DEFAULT_TRAVEL_MODEL, ctx);
    expect(route(g, times, 0, 1)).toBeDefined();
    expect(route(g, times, 1, 0)).toBeUndefined();
  });

  it('Router cached Kantenzeiten je Kontext', () => {
    const router = new Router(grid(3, 3), DEFAULT_TRAVEL_MODEL);
    expect(router.edgeTimes(ctx)).toBe(router.edgeTimes({ ...ctx }));
    expect(router.edgeTimes(ctx)).not.toBe(router.edgeTimes({ ...ctx, emergency: true }));
    expect(router.route(0, 8, ctx)?.nodes.length).toBe(5);
  });
});
