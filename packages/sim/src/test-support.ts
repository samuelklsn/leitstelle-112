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

export function newSim(overrides: Partial<SimConfig> = {}): Simulation {
  return Simulation.create(
    defaultConfig({ seed: 1, startTime: SHIFT_START, ...overrides }),
    baseContent(),
  );
}

export interface BotOptions {
  /** Adresse und Stichwort aus der Wahrheit (perfekter Disponent) statt aus der Meldung. */
  readonly cheat?: boolean;
  /** Zielklinik nicht zuweisen (Test des Timeouts). */
  readonly ignoreDestination?: boolean;
}

/** Ein Disponent, der alle Aufgaben sofort erledigt. Gibt die Zahl der Befehle zurück. */
export function botAct(sim: Simulation, options: BotOptions = {}): number {
  let n = 0;
  const s = sim.raw;
  for (const call of s.calls) {
    if (call.status === 'waiting') {
      sim.submit({ type: 'call/accept', callId: call.id });
      n++;
    } else {
      const d = sim.content.diagnoses.get(call.truth.diagnosisId);
      const addressId = options.cheat ? call.truth.addressId : findReported(sim, call.report);
      sim.submit({
        type: 'incident/create',
        callId: call.id,
        addressId,
        keywordId: d?.keyword ?? 'base:rd1',
      });
      n++;
    }
  }
  for (const incident of s.incidents) {
    if (incident.status === 'closed') continue;
    const ids = sim
      .suggestVehicles(incident.id)
      .filter((x) => x.recommended)
      .map((x) => x.vehicleId);
    if (ids.length > 0) {
      sim.submit({ type: 'incident/dispatch', incidentId: incident.id, vehicleIds: ids });
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
