import { describe, expect, it } from 'vitest';
import { Simulation, defaultConfig } from './simulation';
import { responseStart } from './systems/outcome';
import { SHIFT_START, botAct, testContent } from './test-support';
import type { IncidentState } from './types';
import { buildView } from './view';

describe('Trainingsszenarien (ADR-0019)', () => {
  it('geplante Notrufe kommen zur geplanten Minute, das Wetter ist festgelegt', () => {
    const sim = Simulation.create(
      defaultConfig({
        seed: 3,
        startTime: SHIFT_START,
        callRateFactor: 0,
        scenarioId: 'base:szenario-glatteis',
      }),
      testContent(),
    );
    expect(sim.raw.world.weatherId).toBe('base:glaette');
    sim.run(59);
    expect(sim.raw.calls).toHaveLength(0);
    sim.run(2);
    const first = sim.raw.calls[0];
    expect(first?.truth.diagnosisId).toBe('base:fall');
    expect(sim.world.addresses[first?.truth.addressId ?? 0]?.townId).toBe('base:brakenfeld');
    sim.run(5 * 60);
    expect(sim.raw.calls.some((c) => c.truth.fire?.scenarioId === 'base:th-trapped')).toBe(true);
    expect(buildView(sim).scenario?.id).toBe('base:szenario-glatteis');
  });

  it('startet Ereignisse des Szenarios gleich mit', () => {
    const sim = Simulation.create(
      defaultConfig({
        seed: 3,
        startTime: SHIFT_START,
        callRateFactor: 0,
        scenarioId: 'base:szenario-sommerfest',
      }),
      testContent(),
    );
    expect(sim.raw.world.events.map((e) => e.eventId)).toContain('base:volksfest');
  });

  it('unbekannte Szenarien werden abgelehnt', () => {
    expect(() =>
      Simulation.create(
        defaultConfig({ startTime: SHIFT_START, scenarioId: 'base:gibt-es-nicht' }),
        testContent(),
      ),
    ).toThrow(RangeError);
  });
});

describe('Hilfsfrist-Regeln (#32)', () => {
  const incident = {
    receivedAt: 1000,
    firstAlarmAt: 61_000,
    firstDepartureAt: 151_000,
  } as IncidentState;

  it('misst je nach Regel ab Notruf, Alarmierung oder Ausrücken', () => {
    expect(responseStart(incident, 'call')).toBe(1000);
    expect(responseStart(incident, 'dispatch')).toBe(61_000);
    expect(responseStart(incident, 'departure')).toBe(151_000);
    expect(responseStart({ receivedAt: 5 } as IncidentState, 'departure')).toBe(5);
  });

  it('das Preset gilt im Spiel und in der Sicht', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 1, startTime: SHIFT_START, hilfsfristPreset: 'base:hf-by' }),
      testContent(),
    );
    const hf = buildView(sim).hilfsfrist;
    expect(hf.minutes).toBe(12);
    expect(hf.targetQuota).toBe(0.8);
    expect(hf.measure).toBe('departure');
    // Reine Fahrzeit ist kürzer als ab Notrufeingang – die Quote steigt.
    for (let t = 0; t < 3 * 3600; t++) {
      if (t % 5 === 0) botAct(sim, { cheat: true });
      sim.step();
    }
    const closed = sim.raw.incidents.find((i) => i.firstDepartureAt !== undefined);
    expect(closed?.firstDepartureAt).toBeGreaterThanOrEqual(closed?.firstAlarmAt ?? 0);
  });
});
