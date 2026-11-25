import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '@ls112/content';
import type { Ctx } from './context';
import { Simulation, defaultConfig } from './simulation';
import { areaFactor, careerAfterShift, requestVehicle } from './systems/career';
import { generateCalls } from './systems/calls';
import { SHIFT_START, botAct, testContent } from './test-support';
import { MS_PER_HOUR } from './time';
import type { ShiftStats, SimEvent } from './types';
import { buildView, buildWorldInfo } from './view';

function ctxOf(sim: Simulation): Ctx {
  return (sim as unknown as { ctx: Ctx }).ctx;
}

function withPersons(share: number): ContentBundle {
  const base = testContent();
  return {
    ...base,
    settings: { ...base.settings, persons: { ...base.settings.persons, share } },
  };
}

function sim(content = testContent(), seed = 1): Simulation {
  return Simulation.create(
    defaultConfig({ seed, startTime: SHIFT_START, callRateFactor: 0 }),
    content,
  );
}

function fakeShift(s: Simulation, busy: number, met: number, measured: number): ShiftStats {
  const shift: ShiftStats = {
    ...s.raw.shift,
    endedAt: s.raw.shift.startedAt + 12 * MS_PER_HOUR,
    hilfsfristMet: met,
    hilfsfristMeasured: measured,
    vehicleBusyMs: Object.fromEntries(s.raw.vehicles.map((v) => [v.id, busy * 12 * MS_PER_HOUR])),
  };
  s.raw.shiftHistory.push(shift);
  return shift;
}

describe('Laufbahn', () => {
  it('Schichtpunkte bringen Erfahrung und Budget, ab einer Schwelle die Beförderung', () => {
    const s = sim();
    const ctx = ctxOf(s);
    const events: SimEvent[] = [];
    const ctxWithEvents = { ...ctx, emit: (e: SimEvent) => events.push(e) } as Ctx;
    careerAfterShift(ctxWithEvents, { ...s.raw.shift, score: 1000 });
    expect(s.raw.career).toMatchObject({ rank: 0, xp: 1000, budget: 250, shifts: 1 });
    expect(areaFactor(ctx)).toBe(1);
    careerAfterShift(ctxWithEvents, { ...s.raw.shift, score: 2000 });
    expect(s.raw.career.rank).toBe(1);
    expect(areaFactor(ctx)).toBe(1.1);
    expect(events.some((e) => e.type === 'career/promoted')).toBe(true);
    // Negative Schichten kosten nichts – aber bringen auch nichts.
    careerAfterShift(ctxWithEvents, { ...s.raw.shift, score: -500 });
    expect(s.raw.career.xp).toBe(3000);
  });

  it('Schichtende schreibt die Laufbahn fort', () => {
    const s = Simulation.create(
      defaultConfig({ seed: 2, startTime: SHIFT_START, callRateFactor: 0.5 }),
      testContent(),
    );
    for (let t = 0; t < 12 * 3600 + 5; t++) {
      if (t % 10 === 0) botAct(s, { cheat: true });
      s.step();
    }
    expect(s.raw.career.shifts).toBe(1);
    expect(s.raw.career.xp).toBe(Math.max(0, s.raw.shiftHistory.at(-1)?.score ?? 0));
    expect(buildView(s).career.shifts).toBe(1);
  });
});

describe('Bedarfsplanung', () => {
  it('bewilligt mit Budget und Begründung, lehnt sonst ab', () => {
    const s = sim();
    const ctx = ctxOf(s);
    expect(requestVehicle(ctx, 'base:rw-tannrode', 'rtw')).toBe('noBudget');
    s.raw.career.budget = 5000;
    fakeShift(s, 0.1, 20, 20);
    expect(requestVehicle(ctx, 'base:rw-tannrode', 'rtw')).toBe('notJustified');
    expect(requestVehicle(ctx, 'base:fw-brakenfeld', 'rtw')).toBe('unknownStation');
    fakeShift(s, 0.6, 20, 20);
    const v = requestVehicle(ctx, 'base:rw-tannrode', 'rtwDay');
    expect(typeof v).toBe('object');
    expect(s.raw.career.budget).toBe(5000 - testContent().settings.career.costs.rtwDay);
    expect(s.raw.vehicles.some((x) => x.id === 'plan:rtwDay-1')).toBe(true);
    const station = buildWorldInfo(s).stations.find((x) => x.id === 'base:rw-tannrode');
    expect(station?.vehicles.some((x) => x.id === 'plan:rtwDay-1')).toBe(true);
    // Hilfsfrist verfehlt begründet ebenfalls.
    fakeShift(s, 0, 10, 20);
    expect(typeof requestVehicle(ctx, 'base:rw-ellerbach', 'nef')).toBe('object');
  });

  it('bewilligte Fahrzeuge überstehen Speichern und Laden und haben Dienstzeiten', () => {
    const s = sim();
    s.raw.career.budget = 5000;
    fakeShift(s, 0.6, 20, 20);
    s.submit({ type: 'planning/request', stationId: 'base:rw-tannrode', kind: 'rtwDay' });
    const events = s.flush();
    expect(events.some((e) => e.type === 'planning/approved')).toBe(true);
    const restored = Simulation.restore(s.snapshot(), testContent());
    expect(restored.raw.vehicles.find((v) => v.id === 'plan:rtwDay-1')).toBeDefined();
    // Um 20 Uhr endet der Dienst des Tages-RTW.
    restored.run(13 * 3600 + 60);
    expect(restored.raw.vehicles.find((v) => v.id === 'plan:rtwDay-1')?.status).toBe(6);
  });
});

describe('Wiederkehrende Personen und Adressen', () => {
  it('bekannte Personen rufen mit derselben Nummer an', () => {
    const s = sim(withPersons(1), 4);
    expect(s.raw.persons).toHaveLength(12);
    const ctx = ctxOf(s);
    // Rate hochsetzen: Jeder Tick bringt einen Anruf.
    for (let i = 0; i < 20 && s.raw.calls.length === 0; i++) {
      (ctx.config as { callRateFactor: number }).callRateFactor = 1000;
      generateCalls(ctx);
    }
    const call = s.raw.calls[0];
    const person = s.raw.persons.find((p) => p.id === call?.truth.personId);
    expect(person).toBeDefined();
    expect(call?.report.callback).toBe(person?.callback);
    expect(call?.truth.addressId).toBe(person?.addressId);
  });

  it('die Adresse merkt sich Einsätze; Gefahrenadressen verlangen die Polizei', () => {
    const s = sim(withPersons(1), 7);
    const ctx = ctxOf(s);
    const danger = s.raw.persons.find((p) => p.kind === 'danger');
    if (!danger) throw new Error('Keine Gefahrenadresse');
    const runOne = (police: boolean): SimEvent[] => {
      (ctx.config as { callRateFactor: number }).callRateFactor = 1000;
      // Nur diese Person ruft an.
      s.raw.persons.splice(0, s.raw.persons.length, danger);
      while (s.raw.calls.length === 0) generateCalls(ctx);
      (ctx.config as { callRateFactor: number }).callRateFactor = 0;
      const events: SimEvent[] = [];
      for (let t = 0; t < 4 * 3600 && s.raw.incidents.every((i) => i.status !== 'closed'); t++) {
        if (t % 3 === 0) botAct(s, { cheat: true });
        const created = s.raw.incidents.find((i) => i.status !== 'closed');
        if (police && created && !created.policeRequested) {
          s.submit({ type: 'incident/police', incidentId: created.id });
          s.flush();
        }
        events.push(...s.step());
      }
      return events;
    };
    const first = runOne(false);
    expect(first.some((e) => e.type === 'radio' && e.message === 'waitingForPolice')).toBe(true);
    const history = s.raw.addressHistory[danger.addressId.toString()];
    expect(history?.count).toBe(1);
    expect(history?.flags).toContain('danger');
    // Beim ersten Mal war die Gefahr unbekannt – kein Fehler.
    expect(s.raw.shift.errors.policeNotRequested ?? 0).toBe(0);
    // Ein zweiter Einsatz an der Adresse: jetzt bekannt, ohne Polizei ein Fehler.
    s.raw.incidents.splice(0);
    runOne(false);
    expect(s.raw.shift.errors.policeNotRequested ?? 0).toBe(1);
  });
});
