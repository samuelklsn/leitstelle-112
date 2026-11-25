import { describe, expect, it } from 'vitest';
import { MAX_SPAN_M, simplifyNetwork, type Seg, type Vec } from './simplify';

describe('Vereinfachung des Straßennetzes', () => {
  it('gerade Stützpunkte fallen weg, lange Strecken behalten Zwischenknoten', () => {
    // 1 km gerade Straße mit Stützpunkten alle 50 m.
    const nodes: Vec[] = Array.from({ length: 21 }, (_, i) => [i * 50, 0]);
    const segs: Seg[] = nodes.slice(1).map((_, i) => [i, i + 1, 5, 0, 0] as const);
    const r = simplifyNetwork(nodes, segs);
    expect(r.nodes.length).toBeLessThan(10);
    expect(r.nodes.length).toBeGreaterThanOrEqual(Math.ceil(1000 / MAX_SPAN_M) + 1);
    for (const [a, b] of r.segs) {
      const pa = r.nodes[a] ?? [0, 0];
      const pb = r.nodes[b] ?? [0, 0];
      expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1])).toBeLessThanOrEqual(MAX_SPAN_M + 50);
    }
  });

  it('Kurven, Kreuzungen, Straßenwechsel und Einbahnrichtung bleiben', () => {
    const nodes: Vec[] = [
      [0, 0],
      [100, 0],
      [200, 0],
      [200, 100], // 90°-Kurve bei Knoten 2
      [300, 0], // Abzweig an Knoten 2 → Kreuzung
      [400, 0],
    ];
    const segs: Seg[] = [
      [0, 1, 5, 0, 1],
      [1, 2, 5, 0, 1],
      [2, 3, 5, 0, 1],
      [2, 4, 5, 1, 0],
      [4, 5, 4, 1, 0], // anderer Straßentyp ab Knoten 4
    ];
    const r = simplifyNetwork(nodes, segs);
    // Knoten 1 (gerade, gleiche Straße) fällt weg, alle anderen bleiben.
    expect(r.nodes).toHaveLength(5);
    const oneway = r.segs.filter((s) => s[4] === 1);
    // Einbahnrichtung 0 → 2 bleibt erhalten.
    expect(oneway.some(([a, b]) => r.nodes[a]?.[0] === 0 && r.nodes[b]?.[0] === 200)).toBe(true);
  });

  it('ein Ring ohne Abzweig bleibt erhalten', () => {
    const nodes: Vec[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const segs: Seg[] = [
      [0, 1, 5, 0, 0],
      [1, 2, 5, 0, 0],
      [2, 3, 5, 0, 0],
      [3, 0, 5, 0, 0],
    ];
    const r = simplifyNetwork(nodes, segs);
    expect(r.segs.length).toBeGreaterThanOrEqual(3);
  });
});
