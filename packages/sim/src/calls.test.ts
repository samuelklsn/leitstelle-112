import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Simulation } from './simulation';
import { createCall, isOutdoor } from './systems/calls';
import { botAct, newSim } from './test-support';
import { QUESTIONS, type CallKind, type SimEvent } from './types';
import { buildView } from './view';

/** Zugriff auf den internen Kontext für gezielte Szenarien (nur Tests). */
function ctxOf(sim: Simulation) {
  return (sim as unknown as { ctx: Parameters<typeof createCall>[0] }).ctx;
}

function ring(sim: Simulation, kind: CallKind) {
  const call = createCall(ctxOf(sim), kind);
  sim.submit({ type: 'call/accept', callId: call.id });
  sim.flush();
  return call;
}

describe('Notrufabfrage', () => {
  it('Antworten kommen erst nach einigen Sekunden und nacheinander', () => {
    const sim = newSim({ callRateFactor: 0 });
    const call = ring(sim, 'emergency');
    expect(buildView(sim).calls[0]?.report?.address).toBeUndefined();
    sim.submit({ type: 'call/ask', callId: call.id, question: 'where' });
    sim.submit({ type: 'call/ask', callId: call.id, question: 'what' });
    sim.flush();
    const answers: { q: string; at: number }[] = [];
    for (let t = 0; t < 60 && answers.length < 2; t++) {
      for (const e of sim.step())
        if (e.type === 'call/answer') answers.push({ q: e.question, at: e.at });
    }
    expect(answers.map((a) => a.q)).toEqual(['where', 'what']);
    const first = answers[0]!.at - (call.acceptedAt ?? 0);
    expect(first).toBeGreaterThanOrEqual(3000);
    expect(answers[1]!.at).toBeGreaterThan(answers[0]!.at);
    const view = buildView(sim).calls[0]!;
    expect(view.report?.address).toBeDefined();
    expect(view.report?.reportKey).toBeDefined();
    expect(view.report?.patient).toBeUndefined();
  });

  it('ein Disponent führt nur ein Gespräch gleichzeitig', () => {
    const sim = newSim({ callRateFactor: 0 });
    ring(sim, 'emergency');
    const second = createCall(ctxOf(sim), 'emergency');
    sim.submit({ type: 'call/accept', callId: second.id });
    const rejected = sim.flush().find((e) => e.type === 'command/rejected');
    expect(rejected?.type === 'command/rejected' && rejected.reason).toBe('lineBusy');
  });

  it('Übergaben der Polizei (110) kommen vollständig abgefragt', () => {
    const sim = newSim({ seed: 3, callRateFactor: 0 });
    let police;
    for (let i = 0; i < 400 && !police; i++) {
      const c = createCall(ctxOf(sim), 'emergency');
      if (c.source === '110') police = c;
    }
    if (!police) throw new Error('Keine Polizei-Übergabe erzeugt');
    expect(police.answered).toEqual([...QUESTIONS]);
    expect(isOutdoor(ctxOf(sim), police.truth)).toBe(true);
    expect(police.report.misjudge).toBe(0);
  });

  it('Fehlanrufe sind still, Scherzanrufe haben keine Rückrufnummer', () => {
    const sim = newSim({ callRateFactor: 0 });
    const misdial = ring(sim, 'misdial');
    const view = buildView(sim).calls.find((c) => c.id === misdial.id)!;
    expect(view.report?.silent).toBe(true);
    sim.submit({ type: 'call/close', callId: misdial.id });
    sim.flush();
    const prank = ring(sim, 'prank');
    expect(prank.report.callback).toBe('');
    expect(buildView(sim).calls[0]?.report?.giggling).toBe(true);
    expect(sim.raw.shift.errors.callClosedWithEmergency ?? 0).toBe(0);
  });
});

describe('Besondere Anrufe als Einsatz', () => {
  function runUntilClosed(sim: Simulation, incidentId: string): SimEvent[] {
    const events: SimEvent[] = [];
    for (let t = 0; t < 2 * 3600; t++) {
      events.push(...sim.step());
      if (sim.raw.incidents.find((i) => i.id === incidentId)?.status !== 'active' && t > 10) break;
    }
    return events;
  }

  it('Scherzanruf alarmiert: niemand vor Ort, Fehler und keine Hilfsfrist-Wertung', () => {
    const sim = newSim({ callRateFactor: 0 });
    const call = ring(sim, 'prank');
    sim.submit({
      type: 'incident/create',
      callId: call.id,
      addressId: call.truth.addressId,
      keywordId: 'base:rd2',
    });
    sim.flush();
    const incident = sim.raw.incidents[0]!;
    const ids = sim
      .suggestVehicles(incident.id)
      .filter((s) => s.recommended)
      .map((s) => s.vehicleId);
    sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: ids });
    sim.flush();
    const events = runUntilClosed(sim, incident.id);
    expect(events.some((e) => e.type === 'radio' && e.message === 'noPatient')).toBe(true);
    expect(sim.raw.shift.errors.prankDispatched).toBe(1);
    expect(sim.raw.shift.hilfsfristMeasured).toBe(0);
    expect(sim.raw.shift.outcomes.keinPatient).toBe(1);
  });

  it('Doppelmeldung: zuordnen ist richtig, ein zweiter Einsatz ist ein Fehler', () => {
    const sim = newSim({ callRateFactor: 0 });
    const first = ring(sim, 'emergency');
    sim.submit({
      type: 'incident/create',
      callId: first.id,
      addressId: first.truth.addressId,
      keywordId: 'base:rd1',
    });
    sim.flush();
    const original = sim.raw.incidents[0]!;

    const witness = ring(sim, 'duplicate');
    expect(witness.duplicateOf).toBe(original.id);
    expect(witness.truth.addressId).toBe(first.truth.addressId);
    sim.submit({ type: 'call/link', callId: witness.id, incidentId: original.id });
    expect(sim.flush().some((e) => e.type === 'call/linked')).toBe(true);
    expect(sim.raw.calls).toHaveLength(0);

    const again = ring(sim, 'duplicate');
    sim.submit({
      type: 'incident/create',
      callId: again.id,
      addressId: again.truth.addressId,
      keywordId: 'base:rd1',
    });
    sim.flush();
    const dup = sim.raw.incidents.find((i) => i.duplicateOf === original.id)!;
    const rtw = sim.suggestVehicles(dup.id).find((s) => s.recommended)!.vehicleId;
    sim.submit({ type: 'incident/dispatch', incidentId: dup.id, vehicleIds: [rtw] });
    sim.flush();
    const events = runUntilClosed(sim, dup.id);
    expect(events.some((e) => e.type === 'radio' && e.message === 'alreadyHandled')).toBe(true);
    expect(sim.raw.shift.errors.duplicateIncident).toBe(1);
  });

  it('aufgelegte Fehlanrufe zählen nicht als Fehler, aufgelegte Notrufe schon', () => {
    const sim = newSim({ callRateFactor: 0 });
    createCall(ctxOf(sim), 'misdial');
    createCall(ctxOf(sim), 'emergency');
    sim.run(200);
    expect(sim.raw.shift.callsAbandoned).toBe(2);
    expect(sim.raw.shift.errors.callAbandoned).toBe(1);
  });
});

describe('Anrufmix im Spiel', () => {
  it('alle Anrufarten kommen vor; ein ehrlicher Bot verliert keinen Notfall', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (seed) => {
        const sim = newSim({ seed, callRateFactor: 3 });
        const kinds = new Set<string>();
        for (let t = 0; t < 2 * 3600; t++) {
          for (const c of sim.raw.calls) kinds.add(c.kind);
          if (t % 2 === 0) botAct(sim);
          sim.step();
        }
        expect(kinds.has('emergency')).toBe(true);
        expect([...kinds].filter((k) => k !== 'emergency').length).toBeGreaterThanOrEqual(1);
        expect(sim.raw.shift.errors.callClosedWithEmergency ?? 0).toBe(0);
        expect(sim.raw.shift.errors.prankDispatched ?? 0).toBe(0);
      }),
      { numRuns: 2, seed: 112 },
    );
  });
});
