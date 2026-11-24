import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContentFromDirs } from '@ls112/content/node';
import { DEFAULT_TRAVEL_MODEL, Router, UNREACHABLE, nearestNode } from '@ls112/routing';
import { hashValue } from '../hash';
import { generateWorld } from './generator';
import { detCos, detSin, segmentsCross } from './geometry';
import { worldToMap } from './geojson';

const content = loadContentFromDirs(
  join(import.meta.dirname, '..', '..', '..', '..', 'content', 'base'),
);

describe('Geometrie', () => {
  it('detSin/detCos stimmen mit Math überein (Genauigkeit)', () => {
    for (let a = -10; a <= 10; a += 0.37) {
      expect(Math.abs(detSin(a) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(detCos(a) - Math.cos(a))).toBeLessThan(1e-9);
    }
  });

  it('erkennt Kreuzungen', () => {
    expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsCross([0, 0], [10, 0], [0, 1], [10, 1])).toBe(false);
  });
});

describe('Weltgenerator Brakenfeld', () => {
  const world = generateWorld(content.region);

  it('ist deterministisch', () => {
    const again = generateWorld(content.region);
    const digest = (w: typeof world) =>
      hashValue({
        x: Array.from(w.graph.x),
        y: Array.from(w.graph.y),
        seg: w.segments,
        adr: w.addresses,
      });
    expect(digest(again)).toBe(digest(world));
  });

  it('hat eine glaubwürdige Größe', () => {
    expect(world.graph.nodeCount).toBeGreaterThan(1000);
    expect(world.addresses.filter((a) => a.kind === 'house').length).toBeGreaterThan(5000);
    expect(world.roadAddressIds.length).toBeGreaterThan(8);
    // Jeder Ort hat Adressen, die Kreisstadt die meisten.
    const perTown = new Map<string, number>();
    for (const a of world.addresses) perTown.set(a.townId, (perTown.get(a.townId) ?? 0) + 1);
    for (const t of content.region.towns) expect(perTown.get(t.id) ?? 0).toBeGreaterThan(50);
    expect(Math.max(...perTown.values())).toBe(perTown.get('base:brakenfeld'));
  });

  it('alle Wachen erreichen alle Krankenhäuser und jede Adresse', () => {
    const router = new Router(world.graph, DEFAULT_TRAVEL_MODEL);
    const ctx = { hour: 10, weekend: false, emergency: true };
    for (const s of content.stations) {
      const from = nearestNode(world.graph, s.position[0], s.position[1]);
      const tree = router.timesFrom(from, ctx);
      for (const a of world.addresses) expect(tree.dist[a.node]).not.toBe(UNREACHABLE);
      for (const h of content.hospitals) {
        expect(tree.dist[nearestNode(world.graph, h.position[0], h.position[1])]).toBeLessThan(
          40 * 60_000,
        );
      }
    }
  });

  it('Hausnummern sind je Straße eindeutig', () => {
    const seen = new Set<string>();
    for (const a of world.addresses) {
      if (a.kind !== 'house') continue;
      const key = `${a.streetId.toString()}|${a.number}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('Gewichte für die Einsatzortwahl sind monoton und summieren die Einwohner', () => {
    for (let i = 1; i < world.houseWeights.length; i++) {
      expect(world.houseWeights[i]).toBeGreaterThanOrEqual(world.houseWeights[i - 1] ?? 0);
    }
    const total = content.region.towns.reduce((s, t) => s + t.population, 0);
    expect(world.houseWeights.at(-1)).toBeCloseTo(total, 3);
  });

  it('exportiert Kartendaten in Länge/Breite innerhalb der Grenzen', () => {
    const map = worldToMap(world);
    const [[w, s], [e, n]] = map.bounds;
    expect(map.roads.features.length).toBe(world.segments.length);
    for (const f of map.roads.features.slice(0, 200)) {
      if (f.geometry.type !== 'LineString') continue;
      for (const [lon, lat] of f.geometry.coordinates) {
        expect(lon).toBeGreaterThan(w - 0.05);
        expect(lon).toBeLessThan(e + 0.05);
        expect(lat).toBeGreaterThan(s - 0.05);
        expect(lat).toBeLessThan(n + 0.05);
      }
    }
  });
});
