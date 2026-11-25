import { describe, expect, it } from 'vitest';
import { loadContentLayers } from '@ls112/content';
import { readContentFiles } from '@ls112/content/node';
import { Simulation, buildView, defaultConfig, simTimeFrom } from '@ls112/sim';
import { join } from 'node:path';
import { buildRegionMod, parseOsm } from './osm';

/**
 * Leistung einer landkreisgroßen echten Region (ADR-0020): 48 Orte mit Straßenraster und
 * Stützpunkten alle 30 m, verbunden durch Landstraßen – rund 30.000 OSM-Knoten.
 */
function largeOsm(): string {
  const out: string[] = ['<osm version="0.6">'];
  let id = 1;
  const node = (lat: number, lon: number, extra = '') => {
    const n = id++;
    out.push(
      extra
        ? `<node id="${n.toString()}" lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${extra}</node>`
        : `<node id="${n.toString()}" lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`,
    );
    return n;
  };
  const way = (refs: number[], tags: string) => {
    out.push(
      `<way id="${(id++).toString()}">${refs.map((r) => `<nd ref="${r.toString()}"/>`).join('')}${tags}</way>`,
    );
  };
  /** Linie mit Stützpunkten alle ~30 m zwischen zwei vorhandenen Knoten. */
  const line = (a: [number, number, number], b: [number, number, number], steps: number) => {
    const refs = [a[2]];
    for (let k = 1; k < steps; k++)
      refs.push(node(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps));
    refs.push(b[2]);
    return refs;
  };
  const centers: [number, number, number][] = [];
  for (let ti = 0; ti < 6; ti++)
    for (let tj = 0; tj < 8; tj++) {
      const lat = 50.6 + ti * 0.05;
      const lon = 9.0 + tj * 0.07;
      node(
        lat,
        lon,
        `<tag k="place" v="village"/><tag k="name" v="Ort ${ti.toString()}-${tj.toString()}"/>`,
      );
      const g: [number, number, number][][] = [];
      for (let i = 0; i < 8; i++) {
        const row: [number, number, number][] = [];
        for (let j = 0; j < 8; j++) {
          const la = lat + (i - 4) * 0.0018;
          const lo = lon + (j - 4) * 0.0028;
          row.push([la, lo, node(la, lo)]);
        }
        g.push(row);
      }
      for (let i = 0; i < 8; i++)
        for (let j = 0; j + 1 < 8; j++) {
          way(
            line(g[i]![j]!, g[i]![j + 1]!, 6),
            `<tag k="highway" v="residential"/><tag k="name" v="Weg ${i.toString()}"/>`,
          );
          way(
            line(g[j]![i]!, g[j + 1]![i]!, 6),
            `<tag k="highway" v="residential"/><tag k="name" v="Gasse ${i.toString()}"/>`,
          );
        }
      centers.push(g[4]![4]!);
    }
  for (let ti = 0; ti < 6; ti++)
    for (let tj = 0; tj < 8; tj++) {
      const c = centers[ti * 8 + tj]!;
      if (tj + 1 < 8)
        way(
          line(c, centers[ti * 8 + tj + 1]!, 160),
          '<tag k="highway" v="secondary"/><tag k="ref" v="L 1"/>',
        );
      if (ti + 1 < 6)
        way(
          line(c, centers[(ti + 1) * 8 + tj]!, 180),
          '<tag k="highway" v="tertiary"/><tag k="ref" v="K 2"/>',
        );
    }
  out.push('</osm>');
  return out.join('\n');
}

describe('Leistung echter Regionen', () => {
  it('ein Landkreis aus OSM: Import, Start und Tick im Budget', () => {
    const xml = largeOsm();
    let t = performance.now();
    const osm = parseOsm(xml);
    const files = buildRegionMod(osm, { id: 'grosskreis', name: 'Landkreis Großkreis' });
    const importMs = performance.now() - t;
    const region = files.region as {
      region: { prebuilt: { nodes: unknown[]; addresses: unknown[] } };
    };
    const base = {
      id: 'base',
      files: readContentFiles(join(import.meta.dirname, '..', '..', '..', 'content', 'base')),
    };
    const mod = {
      id: 'grosskreis',
      files: Object.entries(files).map(([name, data]) => ({
        path: `${name}.json`,
        text: JSON.stringify(data),
      })),
    };
    t = performance.now();
    const bundle = loadContentLayers([base, mod]);
    const sim = Simulation.create(
      defaultConfig({ seed: 1, startTime: simTimeFrom(2026, 11, 24, 9), callRateFactor: 20 }),
      bundle,
    );
    const startMs = performance.now() - t;
    sim.run(600);
    t = performance.now();
    for (let i = 0; i < 300; i++) sim.step();
    const tickMs = (performance.now() - t) / 300;
    t = performance.now();
    buildView(sim);
    const viewMs = performance.now() - t;
    console.log(
      `OSM-Knoten ${osm.nodes.size.toString()} → Graph ${region.region.prebuilt.nodes.length.toString()}, ` +
        `Adressen ${region.region.prebuilt.addresses.length.toString()}; Import ${importMs.toFixed(0)} ms, ` +
        `Start ${startMs.toFixed(0)} ms, Tick ${tickMs.toFixed(3)} ms, Ansicht ${viewMs.toFixed(1)} ms`,
    );
    expect(osm.nodes.size).toBeGreaterThan(25_000);
    // Vereinfachung: deutlich weniger Graphknoten als OSM-Knoten.
    expect(region.region.prebuilt.nodes.length).toBeLessThan(osm.nodes.size / 2);
    expect(startMs).toBeLessThan(5000);
    expect(tickMs).toBeLessThan(5);
    expect(viewMs).toBeLessThan(50);
  });
});
