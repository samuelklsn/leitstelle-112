import { describe, expect, it } from 'vitest';
import type { Simulation } from './simulation';
import { newSim } from './test-support';
import type { SimEvent } from './types';

/** Ersten Notruf im Trainingsmodus abwarten und annehmen. */
function firstCall(sim: Simulation) {
  while (sim.raw.calls.length === 0) sim.step();
  const call = sim.raw.calls[0]!;
  sim.submit({ type: 'call/accept', callId: call.id });
  sim.flush();
  return call;
}

function createAndDispatch(sim: Simulation, keywordId: string) {
  const call = firstCall(sim);
  sim.submit({
    type: 'incident/create',
    callId: call.id,
    addressId: call.truth.addressId,
    keywordId,
  });
  sim.flush();
  const incident = sim.raw.incidents[0]!;
  const ids = sim
    .suggestVehicles(incident.id)
    .filter((s) => s.recommended)
    .map((s) => s.vehicleId);
  sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: ids });
  sim.flush();
  return { call, incident, ids };
}

function runUntil(
  sim: Simulation,
  pred: (events: SimEvent[]) => boolean,
  max = 3 * 3600,
): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < max; t++) {
    all.push(...sim.step());
    if (pred(all)) break;
  }
  return all;
}

describe('Notrufe', () => {
  it('Gespräch ohne Einsatz beenden: Fehler nur, wenn ein Notfall dahinterstand', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = newSim({ seed, callRateFactor: 0, tutorial: true });
      const call = firstCall(sim);
      const d = sim.content.diagnoses.get(call.truth.diagnosisId)!;
      sim.submit({ type: 'call/close', callId: call.id });
      const events = sim.flush();
      expect(events.map((e) => e.type)).toContain('call/closed');
      expect(sim.raw.calls).toHaveLength(0);
      expect(sim.raw.shift.errors.callClosedWithEmergency ?? 0).toBe(d.transport > 0 ? 1 : 0);
    }
  });

  it('wartende Notrufe lassen sich nicht beenden, beendete nicht annehmen', () => {
    const sim = newSim({ callRateFactor: 0, tutorial: true });
    while (sim.raw.calls.length === 0) sim.step();
    const id = sim.raw.calls[0]!.id;
    sim.submit({ type: 'call/close', callId: id });
    sim.submit({ type: 'incident/create', callId: id, addressId: 0, keywordId: 'base:rd1' });
    sim.submit({ type: 'call/accept', callId: id });
    sim.submit({ type: 'call/accept', callId: id });
    const reasons = sim.flush().flatMap((e) => (e.type === 'command/rejected' ? [e.reason] : []));
    expect(reasons).toEqual(['callNotTalking', 'callNotTalking', 'callNotWaiting']);
  });

  it('lehnt unbekannte Adressen und Stichworte ab', () => {
    const sim = newSim({ callRateFactor: 0, tutorial: true });
    const call = firstCall(sim);
    sim.submit({
      type: 'incident/create',
      callId: call.id,
      addressId: 9_999_999,
      keywordId: 'base:rd1',
    });
    sim.submit({ type: 'incident/create', callId: call.id, addressId: 0, keywordId: 'base:rd9' });
    const reasons = sim.flush().flatMap((e) => (e.type === 'command/rejected' ? [e.reason] : []));
    expect(reasons).toEqual(['unknownAddress', 'unknownKeyword']);
  });
});

describe('Disposition und Abbestellen', () => {
  it('RD 3: überzähliger RTW und (falls nicht nötig) der Notarzt werden nach dem Erstbefund frei', () => {
    const sim = newSim({ seed: 8, callRateFactor: 0, tutorial: true });
    const { incident, ids } = createAndDispatch(sim, 'base:rd3');
    expect(ids).toHaveLength(3);
    const events = runUntil(sim, () => sim.raw.incidents[0]?.assessed === true);
    const messages = events.flatMap((e) => (e.type === 'radio' ? [e.message] : []));
    if (
      incident.truth.transport ||
      sim.content.diagnoses.get(incident.truth.diagnosisId)?.transport !== 0
    ) {
      expect(messages).toContain('secondUnitNotNeeded');
    }
    if (!incident.truth.needsDoctor) expect(messages).toContain('doctorNotNeeded');
    expect(sim.raw.incidents[0]!.vehicleIds.length).toBeLessThan(3);
  });

  it('Abbestellen auf der Anfahrt macht das Fahrzeug frei und den Einsatz wieder offen', () => {
    const sim = newSim({ seed: 3, callRateFactor: 0, tutorial: true });
    const { incident, ids } = createAndDispatch(sim, 'base:rd1');
    runUntil(sim, () => sim.raw.vehicles.some((v) => v.task === 'toScene'));
    sim.submit({ type: 'vehicle/release', vehicleId: ids[0]! });
    const events = sim.flush();
    expect(events.some((e) => e.type === 'radio' && e.message === 'released')).toBe(true);
    const v = sim.raw.vehicles.find((x) => x.id === ids[0])!;
    expect(v.status).toBe(1);
    expect(v.task).toBe('returning');
    expect(sim.raw.incidents.find((i) => i.id === incident.id)?.status).toBe('open');
    // Ein bereits freies Fahrzeug lässt sich nicht noch einmal abbestellen.
    sim.submit({ type: 'vehicle/release', vehicleId: ids[0]! });
    expect(
      sim.flush().some((e) => e.type === 'command/rejected' && e.reason === 'notReleasable'),
    ).toBe(true);
  });

  it('lehnt Alarmierung belegter Fahrzeuge und Zielklinik ohne Sprechwunsch ab', () => {
    const sim = newSim({ seed: 4, callRateFactor: 0, tutorial: true });
    const { incident, ids } = createAndDispatch(sim, 'base:rd1');
    sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: ids });
    sim.submit({
      type: 'vehicle/assignDestination',
      vehicleId: ids[0]!,
      hospitalId: 'base:kk-brakenfeld',
    });
    sim.submit({
      type: 'incident/dispatch',
      incidentId: incident.id,
      vehicleIds: ['base:gibt-es-nicht'],
    });
    const reasons = sim.flush().flatMap((e) => (e.type === 'command/rejected' ? [e.reason] : []));
    expect(reasons).toEqual(['vehicleBusy', 'notAwaitingDestination', 'unknownVehicle']);
  });

  it('Zielklinik ohne passende Fachabteilung wird als Fehler gewertet', () => {
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const sim = newSim({ seed, callRateFactor: 0, tutorial: true });
      const { incident } = createAndDispatch(sim, 'base:rd2');
      const dept = sim.content.diagnoses.get(incident.truth.diagnosisId)?.department;
      if (
        !incident.truth.transport ||
        !dept ||
        dept === 'innere' ||
        dept === 'chirurgie' ||
        dept === 'psychiatrie'
      )
        continue;
      runUntil(sim, () => sim.raw.vehicles.some((v) => v.task === 'awaitDestination'));
      const v = sim.raw.vehicles.find((x) => x.task === 'awaitDestination')!;
      // Klinik Ellerbach hat keine Fachabteilung für Herz, Schlaganfall, Trauma oder Kinder.
      sim.submit({
        type: 'vehicle/assignDestination',
        vehicleId: v.id,
        hospitalId: 'base:kl-ellerbach',
      });
      sim.flush();
      expect(sim.raw.incidents[0]?.errors).toContain('unsuitableHospital');
      return;
    }
    throw new Error('Kein passender Testfall unter den Seeds gefunden');
  });
});
