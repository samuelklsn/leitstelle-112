import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@ls112/content';
import type { Ctx } from './context';
import { Simulation, defaultConfig } from './simulation';
import { createCall } from './systems/calls';
import { createOrder, isDepartmentOpen } from './systems/logistics';
import { SHIFT_START, baseContent, botAct, newSim, testContent } from './test-support';
import { MS_PER_HOUR, MS_PER_MINUTE } from './time';
import type { IncidentState, SimEvent, VehicleState } from './types';

function ctxOf(sim: Simulation): Ctx {
  return (sim as unknown as { ctx: Ctx }).ctx;
}

function vehicle(sim: Simulation, id: string): VehicleState {
  const v = sim.raw.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`Fahrzeug ${id} fehlt`);
  return v;
}

/** Läuft, bis die Bedingung erfüllt ist; sammelt die Ereignisse. */
function runUntil(sim: Simulation, done: () => boolean, maxTicks = 6 * 3600): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < maxTicks && !done(); t++) events.push(...sim.step());
  return events;
}

function dispatchRecommended(sim: Simulation, incident: IncidentState): string[] {
  const ids = sim
    .suggestVehicles(incident.id)
    .filter((s) => s.recommended)
    .map((s) => s.vehicleId);
  sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: ids });
  sim.flush();
  return ids;
}

/** Inhalte mit geänderten Logistik-Einstellungen (z. B. Defekt immer). */
function withLogistics(patch: Partial<ContentBundle['settings']['logistics']>): ContentBundle {
  const base = testContent();
  return {
    ...base,
    settings: { ...base.settings, logistics: { ...base.settings.logistics, ...patch } },
  };
}

const quiet = { callRateFactor: 0 } as const;

/** Notruf mit Patient (keine Feuerwehrlage), angenommen und als Einsatz angelegt. */
function emergency(
  sim: Simulation,
  keywordId: string,
  accept: (diagnosisId: string) => boolean = () => true,
): IncidentState {
  const ctx = ctxOf(sim);
  let call = createCall(ctx, 'emergency');
  for (let i = 0; i < 500 && (call.truth.fire || !accept(call.truth.diagnosisId)); i++) {
    sim.raw.calls.splice(0);
    call = createCall(ctx, 'emergency');
  }
  if (call.truth.fire || !accept(call.truth.diagnosisId)) throw new Error('Kein passender Notruf');
  (call.truth as { transport: boolean }).transport = true;
  sim.submit({ type: 'call/accept', callId: call.id });
  sim.submit({
    type: 'incident/create',
    callId: call.id,
    addressId: call.truth.addressId,
    keywordId,
  });
  sim.flush();
  const incident = sim.raw.incidents.at(-1);
  if (!incident) throw new Error('Kein Einsatz');
  return incident;
}

describe('Transportaufträge', () => {
  it('KTW holt zum Termin ab und bringt den Patienten in die Klinik', () => {
    const sim = newSim(quiet);
    const order = createOrder(ctxOf(sim), 'base:einweisung');
    expect(order.order?.toHospitalId).toBeDefined();
    expect((order.order?.dueAt ?? 0) % (5 * MS_PER_MINUTE)).toBe(0);
    const ids = dispatchRecommended(sim, order);
    expect(ids).toHaveLength(1);
    expect(vehicle(sim, ids[0] ?? '').typeId).toBe('base:ktw');
    const events = runUntil(sim, () => order.status === 'closed');
    expect(order.status).toBe('closed');
    expect(order.outcome).toBe('gut');
    expect(order.errors).toEqual([]);
    // Wer zu früh kommt, wartet: Abfahrt erst nach dem Termin plus Übernahmezeit.
    expect(order.order?.pickedUpAt).toBeGreaterThanOrEqual(order.order?.dueAt ?? 0);
    expect(events.some((e) => e.type === 'radio' && e.message === 'patientPickedUp')).toBe(true);
    expect(sim.raw.shift.ordersOnTime).toBe(1);
    // Kein Notfall: keine Hilfsfrist, kein Patienten-Outcome.
    expect(sim.raw.shift.hilfsfristMeasured).toBe(0);
    expect(sim.raw.shift.outcomes.gut).toBe(0);
  });

  it('Entlassung endet an der Wohnadresse', () => {
    const sim = newSim(quiet);
    const order = createOrder(ctxOf(sim), 'base:entlassung');
    expect(order.order?.fromHospitalId).toBeDefined();
    expect(order.order?.toAddressId).toBeDefined();
    dispatchRecommended(sim, order);
    runUntil(sim, () => order.status === 'closed');
    expect(order.outcome).toBe('gut');
  });

  it('zu späte Abholung ist ein Fehler, liegengebliebene Aufträge werden storniert', () => {
    const sim = newSim(quiet);
    const late = createOrder(ctxOf(sim), 'base:verlegung-herz');
    const forgotten = createOrder(ctxOf(sim), 'base:ambulant');
    runUntil(sim, () => sim.time > (late.order?.dueAt ?? 0) + 30 * MS_PER_MINUTE);
    dispatchRecommended(sim, late);
    runUntil(sim, () => late.status === 'closed' && forgotten.status === 'closed', 8 * 3600);
    expect(late.errors).toContain('transportLate');
    expect(late.outcome).toBe('beeintraechtigt');
    expect(forgotten.errors).toEqual(['transportLate']);
    expect(forgotten.firstArrivalAt).toBeUndefined();
    expect(sim.raw.shift.ordersDone).toBe(2);
    expect(sim.raw.shift.ordersOnTime).toBe(0);
  });

  it('ein KTW für eine Verlegung mit Überwachung ist ungeeignet, ein RTW für KTP nicht', () => {
    const sim = newSim(quiet);
    const vl = createOrder(ctxOf(sim), 'base:verlegung-herz');
    sim.submit({ type: 'incident/dispatch', incidentId: vl.id, vehicleIds: ['base:ktw-2-85-1'] });
    const ktp = createOrder(ctxOf(sim), 'base:einweisung');
    sim.submit({ type: 'incident/dispatch', incidentId: ktp.id, vehicleIds: ['base:rtw-3-83-1'] });
    sim.flush();
    runUntil(sim, () => vl.status === 'closed' && ktp.status === 'closed');
    expect(vl.errors).toContain('unsuitableTransport');
    expect(ktp.errors).not.toContain('unsuitableTransport');
  });

  it('am Vortag bestellte Aufträge stehen zum Schichtbeginn in der Liste', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 3, startTime: SHIFT_START, callRateFactor: 0 }),
      baseContent(),
    );
    const orders = sim.raw.incidents.filter((i) => i.order);
    expect(orders).toHaveLength(baseContent().settings.transports.preBooked);
    for (const o of orders) {
      expect(o.order?.dueAt).toBeGreaterThan(SHIFT_START + 15 * MS_PER_MINUTE);
      expect(o.order?.dueAt).toBeLessThanOrEqual(SHIFT_START + 185 * MS_PER_MINUTE);
    }
    const tutorial = Simulation.create(
      defaultConfig({ seed: 3, startTime: SHIFT_START, tutorial: true }),
      baseContent(),
    );
    expect(tutorial.raw.incidents).toHaveLength(0);
  });

  it('kommen tagsüber regelmäßig, nachts kaum', () => {
    const sim = newSim({ callRateFactor: 1 });
    sim.run(4 * 3600);
    expect(sim.raw.shift.ordersReceived).toBeGreaterThanOrEqual(2);
    expect(sim.raw.incidents.some((i) => i.order)).toBe(true);
  });
});

describe('Kliniken', () => {
  it('melden sich ab, wenn die Abteilung voll ist; der Vorschlag umgeht sie', () => {
    const sim = newSim(quiet);
    const ctx = ctxOf(sim);
    const h = sim.raw.hospitals['base:kk-brakenfeld'];
    const other = sim.raw.hospitals['base:kl-ellerbach'];
    if (!h || !other) throw new Error('Klinikzustand fehlt');
    // Geräteausfall im Klinikum; Ellerbach hat Platz.
    h.closedUntil.chirurgie = SHIFT_START + 24 * MS_PER_HOUR;
    other.free.chirurgie = 3;
    expect(isDepartmentOpen(ctx, 'base:kk-brakenfeld', 'chirurgie')).toBe(false);
    expect(isDepartmentOpen(ctx, 'base:kk-brakenfeld', 'innere')).toBe(true);

    // Akutes Abdomen (Chirurgie) – bis zur Zielklinik-Anfrage spielen.
    const incident = emergency(sim, 'base:rd1', (d) => d === 'base:abdominal');
    dispatchRecommended(sim, incident);
    runUntil(sim, () => sim.raw.vehicles.some((v) => v.task === 'awaitDestination'));
    const rtw = sim.raw.vehicles.find((v) => v.task === 'awaitDestination');
    if (!rtw) throw new Error('Kein Transport');
    const list = sim.suggestHospitals(rtw.id);
    const kk = list.find((x) => x.hospitalId === 'base:kk-brakenfeld');
    expect(kk?.open).toBe(false);
    expect(list[0]?.hospitalId).toBe('base:kl-ellerbach');
    // Trotzdem ins abgemeldete Klinikum (sofern kein vitaler Patient) → Fehler.
    incident.truth.naca = 3;
    sim.submit({
      type: 'vehicle/assignDestination',
      vehicleId: rtw.id,
      hospitalId: 'base:kk-brakenfeld',
    });
    sim.flush();
    expect(incident.errors).toContain('hospitalClosed');
  });

  it('Belegung und Abmeldungen ändern sich im Laufe des Tages', () => {
    const sim = newSim(quiet);
    const events = sim.run(24 * 3600);
    const status = events.filter((e) => e.type === 'hospital/status');
    expect(status.length).toBeGreaterThan(0);
    for (const h of baseContent().hospitals) {
      const s = sim.raw.hospitals[h.id];
      for (const [dept, cap] of Object.entries(h.beds)) {
        const free = s?.free[dept] ?? -1;
        expect(free).toBeGreaterThanOrEqual(0);
        expect(free).toBeLessThanOrEqual(cap);
      }
    }
  });
});

describe('Fahrzeuge und Besatzungen', () => {
  it('Fahrzeuge mit Dienstzeiten beginnen und beenden ihren Dienst', () => {
    const sim = newSim(quiet);
    const ktw = vehicle(sim, 'base:ktw-1-85-2');
    expect(ktw.status).toBe(6);
    const events = runUntil(sim, () => sim.time >= SHIFT_START + MS_PER_HOUR);
    expect(ktw.status).toBe(2);
    expect(events.some((e) => e.type === 'radio' && e.message === 'onDuty')).toBe(true);
    runUntil(sim, () => sim.time >= SHIFT_START + 9 * MS_PER_HOUR, 10 * 3600);
    expect(ktw.status).toBe(6);
    expect(ktw.service?.reason).toBe('offDuty');
  });

  it('Pause: nach sechs Stunden beantragt, genehmigt, danach wieder frei', () => {
    const sim = newSim(quiet);
    const rtw = vehicle(sim, 'base:rtw-3-83-1');
    const events = runUntil(sim, () => rtw.breakRequestedAt !== undefined, 7 * 3600);
    expect(sim.time - SHIFT_START).toBe(6 * MS_PER_HOUR);
    expect(events.some((e) => e.type === 'radio' && e.message === 'requestBreak')).toBe(true);
    sim.submit({ type: 'vehicle/break', vehicleId: rtw.id });
    sim.flush();
    expect(rtw.status).toBe(6);
    expect(rtw.service?.reason).toBe('break');
    runUntil(sim, () => rtw.status === 2, 3600);
    expect(rtw.breakTakenMs).toBe(30 * MS_PER_MINUTE);
    // Schichtwechsel um 19 Uhr: Diese Besatzung hatte ihre Pause.
    runUntil(sim, () => sim.time >= SHIFT_START + 12 * MS_PER_HOUR, 7 * 3600);
    expect(rtw.crewSince).toBe(SHIFT_START + 12 * MS_PER_HOUR);
  });

  it('ohne Pause bis zum Schichtende ist ein Arbeitszeitverstoß', () => {
    const sim = newSim(quiet);
    sim.run(12 * 3600 + 60);
    // Alle 24-Stunden-Besatzungen des Rettungsdienstes und die KTW mit langem Dienst.
    expect(sim.raw.shift.errors.breakMissed ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('Pause vorzeitig beenden macht das Fahrzeug sofort verfügbar', () => {
    const sim = newSim(quiet);
    const rtw = vehicle(sim, 'base:rtw-2-83-1');
    runUntil(sim, () => rtw.breakRequestedAt !== undefined, 7 * 3600);
    sim.submit({ type: 'vehicle/break', vehicleId: rtw.id });
    sim.flush();
    sim.run(600);
    sim.submit({ type: 'vehicle/resume', vehicleId: rtw.id });
    const events = sim.flush();
    expect(rtw.status).toBe(2);
    expect(rtw.breakTakenMs).toBe(10 * MS_PER_MINUTE);
    expect(events.some((e) => e.type === 'radio' && e.message === 'breakEnd')).toBe(true);
    sim.submit({ type: 'vehicle/resume', vehicleId: rtw.id });
    const rejected = sim.flush().find((e) => e.type === 'command/rejected');
    expect(rejected?.type === 'command/rejected' && rejected.reason).toBe('notOnBreak');
  });

  it('nach einem Infektionstransport wird desinfiziert', () => {
    const sim = newSim(quiet);
    const order = createOrder(ctxOf(sim), 'base:einweisung');
    (order.truth as { infectious: boolean }).infectious = true;
    const [id] = dispatchRecommended(sim, order);
    const ktw = vehicle(sim, id ?? '');
    const events = runUntil(sim, () => ktw.service?.reason === 'disinfection');
    expect(ktw.status).toBe(6);
    expect(events.some((e) => e.type === 'radio' && e.message === 'disinfection')).toBe(true);
    runUntil(sim, () => ktw.status === 2, 3 * 3600);
    expect(ktw.service).toBeUndefined();
    expect(ktw.node).toBe(ktw.homeNode);
  });

  it('wenig Kraftstoff: nach dem Einsatz tanken', () => {
    const sim = newSim(quiet);
    const order = createOrder(ctxOf(sim), 'base:einweisung');
    const [id] = dispatchRecommended(sim, order);
    const ktw = vehicle(sim, id ?? '');
    ktw.fuel = 0.1;
    runUntil(sim, () => ktw.service?.reason === 'refuel');
    runUntil(sim, () => ktw.status === 2, 3 * 3600);
    expect(ktw.fuel).toBe(1);
  });

  it('Defekte schicken Fahrzeuge in die Werkstatt', () => {
    const sim = Simulation.create(
      defaultConfig({ seed: 1, startTime: SHIFT_START, callRateFactor: 0 }),
      withLogistics({ defectPerMission: 1 }),
    );
    const order = createOrder(ctxOf(sim), 'base:einweisung');
    const [id] = dispatchRecommended(sim, order);
    const ktw = vehicle(sim, id ?? '');
    runUntil(sim, () => ktw.service?.reason === 'defect');
    expect(ktw.status).toBe(6);
    runUntil(sim, () => ktw.status === 2, 5 * 3600);
    expect(ktw.service).toBeUndefined();
  });

  it('KTW am Notfallort zählt nicht für die Hilfsfrist und transportiert nicht', () => {
    const sim = newSim(quiet);
    const incident = emergency(sim, 'base:rd1');
    sim.submit({
      type: 'incident/dispatch',
      incidentId: incident.id,
      vehicleIds: ['base:ktw-1-85-1'],
    });
    sim.flush();
    runUntil(sim, () => vehicle(sim, 'base:ktw-1-85-1').task === 'onScene');
    expect(incident.firstArrivalAt).toBeUndefined();
    // Der Vorschlag verlangt weiter einen RTW.
    const rec = sim.suggestVehicles(incident.id).filter((s) => s.recommended);
    expect(rec.map((s) => vehicle(sim, s.vehicleId).typeId)).toEqual(['base:rtw']);
  });

  it('ein NAW deckt Transport und Notarzt zugleich', () => {
    const base = testContent();
    const content: ContentBundle = {
      ...base,
      stations: base.stations.map((s) => ({
        ...s,
        vehicles: s.vehicles.map((v) =>
          v.id === 'base:rtw-3-83-1' ? { ...v, type: 'base:naw' } : v,
        ),
      })),
    };
    const sim = Simulation.create(
      defaultConfig({ seed: 4, startTime: SHIFT_START, callRateFactor: 0 }),
      content,
    );
    const naw = vehicle(sim, 'base:rtw-3-83-1');
    const incident = emergency(sim, 'base:rd2');
    (incident.truth as { needsDoctor: boolean }).needsDoctor = true;
    sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: [naw.id] });
    sim.flush();
    runUntil(sim, () => incident.assessed, 3600);
    expect(incident.doctorArrivalAt).toBe(incident.firstArrivalAt);
    expect(sim.missingNeeds(incident.id)).toEqual([]);
  });
});

describe('Logistik im Dauerbetrieb', () => {
  it('Invarianten halten über einen ganzen Tag mit Bot-Disponent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (seed) => {
        const sim = newSim({ seed, callRateFactor: 1.5 });
        for (let t = 0; t < 24 * 3600; t++) {
          if (t % 5 === 0) botAct(sim, { cheat: true });
          sim.step();
          if (t % 600 !== 0) continue;
          for (const v of sim.raw.vehicles) {
            expect(v.fuel).toBeGreaterThanOrEqual(0);
            expect(v.fuel).toBeLessThanOrEqual(1);
            if (v.status === 6) expect(['service', 'toService']).toContain(v.task);
            if (v.task === 'service' || v.task === 'toService') expect(v.service).toBeDefined();
            if (v.service) expect(v.incidentId).toBeNull();
          }
        }
        const sh = sim.raw.shiftHistory.at(-1) ?? sim.raw.shift;
        expect(sh.ordersReceived).toBeGreaterThan(0);
        // Der Bot genehmigt jede Pause: keine Verstöße außer am Spielbeginn.
        expect(sim.raw.shift.errors.breakMissed ?? 0).toBe(0);
      }),
      { numRuns: 1, seed: 7 },
    );
  });
});
