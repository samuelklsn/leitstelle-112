import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Simulation, defaultConfig, replay } from './simulation';
import { MS_PER_HOUR, TICK_MS } from './time';
import { baseContent, botAct, newSim } from './test-support';
import type { FmsStatus, SimEvent, SimSnapshot, VehicleTask } from './types';
import { buildView, buildWorldInfo } from './view';

/** Spielt `ticks` Sekunden mit einem Bot, der nur in jedem `every`-ten Tick handelt. */
function playBot(sim: Simulation, ticks: number, every = 5, cheat = true): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    if (t % every === 0) botAct(sim, { cheat });
    events.push(...sim.step());
  }
  return events;
}

/** Erlaubte Zuordnung FMS-Status ↔ Aufgabe (Invariante des Zustandsautomaten). */
const STATUS_FOR_TASK: Record<VehicleTask, readonly FmsStatus[]> = {
  idle: [2, 1],
  turnout: [1, 2],
  toScene: [3],
  onScene: [4],
  awaitDestination: [5],
  toHospital: [7],
  handover: [8],
  returning: [1],
};

function checkInvariants(sim: Simulation): void {
  const s = sim.raw;
  for (const v of s.vehicles) {
    expect(STATUS_FOR_TASK[v.task]).toContain(v.status);
    if (v.incidentId !== null) {
      const incident = s.incidents.find((i) => i.id === v.incidentId);
      expect(incident?.vehicleIds).toContain(v.id);
      expect(incident?.status).not.toBe('closed');
    } else {
      expect(['idle', 'returning']).toContain(v.task);
    }
  }
  for (const i of s.incidents) {
    for (const id of i.vehicleIds)
      expect(s.vehicles.find((v) => v.id === id)?.incidentId).toBe(i.id);
    if (i.status === 'closed') expect(i.vehicleIds).toHaveLength(0);
  }
  const sh = s.shift;
  const open = s.calls.length;
  // Kein Notruf geht verloren (innerhalb einer Schicht).
  expect(sh.callsReceived).toBeGreaterThanOrEqual(sh.callsAccepted + sh.callsAbandoned);
  expect(sh.callsReceived - sh.callsAccepted - sh.callsAbandoned).toBe(
    s.calls.filter((c) => c.status === 'waiting').length,
  );
  expect(open).toBeGreaterThanOrEqual(0);
}

describe('Simulation – vollständiger Ablauf', () => {
  it('ein Notfall durchläuft den FMS-Zyklus bis zur Übergabe und Rückkehr', () => {
    const sim = newSim({ callRateFactor: 0, tutorial: true });
    const radio: { status: FmsStatus; msg: string }[] = [];
    let closed: SimEvent | undefined;
    for (let t = 0; t < 4 * 3600 && !closed; t++) {
      botAct(sim, { cheat: true });
      for (const e of sim.step()) {
        if (e.type === 'radio') radio.push({ status: e.status, msg: e.message });
        if (e.type === 'incident/closed') closed = e;
      }
      checkInvariants(sim);
    }
    expect(closed).toBeDefined();
    const statuses = radio.map((r) => r.status);
    expect(statuses).toContain(3);
    expect(statuses).toContain(4);
    expect(sim.raw.shift.incidents).toBe(1);
    expect(
      sim.raw.shift.hilfsfristMeasured + sim.raw.shift.outcomes.keinPatient,
    ).toBeGreaterThanOrEqual(1);
    // Alle Fahrzeuge kehren irgendwann auf die Wache zurück.
    sim.run(3600);
    expect(sim.raw.vehicles.every((v) => v.status === 2 && v.task === 'idle')).toBe(true);
  });

  it('ein Bot-Disponent bewältigt eine Schicht mit hoher Hilfsfrist-Quote und guten Outcomes', () => {
    const sim = newSim({ seed: 7 });
    playBot(sim, 6 * 3600, 3);
    const sh = sim.raw.shift;
    expect(sh.incidents).toBeGreaterThan(3);
    expect(sh.hilfsfristMeasured).toBeGreaterThan(0);
    expect(sh.hilfsfristMet / sh.hilfsfristMeasured).toBeGreaterThan(0.6);
    expect(sh.outcomes.gut).toBeGreaterThan(sh.outcomes.beeintraechtigt);
    expect(sh.errors.callAbandoned ?? 0).toBe(0);
    expect(sh.errors.wrongLocation ?? 0).toBe(0);
  });

  it('Invarianten gelten über viele Seeds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 1, max: 30 }),
        (seed, every) => {
          const sim = newSim({ seed, callRateFactor: 4 });
          for (let t = 0; t < 1800; t++) {
            if (t % every === 0) botAct(sim, { cheat: t % 2 === 0 });
            sim.step();
            if (t % 60 === 0) checkInvariants(sim);
          }
          checkInvariants(sim);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('falsche Adresse führt zu Rückruf, Fehler und Umleitung', () => {
    const sim = newSim({ callRateFactor: 0, tutorial: true });
    while (sim.raw.calls.length === 0) sim.step();
    const call = sim.raw.calls[0]!;
    sim.submit({ type: 'call/accept', callId: call.id });
    sim.flush();
    const truth = sim.world.addresses[call.truth.addressId]!;
    const far = sim.world.addresses.find(
      (a) => a.kind === 'house' && Math.abs(a.x - truth.x) + Math.abs(a.y - truth.y) > 3000,
    )!;
    sim.submit({
      type: 'incident/create',
      callId: call.id,
      addressId: far.id,
      keywordId: 'base:rd2',
    });
    sim.flush();
    const incident = sim.raw.incidents[0]!;
    const ids = sim
      .suggestVehicles(incident.id)
      .filter((s) => s.recommended)
      .map((s) => s.vehicleId);
    sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: ids });
    const events: SimEvent[] = [...sim.flush()];
    for (
      let t = 0;
      t < 3600 && !events.some((e) => e.type === 'radio' && e.message === 'locationFound');
      t++
    ) {
      events.push(...sim.step());
    }
    expect(events.some((e) => e.type === 'radio' && e.message === 'wrongLocation')).toBe(true);
    expect(events.some((e) => e.type === 'radio' && e.message === 'locationFound')).toBe(true);
    expect(sim.raw.incidents[0]?.errors).toContain('wrongLocation');
    expect(sim.raw.incidents[0]?.addressId).toBe(call.truth.addressId);
  });

  it('ohne Zielklinik-Zuweisung entscheidet die Besatzung selbst (mit Fehler)', () => {
    const sim = newSim({ seed: 3, callRateFactor: 3 });
    const events: SimEvent[] = [];
    for (
      let t = 0;
      t < 3 * 3600 && !events.some((e) => e.type === 'radio' && e.message === 'destinationSelf');
      t++
    ) {
      if (t % 5 === 0) botAct(sim, { cheat: true, ignoreDestination: true });
      events.push(...sim.step());
    }
    expect(events.some((e) => e.type === 'radio' && e.message === 'destinationSelf')).toBe(true);
    expect(sim.raw.shift.errors.destinationTimeout).toBeGreaterThan(0);
  });

  it('fordert den Notarzt nach, wenn ohne NEF alarmiert wurde und er gebraucht wird', () => {
    const sim = newSim({ seed: 11, callRateFactor: 4 });
    let requested = false;
    for (let t = 0; t < 4 * 3600 && !requested; t++) {
      // Disponent alarmiert immer nur RTW (RD 1) – unterschätzt also Notarztfälle.
      for (const call of sim.raw.calls) {
        sim.submit(
          call.status === 'waiting'
            ? { type: 'call/accept', callId: call.id }
            : {
                type: 'incident/create',
                callId: call.id,
                addressId: call.truth.addressId,
                keywordId: 'base:rd1',
              },
        );
      }
      for (const i of sim.raw.incidents) {
        if (i.status !== 'open' || i.doctorRequested) continue;
        const rtw = sim
          .suggestVehicles(i.id)
          .find((s) => s.recommended && s.vehicleId.includes('rtw'));
        if (rtw)
          sim.submit({ type: 'incident/dispatch', incidentId: i.id, vehicleIds: [rtw.vehicleId] });
      }
      sim.flush();
      for (const e of sim.step())
        if (e.type === 'radio' && e.message === 'requestDoctor') requested = true;
    }
    expect(requested).toBe(true);
    const incident = sim.raw.incidents.find((i) => i.doctorRequested)!;
    // Der Vorschlag enthält jetzt das NEF.
    expect(
      sim.suggestVehicles(incident.id).some((s) => s.recommended && s.vehicleId.includes('nef')),
    ).toBe(true);
  });

  it('lehnt ungültige Befehle mit Grund ab', () => {
    const sim = newSim();
    sim.submit({ type: 'call/accept', callId: 'N999' });
    sim.submit({ type: 'incident/dispatch', incidentId: 'E1', vehicleIds: [] });
    sim.submit({ type: 'vehicle/release', vehicleId: 'base:rtw-1-83-1' });
    const reasons = sim.flush().flatMap((e) => (e.type === 'command/rejected' ? [e.reason] : []));
    expect(reasons).toEqual(['unknownCall', 'unknownIncident', 'notReleasable']);
  });
});

describe('Simulation – Determinismus', () => {
  it('gleicher Seed + gleiche Befehle ⇒ gleicher Zustand', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 1, max: 20 }),
        (seed, every) => {
          const a = newSim({ seed, callRateFactor: 3 });
          const b = newSim({ seed, callRateFactor: 3 });
          playBot(a, 1200, every);
          playBot(b, 1200, every);
          expect(a.hash()).toBe(b.hash());
        },
      ),
      { numRuns: 10 },
    );
  });

  it('Snapshot + Wiederherstellung setzt bitgleich fort', () => {
    const original = newSim({ seed: 5, callRateFactor: 3 });
    playBot(original, 2400, 4);
    const restored = Simulation.restore(
      JSON.parse(JSON.stringify(original.snapshot())) as SimSnapshot,
      baseContent(),
    );
    expect(restored.hash()).toBe(original.hash());
    playBot(original, 2400, 4);
    playBot(restored, 2400, 4);
    expect(restored.hash()).toBe(original.hash());
  });

  it('Replay aus dem Befehlsprotokoll ergibt denselben Zustand', () => {
    const sim = newSim({ seed: 9, callRateFactor: 3 });
    playBot(sim, 3000, 7);
    const replayed = replay(sim.config, baseContent(), sim.commandLog(), sim.tick);
    expect(replayed.hash()).toBe(sim.hash());
  });

  it('verweigert Spielstände mit anderen Inhalten oder Versionen', () => {
    const snap = newSim().snapshot();
    expect(() => Simulation.restore({ ...snap, contentHash: 'x' }, baseContent())).toThrow(
      RangeError,
    );
    expect(() => Simulation.restore({ ...snap, version: 1 as 2 }, baseContent())).toThrow(
      RangeError,
    );
  });

  it('Golden-Replay: fester Seed ergibt festen Hash', () => {
    // Nur bewusst aktualisieren: `test(sim): update golden replays – <Grund>` (CLAUDE.md).
    const sim = newSim({ seed: 112 });
    playBot(sim, 2 * 3600, 10, false);
    const sh = sim.raw.shift;
    expect({ tick: sim.tick, hash: sim.hash(), calls: sh.callsReceived, incidents: sh.incidents })
      .toMatchInlineSnapshot(`
      {
        "calls": 8,
        "hash": "3c4e226ec6a12520",
        "incidents": 8,
        "tick": 7200,
      }
    `);
  });
});

describe('Simulation – Statistik', () => {
  it('trifft das erwartete Notrufaufkommen (± 15 %)', () => {
    const sim = newSim({ seed: 21, callRateFactor: 2 });
    const hours = 72;
    let calls = 0;
    for (let h = 0; h < hours; h++) {
      calls += sim.run(MS_PER_HOUR / TICK_MS).filter((e) => e.type === 'call/incoming').length;
      // Anrufe nicht annehmen → sie legen auf; das hält den Zustand klein.
    }
    const c = baseContent();
    const pop = c.region.towns.reduce((s, t) => s + t.population, 0);
    const meanProfile = c.settings.calls.hourlyProfile.reduce((a, b) => a + b, 0) / 24;
    const expected = ((c.settings.calls.ratePer100k * pop * 2) / 100_000) * meanProfile * hours;
    expect(Math.abs(calls - expected)).toBeLessThan(expected * 0.15);
  });

  it('Schichtwechsel nach 12 Stunden mit Auswertung', () => {
    const sim = newSim({ seed: 2 });
    const events = playBot(sim, 12 * 3600 + 5, 10);
    expect(events.some((e) => e.type === 'shift/ended')).toBe(true);
    expect(sim.raw.shiftHistory).toHaveLength(1);
    expect(sim.raw.shift.index).toBe(2);
    expect(Object.keys(sim.raw.shiftHistory[0]?.vehicleBusyMs ?? {})).toHaveLength(7);
  });
});

describe('Ansicht', () => {
  it('verrät die wahre Lage erst nach dem Erstbefund', () => {
    const sim = newSim({ seed: 4, callRateFactor: 3 });
    for (let t = 0; t < 2 * 3600; t++) {
      if (t % 5 === 0) botAct(sim, { cheat: true });
      sim.step();
      const view = buildView(sim);
      for (const i of view.incidents) {
        const raw = sim.raw.incidents.find((r) => r.id === i.id)!;
        expect(i.finding !== undefined).toBe(raw.assessed);
      }
      for (const c of view.calls) {
        expect(c.report !== undefined).toBe(c.status === 'talking');
        expect(JSON.stringify(c)).not.toContain('diagnosis');
      }
    }
  });

  it('Fahrzeuge bewegen sich stetig entlang ihrer Route', () => {
    const sim = newSim({ seed: 6, callRateFactor: 3 });
    let last = new Map<string, { x: number; y: number }>();
    let moved = 0;
    for (let t = 0; t < 3600; t++) {
      if (t % 5 === 0) botAct(sim, { cheat: true });
      sim.step();
      const now = new Map(buildView(sim).vehicles.map((v) => [v.id, v]));
      for (const [id, v] of now) {
        const p = last.get(id);
        if (p && v.moving) {
          // Höchstens ~60 m/s (über 200 km/h) zwischen zwei Sekunden – sonst springt etwas.
          expect(Math.hypot(v.x - p.x, v.y - p.y)).toBeLessThan(60);
          moved++;
        }
      }
      last = new Map([...now].map(([id, v]) => [id, { x: v.x, y: v.y }]));
    }
    expect(moved).toBeGreaterThan(100);
  });
});

describe('Konfiguration', () => {
  it('lehnt ungültige Werte ab', () => {
    expect(() => Simulation.create(defaultConfig({ seed: -1 }), baseContent())).toThrow(RangeError);
    expect(() => Simulation.create(defaultConfig({ callRateFactor: -1 }), baseContent())).toThrow(
      RangeError,
    );
  });

  it('startet mit allen Fahrzeugen in Status 2 auf ihrer Wache', () => {
    const sim = newSim();
    expect(sim.raw.vehicles).toHaveLength(7);
    expect(sim.raw.vehicles.every((v) => v.status === 2)).toBe(true);
  });
});

describe('Statische Weltdaten', () => {
  it('buildWorldInfo liefert alles, was die Oberfläche zum Nachschlagen braucht', () => {
    const sim = newSim();
    const info = buildWorldInfo(sim);
    expect(info.centerName).toBe('ILS Brakenfeld');
    expect(info.addresses).toHaveLength(sim.world.addresses.length);
    expect(info.addresses.some((a) => a.kind === 'road' && a.toTownId !== undefined)).toBe(true);
    expect(info.streets.length).toBe(sim.world.streets.length);
    expect(info.map.roads.features.length).toBe(sim.world.segments.length);
    expect(info.keywords.map((k) => k.code)).toEqual(['RD 1', 'RD 2', 'RD 3', 'RD 0']);
    expect(info.diagnoses.every((d) => d.name.length > 0)).toBe(true);
    // Keine verborgene Wahrheit in den statischen Daten.
    expect(JSON.stringify(info)).not.toContain('needsDoctor');
  });
});
