import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@ls112/content';
import { Simulation, defaultConfig } from './simulation';
import { SHIFT_START, baseContent, botAct } from './test-support';
import { buildView } from './view';

/**
 * Performance-Budget aus der Anforderung: 300 gleichzeitige Fahrzeuge und 100 aktive Einsätze
 * ohne Ruckeln. Bei 10× Zeitraffer muss der Kern 10 Ticks pro Sekunde schaffen; das Budget von
 * 5 ms je Tick lässt reichlich Luft für Ansicht und Übertragung (ADR-0010).
 */
const TICK_BUDGET_MS = 5;
const VIEW_BUDGET_MS = 8;

/** Basisinhalte, aber jede Wache mit vielen zusätzlichen Fahrzeugen (synthetische Last). */
function heavyContent(vehicleCount: number): ContentBundle {
  const base = baseContent();
  const perStation = Math.ceil(vehicleCount / base.stations.length);
  const stations = base.stations.map((s) => ({
    ...s,
    vehicles: Array.from({ length: perStation }, (_, i) => {
      const template = s.vehicles[i % s.vehicles.length] ?? s.vehicles[0]!;
      return {
        ...template,
        id: `${template.id}-x${i.toString()}`,
        callsign: `${template.callsign}/${i.toString()}`,
      };
    }),
  }));
  return { ...base, stations };
}

describe('Performance', () => {
  it('300 Fahrzeuge und ≥ 100 aktive Einsätze: Tick < 5 ms, Ansicht < 8 ms', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 99, startTime: SHIFT_START + 3 * 3600_000, callRateFactor: 120 }),
      heavyContent(300),
    );
    expect(sim.raw.vehicles.length).toBeGreaterThanOrEqual(300);

    // Lage aufbauen, bis 100 Einsätze gleichzeitig laufen.
    for (
      let t = 0;
      t < 3600 && sim.raw.incidents.filter((i) => i.status !== 'closed').length < 100;
      t++
    ) {
      if (t % 10 === 0) botAct(sim, { cheat: true });
      sim.step();
    }
    const active = sim.raw.incidents.filter((i) => i.status !== 'closed').length;
    expect(active).toBeGreaterThanOrEqual(100);

    // Messen: 600 Ticks (10 Spielminuten) inkl. Disponent, der ständig handelt.
    let tickMs = 0;
    let viewMs = 0;
    const ticks = 600;
    for (let t = 0; t < ticks; t++) {
      if (t % 10 === 0) botAct(sim, { cheat: true });
      const a = performance.now();
      sim.step();
      const b = performance.now();
      if (t % 10 === 0) {
        buildView(sim);
        viewMs = Math.max(viewMs, performance.now() - b);
      }
      tickMs += b - a;
    }
    const avg = tickMs / ticks;
    console.info(
      `Last: ${sim.raw.vehicles.length.toString()} Fz, ${active.toString()} Einsätze – Tick Ø ${avg.toFixed(3)} ms, Ansicht max ${viewMs.toFixed(2)} ms`,
    );
    expect(avg).toBeLessThan(TICK_BUDGET_MS);
    expect(viewMs).toBeLessThan(VIEW_BUDGET_MS);
  });
});
