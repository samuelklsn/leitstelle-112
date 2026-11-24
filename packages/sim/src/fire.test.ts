import { describe, expect, it } from 'vitest';
import type { Simulation } from './simulation';
import { createCall } from './systems/calls';
import { newSim } from './test-support';
import type { CallState, SimEvent } from './types';

function ctxOf(sim: Simulation) {
  return (sim as unknown as { ctx: Parameters<typeof createCall>[0] }).ctx;
}

/** Erzeugt so lange Notrufe, bis einer die gewünschte Feuerwehrlage hat; nimmt ihn an. */
function fireCall(sim: Simulation, scenarioId: string, withPatient?: boolean): CallState {
  for (let i = 0; i < 5000; i++) {
    const call = createCall(ctxOf(sim), 'emergency');
    const ok =
      call.truth.fire?.scenarioId === scenarioId &&
      (withPatient === undefined || call.truth.patient === withPatient);
    if (ok && call.source === '112') {
      // Alle anderen Probeanrufe verwerfen, damit sie das Szenario nicht stören.
      for (const c of [...sim.raw.calls])
        if (c.id !== call.id) ctxOf(sim).state.calls.splice(ctxOf(sim).state.calls.indexOf(c), 1);
      sim.submit({ type: 'call/accept', callId: call.id });
      sim.flush();
      return call;
    }
  }
  throw new Error(`Keine Lage ${scenarioId} erzeugt`);
}

function createIncident(sim: Simulation, call: CallState, keywordId: string) {
  sim.submit({
    type: 'incident/create',
    callId: call.id,
    addressId: call.truth.addressId,
    keywordId,
  });
  sim.flush();
  return sim.raw.incidents.find((i) => i.callId === call.id)!;
}

function dispatchRecommended(sim: Simulation, incidentId: string): string[] {
  const ids = sim
    .suggestVehicles(incidentId)
    .filter((s) => s.recommended)
    .map((s) => s.vehicleId);
  if (ids.length > 0) sim.submit({ type: 'incident/dispatch', incidentId, vehicleIds: ids });
  sim.flush();
  return ids;
}

/** Spielt weiter und alarmiert Nachforderungen sofort, bis der Einsatz abgeschlossen ist. */
function runToEnd(sim: Simulation, incidentId: string, maxTicks = 6 * 3600): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    const incident = sim.raw.incidents.find((i) => i.id === incidentId);
    if (!incident || incident.status === 'closed') break;
    if (t % 5 === 0 && incident.assessed && sim.missingNeeds(incidentId).length > 0) {
      dispatchRecommended(sim, incidentId);
    }
    for (const v of sim.raw.vehicles) {
      if (v.task === 'awaitDestination') {
        const h = sim.suggestHospitals(v.id)[0];
        if (h)
          sim.submit({
            type: 'vehicle/assignDestination',
            vehicleId: v.id,
            hospitalId: h.hospitalId,
          });
      }
    }
    sim.flush();
    events.push(...sim.step());
  }
  return events;
}

const radio = (events: SimEvent[]) =>
  events.flatMap((e) => (e.type === 'radio' ? [e.message] : []));

describe('Feuerwehr – Alarmierung', () => {
  it('B 1 schlägt das nächste Löschfahrzeug vor – HLF oder LF', () => {
    const sim = newSim({ seed: 2, callRateFactor: 0 });
    const call = fireCall(sim, 'base:fire-bin');
    const incident = createIncident(sim, call, 'base:b1');
    const rec = sim.suggestVehicles(incident.id).filter((s) => s.recommended);
    expect(rec).toHaveLength(1);
    const type = sim.raw.vehicles.find((v) => v.id === rec[0]!.vehicleId)?.typeId;
    expect(['base:hlf', 'base:lf']).toContain(type);
  });

  it('Freiwillige Feuerwehren rücken deutlich langsamer aus als die Wache mit Hauptamtlichen', () => {
    const sim = newSim({ seed: 5, callRateFactor: 0 });
    const turnout = ctxOf(sim).content.stationTurnout;
    const pro = turnout.get('base:fw-brakenfeld')!.day;
    const volunteer = turnout.get('base:ff-hagenried')!.day;
    expect(volunteer[0]).toBeGreaterThan(pro[1]);
  });
});

describe('Feuerwehr – Ablauf', () => {
  it('Küchenbrand mit B 2: Lagemeldung, Abarbeitung, Feuer aus, Einsatz geschlossen', () => {
    const sim = newSim({ seed: 3, callRateFactor: 0 });
    const call = fireCall(sim, 'base:fire-kitchen');
    const incident = createIncident(sim, call, 'base:b2');
    dispatchRecommended(sim, incident.id);
    const events = runToEnd(sim, incident.id);
    const msgs = radio(events);
    expect(msgs.some((m) => m === 'fireReport' || m === 'requestUnits')).toBe(true);
    expect(msgs).toContain('fireUnderControl');
    const closed = events.find((e) => e.type === 'incident/closed');
    expect(closed?.type === 'incident/closed' && closed.outcome).not.toBe('verstorben');
    expect(sim.raw.shift.fireMeasured).toBe(1);
    // Alle Fahrzeuge sind wieder frei.
    expect(sim.raw.vehicles.every((v) => v.incidentId === null)).toBe(true);
  });

  it('ohne Kräfte breitet sich ein Küchenbrand zum Wohnungsbrand aus (mit Nachforderung)', () => {
    const sim = newSim({ seed: 4, callRateFactor: 0 });
    const call = fireCall(sim, 'base:fire-kitchen', false);
    const incident = createIncident(sim, call, 'base:b1');
    // 20 Minuten nichts tun – die Lage entwickelt sich weiter.
    sim.run(20 * 60);
    expect(incident.truth.fire?.scenarioId).toBe('base:fire-flat');
    expect(incident.errors).toContain('fireSpread');
    dispatchRecommended(sim, incident.id);
    const events = runToEnd(sim, incident.id);
    // B 1 schickt ein Fahrzeug – für den Wohnungsbrand fehlen ELW, DLK und ein zweites HLF.
    expect(radio(events)).toContain('requestUnits');
    expect(radio(events)).toContain('fireUnderControl');
    expect(sim.raw.shift.outcomes.beeintraechtigt).toBe(1);
    expect(sim.raw.shift.errors.undertriage).toBe(1);
  });

  it('eingeklemmte Person: Transport erst nach der technischen Rettung', () => {
    const sim = newSim({ seed: 6, callRateFactor: 0 });
    const call = fireCall(sim, 'base:th-trapped', true);
    const incident = createIncident(sim, call, 'base:th2');
    dispatchRecommended(sim, incident.id);
    const events = runToEnd(sim, incident.id);
    const order = events.flatMap((e) =>
      e.type === 'radio' && (e.message === 'fireUnderControl' || e.message === 'requestDestination')
        ? [e.message]
        : [],
    );
    expect(order.indexOf('fireUnderControl')).toBeGreaterThanOrEqual(0);
    if (incident.truth.transport) {
      expect(order.indexOf('requestDestination')).toBeGreaterThan(
        order.indexOf('fireUnderControl'),
      );
    }
  });

  it('Feuerwehrlage ohne Verletzte: alarmierter RTW wird nach der Lagemeldung frei', () => {
    const sim = newSim({ seed: 7, callRateFactor: 0 });
    const call = fireCall(sim, 'base:fire-flat', false);
    const incident = createIncident(sim, call, 'base:b2');
    const ids = dispatchRecommended(sim, incident.id);
    const rtw = ids.find((id) => id.includes('rtw'));
    expect(rtw).toBeDefined();
    runToEnd(sim, incident.id);
    expect(sim.raw.shift.hilfsfristMeasured).toBe(0);
    expect(sim.raw.shift.fireMeasured).toBe(1);
  });
});

describe('Lageentwicklung beim Patienten', () => {
  it('lange Wartezeit kann den Zustand um eine NACA-Stufe verschlechtern', () => {
    let worsened = 0;
    for (let seed = 0; seed < 25; seed++) {
      const sim = newSim({ seed, callRateFactor: 0, tutorial: true });
      while (sim.raw.calls.length === 0) sim.step();
      const call = sim.raw.calls[0]!;
      const before = call.truth.naca;
      sim.submit({ type: 'call/accept', callId: call.id });
      sim.submit({
        type: 'incident/create',
        callId: call.id,
        addressId: call.truth.addressId,
        keywordId: 'base:rd1',
      });
      sim.flush();
      const incident = sim.raw.incidents[0]!;
      sim.run(35 * 60); // 35 Minuten ohne Alarmierung
      dispatchRecommended(sim, incident.id);
      for (let t = 0; t < 3600 && incident.firstArrivalAt === undefined; t++) sim.step();
      if (incident.truth.naca > before) worsened++;
    }
    expect(worsened).toBeGreaterThan(3);
  });
});
