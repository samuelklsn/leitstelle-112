import { describe, expect, it } from 'vitest';
import type { Ctx } from './context';
import { Simulation, defaultConfig } from './simulation';
import { createCall, pickAddress } from './systems/calls';
import { createMciTruth } from './systems/mci';
import { SHIFT_START, botAct, testContent } from './test-support';
import type { IncidentState, SimEvent } from './types';

function ctxOf(sim: Simulation): Ctx {
  return (sim as unknown as { ctx: Ctx }).ctx;
}

function drill(seed = 1): Simulation {
  return Simulation.create(
    defaultConfig({ seed, startTime: SHIFT_START, callRateFactor: 0, drill: true }),
    testContent(),
  );
}

/** Großlage gezielt anlegen: Notruf, Einsatz mit Stichwort, ohne Disposition. */
function mciIncident(sim: Simulation, scenarioId: string, keywordId?: string): IncidentState {
  const ctx = ctxOf(sim);
  const scenario = ctx.content.mciScenarios.get(scenarioId);
  if (!scenario) throw new Error('Szenario fehlt');
  const call = createCall(
    ctx,
    'emergency',
    createMciTruth(ctx, pickAddress(ctx, scenario.outdoor), scenario),
  );
  sim.submit({ type: 'call/accept', callId: call.id });
  sim.submit({
    type: 'incident/create',
    callId: call.id,
    addressId: call.truth.addressId,
    keywordId: keywordId ?? scenario.keyword,
  });
  sim.flush();
  const incident = sim.raw.incidents.find((i) => i.callId === call.id);
  if (!incident) throw new Error('Kein Einsatz');
  return incident;
}

function play(sim: Simulation, until: () => boolean, maxTicks = 8 * 3600): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < maxTicks && !until(); t++) {
    if (t % 5 === 0) botAct(sim, { cheat: true });
    events.push(...sim.step());
  }
  return events;
}

describe('Massenanfall von Verletzten', () => {
  it('MANV-Übung: der erste Notruf meldet eine Großlage', () => {
    const sim = drill();
    sim.run(30);
    const call = sim.raw.calls[0];
    expect(call?.truth.mci).toBeDefined();
    expect(call?.truth.mci?.patients.length).toBeGreaterThanOrEqual(5);
    expect(call?.truth.mci?.patients.some((p) => p.triage === 1)).toBe(true);
    expect(call?.report.conscious).toBe('unclear');
  });

  it('läuft von der Lagemeldung über die Sichtung bis zum letzten Patienten', () => {
    const sim = drill(3);
    const events = play(
      sim,
      () => sim.raw.shift.incidents > 0 && sim.raw.incidents.every((i) => i.status === 'closed'),
    );
    const incident = sim.raw.incidents[0];
    expect(incident?.status).toBe('closed');
    const mci = incident?.truth.mci;
    expect(mci?.triagedAt).toBeDefined();
    for (const p of mci?.patients ?? []) {
      expect(['delivered', 'onSite', 'deceased']).toContain(p.state);
      if (p.state === 'delivered') expect(p.hospitalId).toBeDefined();
    }
    const radio = events.filter((e) => e.type === 'radio').map((e) => e.message);
    expect(radio).toContain('mciReport');
    expect(radio).toContain('triageDone');
    // Jeder Patient zählt in der Auswertung.
    const o = sim.raw.shift.outcomes;
    expect(o.gut + o.beeintraechtigt + o.verstorben).toBe(mci?.patients.length);
    // Leitender Notarzt war im Einsatz.
    expect(events.some((e) => e.type === 'radio' && e.vehicleId === 'base:lna-1')).toBe(true);
  });

  it('Patientenverteilung nach Kapazität nutzt mehrere Kliniken', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 5, startTime: SHIFT_START, callRateFactor: 0 }),
      testContent(),
    );
    const incident = mciIncident(sim, 'base:mci-train');
    sim.submit({ type: 'mci/autoDistribute', incidentId: incident.id, on: true });
    sim.submit({ type: 'mci/staging', incidentId: incident.id, on: true });
    sim.flush();
    play(sim, () => incident.status === 'closed');
    const hospitals = new Set(
      incident.truth.mci?.patients.flatMap((p) => (p.hospitalId ? [p.hospitalId] : [])),
    );
    expect(hospitals.size).toBeGreaterThanOrEqual(2);
  });

  it('Großlage mit einfachem Stichwort ist eine Untertriagierung', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 2, startTime: SHIFT_START, callRateFactor: 0 }),
      testContent(),
    );
    const incident = mciIncident(sim, 'base:mci-pileup', 'base:rd1');
    play(sim, () => incident.status === 'closed');
    expect(incident.errors).toContain('undertriage');
  });

  it('SEG und Einsatzleitung werden nur bei Großlagen vorgeschlagen', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 2, startTime: SHIFT_START, callRateFactor: 0 }),
      testContent(),
    );
    const ctx = ctxOf(sim);
    const reserve = ctx.content.reserveVehicles;
    const normal = mciIncident(sim, 'base:mci-pileup', 'base:rd1');
    expect(
      sim.suggestVehicles(normal.id).some((s) => s.recommended && reserve.has(s.vehicleId)),
    ).toBe(false);
    const large = mciIncident(sim, 'base:mci-bus');
    const rec = sim.suggestVehicles(large.id).filter((s) => s.recommended);
    expect(rec.some((s) => s.vehicleId === 'base:lna-1')).toBe(true);
    expect(rec.some((s) => s.vehicleId === 'base:orgl-1')).toBe(true);
  });

  it('Befehle für Großlagen werden bei normalen Einsätzen abgelehnt', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 2, startTime: SHIFT_START, callRateFactor: 0 }),
      testContent(),
    );
    const call = createCall(ctxOf(sim), 'emergency');
    sim.submit({ type: 'call/accept', callId: call.id });
    sim.submit({
      type: 'incident/create',
      callId: call.id,
      addressId: call.truth.addressId,
      keywordId: 'base:rd1',
    });
    sim.flush();
    const id = sim.raw.incidents[0]?.id ?? '';
    sim.submit({ type: 'mci/staging', incidentId: id, on: true });
    const rejected = sim.flush().find((e) => e.type === 'command/rejected');
    expect(rejected?.type === 'command/rejected' && rejected.reason).toBe('notMci');
  });
});
