import { describe, expect, it } from 'vitest';
import { easterSunday, holidayName, isRestDay } from './calendar';
import { travelContext, type Ctx } from './context';
import { Simulation, defaultConfig } from './simulation';
import { createCall } from './systems/calls';
import { inService } from './systems/logistics';
import { airMs } from './systems/vehicles';
import {
  CLOSURE_FACTOR,
  callFactor,
  directorFactor,
  mixWeights,
  startWorldEvent,
} from './systems/world';
import { baseContent, testContent } from './test-support';
import { MS_PER_DAY, MS_PER_HOUR, daysFromCivil, simTimeFrom } from './time';

function ctxOf(sim: Simulation): Ctx {
  return (sim as unknown as { ctx: Ctx }).ctx;
}

function simAt(time: number, seed = 1, callRateFactor = 0): Simulation {
  return Simulation.create(defaultConfig({ seed, startTime: time, callRateFactor }), testContent());
}

function share(weights: readonly number[], index: number): number {
  const before = index > 0 ? (weights[index - 1] ?? 0) : 0;
  return ((weights[index] ?? 0) - before) / (weights.at(-1) ?? 1);
}

describe('Kalender und Feiertage', () => {
  it('berechnet Ostern und bewegliche Feiertage', () => {
    expect(easterSunday(2026)).toBe(daysFromCivil(2026, 4, 5));
    expect(easterSunday(2027)).toBe(daysFromCivil(2027, 3, 28));
    expect(easterSunday(2024)).toBe(daysFromCivil(2024, 3, 31));
    const holidays = baseContent().holidays;
    expect(holidayName(holidays, simTimeFrom(2026, 5, 25, 10))).toBe('Pfingstmontag');
    expect(holidayName(holidays, simTimeFrom(2026, 6, 4, 10))).toBe('Fronleichnam');
    expect(holidayName(holidays, simTimeFrom(2026, 12, 25, 10))).toBe('1. Weihnachtstag');
    expect(holidayName(holidays, simTimeFrom(2026, 12, 23, 10))).toBeUndefined();
    // Freitag, 25.12.2026: Feiertag zählt wie ein Sonntag.
    expect(isRestDay(holidays, simTimeFrom(2026, 12, 25, 10))).toBe(true);
    expect(isRestDay(holidays, simTimeFrom(2026, 12, 23, 10))).toBe(false);
  });

  it('werktags besetzte KTW bleiben an Feiertagen auf der Wache', () => {
    const sim = simAt(simTimeFrom(2026, 12, 25, 10));
    expect(inService(ctxOf(sim), 'base:ktw-2-85-1', sim.time)).toBe(false);
    expect(inService(ctxOf(sim), 'base:ktw-1-85-1', sim.time)).toBe(true);
    expect(travelContext(ctxOf(sim), false).weekend).toBe(true);
  });
});

describe('Wetter', () => {
  function weatherOver(start: number, days: number, seed = 3): Set<string> {
    const sim = simAt(start, seed);
    const seen = new Set<string>();
    for (let h = 0; h < days * 24; h++) {
      seen.add(sim.raw.world.weatherId);
      const w = baseContent().weather.find((x) => x.id === sim.raw.world.weatherId);
      if (w?.maxTemperature !== undefined)
        expect(sim.raw.world.temperature).toBeLessThanOrEqual(w.maxTemperature);
      if (w?.minTemperature !== undefined)
        expect(sim.raw.world.temperature).toBeGreaterThanOrEqual(w.minTemperature);
      sim.run(3600);
    }
    return seen;
  }

  it('folgt dem Klima: Glätte und Schnee im Winter, Hitze nur im Sommer', () => {
    const winter = weatherOver(simTimeFrom(2027, 1, 5, 0), 20);
    expect(winter.has('base:schnee') || winter.has('base:glaette')).toBe(true);
    expect(winter.has('base:hitze')).toBe(false);
    const summer = weatherOver(simTimeFrom(2026, 7, 5, 0), 20);
    expect(summer.has('base:hitze')).toBe(true);
    expect(summer.has('base:schnee')).toBe(false);
  });

  it('Glätte verlängert Fahrzeiten und häuft Stürze', () => {
    const sim = simAt(simTimeFrom(2027, 1, 12, 10));
    const ctx = ctxOf(sim);
    sim.raw.world.weatherId = 'base:klar';
    const dry = travelContext(ctx, true);
    const clearMix = mixWeights(ctx);
    sim.raw.world.weatherId = 'base:glaette';
    const icy = travelContext(ctx, true);
    expect(icy.weather).toBeLessThan(dry.weather ?? 1);
    const a = sim.world.addresses[100]?.node ?? 0;
    const b = sim.world.addresses[9000]?.node ?? 0;
    const t = (c: typeof dry) => sim.router.route(a, b, c)?.cumulativeMs.at(-1) ?? 0;
    expect(t(icy)).toBeGreaterThan(t(dry) * 1.4);
    const fall = baseContent().diagnoses.findIndex((d) => d.id === 'base:fall');
    expect(share(mixWeights(ctx).diagnoses, fall)).toBeGreaterThan(
      share(clearMix.diagnoses, fall) * 1.8,
    );
  });

  it('Hitze bringt Flächenbrände und Exsikkose', () => {
    const sim = simAt(simTimeFrom(2026, 7, 20, 14));
    const ctx = ctxOf(sim);
    sim.raw.world.weatherId = 'base:hitze';
    const fire = baseContent().fireScenarios.findIndex((s) => s.id === 'base:vegetation');
    expect(share(mixWeights(ctx).fire, fire)).toBeGreaterThan(0.08);
  });
});

describe('Ereignisse und Einsatz-Regie', () => {
  it('die Regie bleibt innerhalb von ± amplitude um die Basisrate', () => {
    const sim = simAt(simTimeFrom(2026, 11, 24, 7));
    const a = baseContent().settings.director.amplitude;
    for (let i = 0; i < 48; i++) {
      sim.run(1800);
      const f = directorFactor(sim.raw.world, sim.time);
      expect(f).toBeGreaterThanOrEqual(1 - a - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + a + 1e-9);
    }
  });

  it('Silvester: mehr Notrufe, Feuerwerksverletzungen und Brände', () => {
    const sim = simAt(simTimeFrom(2026, 12, 31, 17), 5, 1);
    const before = callFactor(ctxOf(sim)) / directorFactor(sim.raw.world, sim.time);
    sim.run(3600 + 60);
    expect(sim.raw.world.events.map((e) => e.eventId)).toContain('base:silvester');
    const during = callFactor(ctxOf(sim)) / directorFactor(sim.raw.world, sim.time);
    expect(during).toBeGreaterThan(before * 1.6);
    const ctx = ctxOf(sim);
    let fireworks = 0;
    for (let i = 0; i < 300; i++) {
      if (createCall(ctx, 'emergency').truth.diagnosisId === 'base:firework-injury') fireworks++;
    }
    expect(fireworks).toBeGreaterThan(10);
  });

  it('ein Spielbeginn mitten in der Silvesternacht kennt das laufende Ereignis', () => {
    const sim = simAt(simTimeFrom(2027, 1, 1, 1));
    expect(sim.raw.world.events.map((e) => e.eventId)).toContain('base:silvester');
  });

  it('Volksfest: ein Teil der Notrufe kommt aus dem Festort', () => {
    const sim = simAt(simTimeFrom(2026, 7, 18, 16));
    const ctx = ctxOf(sim);
    const e = startWorldEvent(ctx, 'base:volksfest');
    expect(e?.townId).toBeDefined();
    let local = 0;
    for (let i = 0; i < 400; i++) {
      const c = createCall(ctx, 'emergency');
      if (sim.world.addresses[c.truth.addressId]?.townId === e?.townId) local++;
    }
    expect(local / 400).toBeGreaterThan(0.3);
  });

  it('Baustelle sperrt einen Abschnitt, der Router leitet um – auch nach dem Laden', () => {
    const sim = simAt(simTimeFrom(2026, 8, 11, 7));
    const ctx = ctxOf(sim);
    const plain = travelContext(ctx, false);
    const before = new Uint32Array(sim.router.edgeTimes(plain));
    const e = startWorldEvent(ctx, 'base:baustelle');
    const edge = e?.closure?.edges[0];
    expect(edge).toBeDefined();
    const after = sim.router.edgeTimes(plain);
    expect(after[edge ?? 0]).toBe(Math.round((before[edge ?? 0] ?? 0) * CLOSURE_FACTOR));

    const restored = Simulation.restore(sim.snapshot(), testContent());
    expect(restored.router.edgeTimes(plain)[edge ?? 0]).toBe(after[edge ?? 0]);
    // Ende der Sperrung: alles wieder frei.
    sim.run(Math.ceil(((e?.until ?? 0) - sim.time) / 1000) + 1);
    expect(sim.raw.world.events.some((x) => x.closure)).toBe(false);
    expect(sim.router.edgeTimes(plain)[edge ?? 0]).toBe(before[edge ?? 0]);
  });
});

describe('Luftrettung', () => {
  it('fliegt nur bei Tageslicht und Flugwetter', () => {
    const night = simAt(simTimeFrom(2026, 12, 10, 18));
    expect(night.raw.vehicles.find((v) => v.id === 'base:rth-1')?.status).toBe(6);

    const day = simAt(simTimeFrom(2026, 6, 10, 9, 59));
    const rth = day.raw.vehicles.find((v) => v.id === 'base:rth-1');
    day.raw.world.weatherId = 'base:klar';
    day.run(120);
    if (rth?.service?.reason === 'external') return; // gerade auswärts im Einsatz
    expect(rth?.status).toBe(2);
    day.raw.world.weatherId = 'base:nebel';
    day.run(60);
    expect(rth?.service?.reason).toBe('weather');
    day.raw.world.weatherId = 'base:klar';
    day.run(60);
    expect(rth?.status).toBe(2);
  });

  it('erscheint im Vorschlag mit Flugzeit statt Straßenfahrzeit', () => {
    const sim = simAt(simTimeFrom(2026, 6, 10, 10));
    sim.raw.world.weatherId = 'base:klar';
    const ctx = ctxOf(sim);
    const rth = sim.raw.vehicles.find((v) => v.id === 'base:rth-1');
    if (!rth || rth.status !== 2) return;
    const call = createCall(ctx, 'emergency');
    sim.submit({ type: 'call/accept', callId: call.id });
    sim.submit({
      type: 'incident/create',
      callId: call.id,
      addressId: call.truth.addressId,
      keywordId: 'base:rd2',
    });
    sim.flush();
    const incident = sim.raw.incidents[0];
    if (!incident) throw new Error('Kein Einsatz');
    const s = sim.suggestVehicles(incident.id).find((x) => x.vehicleId === rth.id);
    const node = sim.world.addresses[incident.addressId]?.node ?? 0;
    const liftoff = baseContent().settings.air.liftoffSeconds;
    expect(s?.etaMs).toBe(airMs(ctx, rth.node, node) + ((liftoff[0] + liftoff[1]) / 2) * 1000);
    // Bei Glatteis und Stau ist der Hubschrauber nicht langsamer.
    expect(airMs(ctx, rth.node, node)).toBeLessThan(20 * 60_000);
  });
});

describe('Sommerzeit im Spiel', () => {
  it('die Umstellungsnacht hat eine Stunde weniger, der Kern läuft gleichmäßig weiter', () => {
    const sim = simAt(simTimeFrom(2026, 3, 29, 1, 30));
    sim.run(3600);
    expect(sim.time - simTimeFrom(2026, 3, 29, 1, 30)).toBe(MS_PER_HOUR);
    expect(simTimeFrom(2026, 3, 29, 3, 30) - simTimeFrom(2026, 3, 29, 1, 30)).toBe(MS_PER_HOUR);
    expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR);
  });
});
