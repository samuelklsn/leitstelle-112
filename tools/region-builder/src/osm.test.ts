import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadWithMods } from '@ls112/content/node';
import { Simulation, defaultConfig, simTimeFrom } from '@ls112/sim';
import { buildRegionMod, parseOsm } from './osm';

const BASE = join(import.meta.dirname, '..', '..', '..', 'content', 'base');
const tmp = mkdtempSync(join(tmpdir(), 'ls112-osm-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Synthetischer OSM-Auszug: zwei Orte mit Straßenraster, eine Landstraße dazwischen, einige
 * Hausnummern, Klinik, Feuerwache, Rettungswache, Wald und Fluss. Koordinaten um 50,9° N / 9,3° O.
 */
function syntheticOsm(): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6">'];
  let id = 1;
  const node = (lat: number, lon: number, tags: Record<string, string> = {}) => {
    const n = id++;
    const t = Object.entries(tags)
      .map(([k, v]) => `<tag k="${k}" v="${v.replaceAll('&', '&amp;')}"/>`)
      .join('');
    parts.push(
      t
        ? `<node id="${n.toString()}" lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${t}</node>`
        : `<node id="${n.toString()}" lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`,
    );
    return n;
  };
  const way = (refs: number[], tags: Record<string, string>) => {
    const n = id++;
    parts.push(
      `<way id="${n.toString()}">${refs.map((r) => `<nd ref="${r.toString()}"/>`).join('')}${Object.entries(
        tags,
      )
        .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
        .join('')}</way>`,
    );
  };
  const town = (name: string, lat: number, lon: number, place: string, pop: string) => {
    node(lat, lon, { place, name, population: pop });
    // 5 × 5 Raster mit 150 m Abstand (≈ 0,00135° Breite, 0,0021° Länge).
    const grid: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const row: number[] = [];
      for (let j = 0; j < 5; j++) row.push(node(lat + (i - 2) * 0.00135, lon + (j - 2) * 0.0021));
      grid.push(row);
    }
    for (let i = 0; i < 5; i++) {
      way(grid[i] ?? [], { highway: 'residential', name: `${name}er Weg ${(i + 1).toString()}` });
      way(
        grid.map((r) => r[i] ?? 0),
        {
          highway: i === 2 ? 'tertiary' : 'residential',
          name: i === 2 ? 'Hauptstraße' : `Gasse ${(i + 1).toString()}`,
        },
      );
    }
    return grid;
  };
  const a = town('Altdorf', 50.9, 9.3, 'town', '8000');
  const b = town('Neuweiler', 50.92, 9.36, 'village', '900');
  // Landstraße zwischen den Orten (Ostrand Altdorf → Westrand Neuweiler).
  const mid = node(50.91, 9.33);
  way([a[2]?.[4] ?? 0, mid, b[2]?.[0] ?? 0], { highway: 'secondary', ref: 'L 3001' });
  // Ein abgehängtes Stück, das wegfallen muss.
  way([node(50.95, 9.4), node(50.951, 9.401)], { highway: 'residential', name: 'Insel' });
  // Hausnummern in Altdorf.
  for (let k = 1; k <= 5; k++)
    node(50.9 + 0.0001 * k, 9.3 + 0.0002, {
      'addr:street': 'Hauptstraße',
      'addr:housenumber': k.toString(),
    });
  node(50.899, 9.299, { amenity: 'hospital', name: 'Kreiskrankenhaus Altdorf' });
  node(50.901, 9.302, { amenity: 'fire_station', name: 'Feuerwache Altdorf' });
  node(50.921, 9.361, { amenity: 'fire_station', name: 'Freiwillige Feuerwehr Neuweiler' });
  node(50.9005, 9.298, { emergency: 'ambulance_station', name: 'Rettungswache Altdorf' });
  const f = [node(50.93, 9.3), node(50.935, 9.3), node(50.935, 9.31), node(50.93, 9.31)];
  way([...f, f[0] ?? 0], { landuse: 'forest', name: 'Altdorfer Forst' });
  way([node(50.89, 9.28), node(50.905, 9.33), node(50.915, 9.38)], {
    waterway: 'river',
    name: 'Alde',
  });
  parts.push('</osm>');
  return parts.join('\n');
}

describe('OSM-Import (ADR-0020)', () => {
  const osm = parseOsm(syntheticOsm());

  it('liest Knoten, Wege und Tags samt Entities', () => {
    const parsed = parseOsm(
      '<osm><node id="1" lat="1" lon="2"><tag k="name" v="A &amp; B"/></node><way id="5"><nd ref="1"/></way></osm>',
    );
    expect(parsed.nodes.get('1')?.tags.name).toBe('A & B');
    expect(parsed.ways[0]?.refs).toEqual(['1']);
    expect(osm.ways.length).toBeGreaterThan(10);
  });

  it('baut ein Region-Mod mit Orten, Netz, Adressen und Einrichtungen', () => {
    const files = buildRegionMod(osm, { id: 'testkreis', name: 'Landkreis Testkreis' });
    const region = (files.region as { region: Record<string, unknown> }).region as {
      towns: { id: string; population: number }[];
      prebuilt: {
        nodes: unknown[];
        addresses: [number, string, string][];
        roadSections: unknown[];
      };
      attribution: string;
      river?: unknown;
      forests: unknown[];
    };
    expect(region.towns.map((t) => t.id)).toEqual(['testkreis:altdorf', 'testkreis:neuweiler']);
    expect(region.towns[0]?.population).toBe(8000);
    // Abgehängtes Stück entfernt (2 × 25 Rasterknoten + 1 Zwischenknoten), gerade Abschnitte
    // vereinfacht – Kreuzungen bleiben.
    expect(region.prebuilt.nodes.length).toBeLessThanOrEqual(51);
    expect(region.prebuilt.nodes.length).toBeGreaterThanOrEqual(50);
    expect(region.prebuilt.addresses.some((a) => a[1] === '3')).toBe(true);
    expect(region.prebuilt.roadSections.length).toBeGreaterThanOrEqual(1);
    expect(region.attribution).toContain('OpenStreetMap');
    expect(region.river).toBeDefined();
    expect(region.forests).toHaveLength(1);
    const e = files.einrichtungen as { stations: { kind: string; turnout?: unknown }[] };
    expect(e.stations.filter((s) => s.kind === 'feuerwache')).toHaveLength(2);
    // Freiwillige Feuerwehr: längere Ausrückzeit; Feuerwache: hauptamtlich.
    expect(e.stations.filter((s) => s.kind === 'feuerwache' && s.turnout)).toHaveLength(1);
  });

  it('das Mod ersetzt den fiktiven Landkreis und lässt sich spielen', () => {
    const files = buildRegionMod(osm, { id: 'testkreis', name: 'Landkreis Testkreis' });
    const dir = join(tmp, 'testkreis');
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(files))
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
    const { bundle, mods } = loadWithMods(BASE, tmp);
    expect(mods[0]?.problems ?? []).toEqual([]);
    expect(mods[0]?.ok).toBe(true);
    expect(bundle.region.name).toBe('Landkreis Testkreis');
    expect(bundle.stations.every((s) => s.id.startsWith('testkreis:'))).toBe(true);
    const sim = Simulation.create(
      defaultConfig({ seed: 5, startTime: simTimeFrom(2026, 11, 24, 7), callRateFactor: 8 }),
      bundle,
    );
    expect(sim.world.graph.nodeCount).toBeGreaterThanOrEqual(50);
    // Eine Stunde mit vielen Notrufen: Fahrzeuge erreichen Einsatzorte über das echte Netz.
    let arrived = 0;
    for (let t = 0; t < 3600; t++) {
      for (const c of sim.raw.calls.filter((x) => x.status === 'waiting').slice(0, 1)) {
        if (sim.raw.calls.some((x) => x.status === 'talking')) break;
        sim.submit({ type: 'call/accept', callId: c.id });
      }
      const talking = sim.raw.calls.find((x) => x.status === 'talking');
      if (talking)
        sim.submit({
          type: 'incident/create',
          callId: talking.id,
          addressId: talking.truth.addressId,
          keywordId: 'base:rd1',
        });
      sim.flush();
      for (const i of sim.raw.incidents.filter((x) => x.status === 'open')) {
        const rec = sim.suggestVehicles(i.id).filter((s) => s.recommended);
        if (rec.length > 0)
          sim.submit({
            type: 'incident/dispatch',
            incidentId: i.id,
            vehicleIds: rec.map((s) => s.vehicleId),
          });
      }
      for (const e of sim.step()) if (e.type === 'radio' && e.message === 'arrived') arrived++;
    }
    expect(arrived).toBeGreaterThan(0);
  });
});
