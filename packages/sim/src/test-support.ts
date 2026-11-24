/**
 * Test-Hilfen: Basisinhalte laden und ein „Bot-Disponent", der fehlerfrei arbeitet.
 * Nur für Tests – wird nicht aus index.ts exportiert.
 */
import { join } from 'node:path';
import { loadContentFromDirs } from '@ls112/content/node';
import type { ContentBundle } from '@ls112/content';
import { Simulation, defaultConfig } from './simulation';
import { simTimeFrom } from './time';
import type { SimConfig } from './types';

let cached: ContentBundle | undefined;
export function baseContent(): ContentBundle {
  cached ??= loadContentFromDirs(join(import.meta.dirname, '..', '..', '..', 'content', 'base'));
  return cached;
}

export const SHIFT_START = simTimeFrom(2026, 11, 24, 7, 0, 0);

let testCached: ContentBundle | undefined;
/** Basisinhalte ohne vorbestellte Aufträge – Tests legen ihre Einsätze gezielt selbst an. */
export function testContent(): ContentBundle {
  const base = baseContent();
  testCached ??= {
    ...base,
    settings: { ...base.settings, transports: { ...base.settings.transports, preBooked: 0 } },
  };
  return testCached;
}

export function newSim(overrides: Partial<SimConfig> = {}): Simulation {
  return Simulation.create(
    defaultConfig({ seed: 1, startTime: SHIFT_START, ...overrides }),
    testContent(),
  );
}

export interface BotOptions {
  /** Adresse und Stichwort aus der Wahrheit (perfekter Disponent) statt aus der Meldung. */
  readonly cheat?: boolean;
  /** Zielklinik nicht zuweisen (Test des Timeouts). */
  readonly ignoreDestination?: boolean;
}

/** Diese Fragen stellt der Bot, bevor er entscheidet. */
const BOT_QUESTIONS = ['where', 'what', 'conscious', 'breathing'] as const;

/**
 * Ein Disponent, der seine Aufgaben zügig erledigt – mit denselben Regeln wie der Spieler:
 * ein Gespräch zur Zeit, erst fragen, dann entscheiden. Gibt die Zahl der Befehle zurück.
 */
export function botAct(sim: Simulation, options: BotOptions = {}): number {
  let n = 0;
  const s = sim.raw;
  const talking = s.calls.find((c) => c.status === 'talking');
  if (talking) {
    const missing = BOT_QUESTIONS.filter(
      (q) => !talking.answered.includes(q) && !talking.asked.includes(q),
    );
    const ready = BOT_QUESTIONS.every((q) => talking.answered.includes(q));
    if (options.cheat) {
      // Perfekter Disponent: erkennt die Art des Anrufs sofort.
      if (talking.kind === 'duplicate' && talking.duplicateOf !== undefined) {
        sim.submit({ type: 'call/link', callId: talking.id, incidentId: talking.duplicateOf });
      } else if (talking.kind !== 'emergency') {
        sim.submit({ type: 'call/close', callId: talking.id });
      } else {
        createFor(sim, talking, talking.truth.addressId);
      }
      n++;
    } else if (!ready) {
      for (const q of missing) sim.submit({ type: 'call/ask', callId: talking.id, question: q });
      n += missing.length;
    } else if (
      talking.kind === 'misdial' ||
      talking.kind === 'prank' ||
      talking.report.reportKey.startsWith('info_')
    ) {
      // Hörbar: Stille, Kichern oder eine Auskunftsfrage – kein Einsatz.
      sim.submit({ type: 'call/close', callId: talking.id });
      n++;
    } else {
      createFor(sim, talking, findReported(sim, talking.report));
      n++;
    }
  } else {
    const waiting = s.calls.find((c) => c.status === 'waiting');
    if (waiting) {
      sim.submit({ type: 'call/accept', callId: waiting.id });
      n++;
    }
  }
  for (const incident of s.incidents) {
    if (incident.status === 'closed') continue;
    // Aufträge erst kurz vor dem Termin und nur alle 30 Takte prüfen – wie ein Disponent, der
    // die Auftragsliste im Blick behält. Spart Routenberechnungen für wartende Aufträge.
    if (incident.order && (incident.order.dueAt - s.time > 45 * 60_000 || s.tick % 30 !== 0))
      continue;
    if (sim.missingNeeds(incident.id).length === 0) continue;
    const ids = sim
      .suggestVehicles(incident.id)
      .filter((x) => x.recommended)
      .map((x) => x.vehicleId);
    if (ids.length > 0) {
      sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: ids });
      n++;
    }
  }
  // Pausen genehmigt der Bot, sobald sie beantragt sind (das Fahrzeug ist dann frei).
  for (const v of s.vehicles) {
    if (v.breakRequestedAt !== undefined && v.incidentId === null && !v.service) {
      sim.submit({ type: 'vehicle/break', vehicleId: v.id });
      n++;
    }
  }
  if (!options.ignoreDestination) {
    for (const v of s.vehicles) {
      if (v.task === 'awaitDestination') {
        const h = sim.suggestHospitals(v.id)[0];
        if (h) {
          sim.submit({
            type: 'vehicle/assignDestination',
            vehicleId: v.id,
            hospitalId: h.hospitalId,
          });
          n++;
        }
      }
    }
  }
  sim.flush();
  return n;
}

function createFor(
  sim: Simulation,
  call: Simulation['raw']['calls'][number],
  addressId: number,
): void {
  const fire = call.truth.fire;
  const mci = call.truth.mci;
  const keywordId = mci
    ? sim.content.mciScenarios.get(mci.scenarioId)?.keyword
    : fire
      ? sim.content.fireScenarios.get(fire.scenarioId)?.keyword
      : sim.content.diagnoses.get(call.truth.diagnosisId)?.keyword;
  sim.submit({
    type: 'incident/create',
    callId: call.id,
    addressId,
    keywordId: keywordId ?? 'base:rd1',
  });
}

/** Adresse so suchen, wie ein Disponent es mit den Angaben des Anrufers täte. */
function findReported(sim: Simulation, r: Simulation['raw']['calls'][number]['report']): number {
  const match = sim.world.addresses.find(
    (a) =>
      a.streetId === r.streetId &&
      a.number === r.number &&
      (r.townId === null || a.townId === r.townId),
  );
  return match?.id ?? sim.world.addresses.find((a) => a.streetId === r.streetId)?.id ?? 0;
}
