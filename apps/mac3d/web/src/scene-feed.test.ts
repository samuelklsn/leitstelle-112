import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContentFromDirs } from '@ls112/content/node';
import { SimHost } from '@ls112/host';
import { simTimeFrom } from '@ls112/sim';
import { createStateMapper, incidentClass, toSceneWorld } from './scene-feed';

const content = loadContentFromDirs(
  join(import.meta.dirname, '..', '..', '..', '..', 'content', 'base'),
);
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function makeHost(): SimHost {
  const host = new SimHost({
    content,
    log: silent,
    newSeed: () => 7,
    startTime: () => simTimeFrom(2026, 11, 25, 7),
  });
  host.newGame('free');
  return host;
}

describe('Szenen-Feed für die 3D-Ansicht', () => {
  it('liefert die Welt in lokalen Metern innerhalb der Regionsgröße', () => {
    const host = makeHost();
    const world = toSceneWorld(buildWorld(host));
    expect(world.roads.length).toBeGreaterThan(100);
    expect(world.stations.length).toBe(content.stations.length);
    expect(world.hospitals.length).toBe(content.hospitals.length);
    const [w, h] = world.size;
    // Rundung der Länge/Breite-Umrechnung: wenige Meter Toleranz.
    for (const [, x1, y1, x2, y2] of world.roads)
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ] as const) {
        expect(x).toBeGreaterThanOrEqual(-5);
        expect(y).toBeGreaterThanOrEqual(-5);
        expect(x).toBeLessThanOrEqual(w + 5);
        expect(y).toBeLessThanOrEqual(h + 5);
      }
    expect(world.houses.length % 2).toBe(0);
  });

  it('bildet Fahrzeuge und Einsätze ab, Fahrzeuge mit Klasse und Kurzname', () => {
    const host = makeHost();
    const map = createStateMapper(buildWorld(host));
    for (let i = 0; i < 400; i++) host.update(1000);
    const state = map(host.state());
    expect(state.vehicles.length).toBeGreaterThan(10);
    expect(state.vehicles.some((v) => v.cls === 'rtw')).toBe(true);
    expect(state.vehicles.some((v) => v.cls === 'fire')).toBe(true);
    expect(state.vehicles.every((v) => v.label.length > 0)).toBe(true);
    expect(state.hour).toBeGreaterThanOrEqual(7);
  });

  it('ordnet Stichworte grob nach Einsatzart', () => {
    expect(incidentClass('RD 2', false)).toBe('rd');
    expect(incidentClass('B 3', false)).toBe('fire');
    expect(incidentClass('TH 1', false)).toBe('th');
    expect(incidentClass('RD 2', true)).toBe('mci');
  });
});

/** Weltdaten wie sie der Host an ein Fenster schickt. */
function buildWorld(host: SimHost) {
  let world: Parameters<typeof toSceneWorld>[0] | undefined;
  host.addClient({
    postMessage: (m) => {
      if (m.type === 'world') world = m.world;
    },
    onMessage: () => undefined,
    onClose: () => undefined,
  });
  if (!world) throw new Error('keine Weltdaten');
  return world;
}
