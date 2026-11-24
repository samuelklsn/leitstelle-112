/**
 * Welt-Dynamik (ADR-0016): Wetter nach Klima und Jahreszeit, Ereignisse der Weltlage (Volksfest,
 * Grippewelle, Baustelle, Silvester) und die Einsatz-Regie. Alles verschiebt nur Raten und
 * Gewichte innerhalb der Grenzen aus den Inhalten – nichts davon erfindet Unrealistisches.
 */
import type { Climate, Weather, WorldEvent } from '@ls112/content';
import { RoadClass } from '@ls112/routing';
import { patternWeekday } from '../calendar';
import { pickWeighted, rangeInt, type ContentIndex, type Ctx } from '../context';
import { MS_PER_HOUR, MS_PER_MINUTE, toCalendar, type SimTime } from '../time';
import type { WorldEventState, WorldState } from '../types';

/** Sperrungen machen eine Kante so viel langsamer: In aller Regel wird umgeleitet. */
export const CLOSURE_FACTOR = 15;

// ---------------------------------------------------------------------------- Zugriff

export function currentWeather(ctx: Pick<Ctx, 'content' | 'state'>): Weather | undefined {
  return ctx.content.weather.get(ctx.state.world.weatherId);
}

/** Fahrzeitfaktor durch das Wetter (1 = trocken). */
export function weatherSpeed(ctx: Pick<Ctx, 'content' | 'state'>): number {
  return currentWeather(ctx)?.speed ?? 1;
}

/** Hubschrauber dürfen fliegen. */
export function flyable(ctx: Pick<Ctx, 'content' | 'state'>): boolean {
  return currentWeather(ctx)?.flyable ?? true;
}

/** Faktor der Einsatz-Regie zum Zeitpunkt `time` (linear innerhalb der Phase). */
export function directorFactor(world: WorldState, time: SimTime): number {
  const d = world.director;
  const span = d.phaseEnd - d.phaseStart;
  if (span <= 0) return d.to;
  const f = Math.min(1, Math.max(0, (time - d.phaseStart) / span));
  return d.from + (d.to - d.from) * f;
}

/**
 * Faktor auf das Notrufaufkommen: Wochentag × Wetter × Ereignisse × Regie. Feiertage zählen als
 * Sonntag.
 */
export function callFactor(ctx: Ctx): number {
  const calls = ctx.content.bundle.settings.calls;
  const weekday = patternWeekday(ctx.content.bundle.holidays, ctx.state.time);
  let f = (calls.weekdayFactor[weekday - 1] ?? 1) * (currentWeather(ctx)?.calls ?? 1);
  for (const e of ctx.state.world.events) f *= ctx.content.worldEvents.get(e.eventId)?.calls ?? 1;
  return f * directorFactor(ctx.state.world, ctx.state.time);
}

interface MixWeights {
  readonly diagnoses: readonly number[];
  readonly fire: readonly number[];
}

/** Kumulative Gewichte je Wetter-/Ereigniskombination – abgeleitet, daher cachebar. */
const mixCache = new WeakMap<ContentIndex, Map<string, MixWeights>>();

/** Einsatzmix unter Wetter und Ereignissen als kumulative Gewichte. */
export function mixWeights(ctx: Ctx): MixWeights {
  const world = ctx.state.world;
  const ids = [...new Set(world.events.map((e) => e.eventId))].sort();
  const key = `${world.weatherId}|${ids.join(',')}`;
  let byKey = mixCache.get(ctx.content);
  if (!byKey) {
    byKey = new Map();
    mixCache.set(ctx.content, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;
  const sources = [currentWeather(ctx), ...ids.map((id) => ctx.content.worldEvents.get(id))].filter(
    (x): x is Weather | WorldEvent => x !== undefined,
  );
  const factor = (pick: (s: Weather | WorldEvent) => Record<string, number>, id: string) =>
    sources.reduce((f, s) => f * (pick(s)[id] ?? 1), 1);
  let cum = 0;
  const diagnoses = ctx.content.bundle.diagnoses.map(
    (d) => (cum += d.onlyAsCasualty ? 0 : d.weight * factor((s) => s.diagnoses, d.id)),
  );
  let fireCum = 0;
  const fire = ctx.content.bundle.fireScenarios.map(
    (s) => (fireCum += s.weight * factor((x) => x.fireScenarios, s.id)),
  );
  const result = { diagnoses, fire };
  byKey.set(key, result);
  return result;
}

/**
 * Ort eines laufenden Ereignisses, an dem dieser Notruf stattfindet (z. B. Volksfest) – oder
 * undefined für den normalen Einsatzort.
 */
export function eventTown(ctx: Ctx): string | undefined {
  for (const e of ctx.state.world.events) {
    if (!e.townId) continue;
    const share = ctx.content.worldEvents.get(e.eventId)?.localShare ?? 0;
    if (ctx.rng.patients.chance(share)) return e.townId;
  }
  return undefined;
}

// ---------------------------------------------------------------------------- Wetter

function climateOf(ctx: Ctx, time: SimTime): Climate | undefined {
  const { month } = toCalendar(time);
  return ctx.content.bundle.climate.find((c) => c.month === month);
}

function pickWeather(ctx: Ctx, climate: Climate): Weather | undefined {
  const items = Object.entries(climate.weather)
    .map(([id, weight]) => ({ w: ctx.content.weather.get(id), weight }))
    .filter((x): x is { w: Weather; weight: number } => x.w !== undefined && x.weight > 0);
  if (items.length === 0) return undefined;
  return pickWeighted(ctx.rng.world, items).w;
}

/** Temperatur passend zu Monat und Wetterlage (Hitze ist heiß, Glätte kalt). */
function temperatureFor(ctx: Ctx, climate: Climate, w: Weather): number {
  const [lo, hi] = climate.temperature;
  const min = w.minTemperature ?? Number.NEGATIVE_INFINITY;
  const max = w.maxTemperature ?? Number.POSITIVE_INFINITY;
  const a = Math.max(lo, min);
  const b = Math.min(hi, max);
  if (a > b) return Math.round(Number.isFinite(min) ? min : max);
  return ctx.rng.world.nextInt(Math.round(a), Math.round(b));
}

function setWeather(ctx: Ctx, w: Weather, climate: Climate): void {
  const world = ctx.state.world;
  const changed = world.weatherId !== w.id;
  world.weatherId = w.id;
  world.temperature = temperatureFor(ctx, climate, w);
  const hours = rangeInt(ctx.rng.world, ctx.content.bundle.settings.weather.changeHours);
  world.weatherUntil = ctx.state.time + hours * MS_PER_HOUR;
  ctx.schedule(world.weatherUntil, { kind: 'world/weather' });
  if (changed) ctx.emit({ type: 'world/weather', at: ctx.state.time, weatherId: w.id });
}

export function onWeatherChange(ctx: Ctx): void {
  const climate = climateOf(ctx, ctx.state.time);
  const current = currentWeather(ctx);
  if (!climate) return;
  // Wetterlagen halten oft länger; sonst neu nach Klima des Monats.
  const keep =
    current !== undefined &&
    (climate.weather[current.id] ?? 0) > 0 &&
    ctx.rng.world.chance(ctx.content.bundle.settings.weather.persistence);
  const next = keep ? current : pickWeather(ctx, climate);
  if (next) setWeather(ctx, next, climate);
}

// ---------------------------------------------------------------------------- Einsatz-Regie

function nextPhase(ctx: Ctx, from: number): void {
  const d = ctx.content.bundle.settings.director;
  const now = ctx.state.time;
  const to = 1 + d.amplitude * (2 * ctx.rng.world.nextFloat() - 1);
  const minutes = rangeInt(ctx.rng.world, d.phaseMinutes);
  ctx.state.world.director = { from, to, phaseStart: now, phaseEnd: now + minutes * MS_PER_MINUTE };
  ctx.schedule(now + minutes * MS_PER_MINUTE, { kind: 'world/director' });
}

export function onDirectorPhase(ctx: Ctx): void {
  nextPhase(ctx, ctx.state.world.director.to);
}

// ---------------------------------------------------------------------------- Ereignisse

/** Startzustand: Wetter nach Klima, erste Regie-Phase, laufende Ereignisse mit festem Datum. */
export function initWorld(ctx: Ctx): WorldState {
  const now = ctx.state.time;
  ctx.state.world = {
    weatherId: '',
    temperature: 10,
    weatherUntil: now,
    events: [],
    director: { from: 1, to: 1, phaseStart: now, phaseEnd: now },
  };
  const climate = climateOf(ctx, now);
  const w = climate ? pickWeather(ctx, climate) : undefined;
  if (climate && w) setWeather(ctx, w, climate);
  nextPhase(ctx, 1);
  // Ein Ereignis mit festem Datum, das schon läuft (Start mitten in der Silvesternacht).
  for (const e of ctx.content.bundle.worldEvents) {
    if (!e.date) continue;
    for (const back of [0, 1]) {
      const start = dateStart(e, now - back * 24 * MS_PER_HOUR);
      if (start === undefined || start > now) continue;
      const until = start + e.durationHours[1] * MS_PER_HOUR;
      if (until > now) startEvent(ctx, e, until);
    }
  }
  return ctx.state.world;
}

/** Beginn eines Datums-Ereignisses am Kalendertag von `time` (sonst undefined). */
function dateStart(e: WorldEvent, time: SimTime): SimTime | undefined {
  if (!e.date) return undefined;
  const cal = toCalendar(time);
  if (cal.month !== e.date.month || cal.day !== e.date.day) return undefined;
  return time - ((cal.hour - e.date.hour) * 3600 + cal.minute * 60 + cal.second) * 1000;
}

/** Zu jeder vollen Stunde: Beginnen Ereignisse? */
export function updateWorld(ctx: Ctx): void {
  const now = ctx.state.time;
  if (now % MS_PER_HOUR !== 0) return;
  const cal = toCalendar(now);
  const weekday = patternWeekday(ctx.content.bundle.holidays, now);
  for (const e of ctx.content.bundle.worldEvents) {
    if (ctx.state.world.events.some((x) => x.eventId === e.id)) continue;
    if (e.date) {
      if (e.date.month === cal.month && e.date.day === cal.day && e.date.hour === cal.hour)
        startEvent(ctx, e);
      continue;
    }
    if (e.months.length > 0 && !e.months.includes(cal.month)) continue;
    if (e.weekdays.length > 0 && !e.weekdays.includes(weekday)) continue;
    const [from, to] = e.startHour;
    if (cal.hour < from || cal.hour > to) continue;
    // Die Tageswahrscheinlichkeit verteilt sich auf die möglichen Startstunden.
    if (ctx.rng.world.chance(e.perDay / (to - from + 1))) startEvent(ctx, e);
  }
}

function startEvent(ctx: Ctx, e: WorldEvent, fixedUntil?: SimTime): void {
  const now = ctx.state.time;
  const rng = ctx.rng.world;
  const until = fixedUntil ?? now + rangeInt(rng, e.durationHours) * MS_PER_HOUR;
  let townId: string | undefined;
  if (e.town) {
    const towns = ctx.world.towns.filter((t) => t.population >= e.minPopulation);
    if (towns.length === 0) return;
    townId = rng.pick(towns).id;
  }
  const closure = e.closure ? pickClosure(ctx) : undefined;
  if (e.closure && !closure) return;
  const state: WorldEventState = {
    key: ctx.newId('W'),
    eventId: e.id,
    startedAt: now,
    until,
    ...(townId !== undefined ? { townId } : {}),
    ...(closure ? { closure } : {}),
  };
  ctx.state.world.events.push(state);
  ctx.schedule(until, { kind: 'world/eventEnd', key: state.key });
  ctx.emit({
    type: 'world/event',
    at: now,
    eventId: e.id,
    started: true,
    ...(townId !== undefined ? { townId } : {}),
    ...(closure ? { streetId: closure.streetId } : {}),
  });
  if (closure) syncClosures(ctx);
}

export function onEventEnd(ctx: Ctx, key: string): void {
  const world = ctx.state.world;
  const e = world.events.find((x) => x.key === key);
  if (!e) return;
  world.events = world.events.filter((x) => x.key !== key);
  ctx.emit({
    type: 'world/event',
    at: ctx.state.time,
    eventId: e.eventId,
    started: false,
    ...(e.townId !== undefined ? { townId: e.townId } : {}),
    ...(e.closure ? { streetId: e.closure.streetId } : {}),
  });
  if (e.closure) syncClosures(ctx);
}

/** Ein Straßenstück auf Bundes-, Landes- oder Kreisstraße bzw. innerörtlicher Hauptstraße. */
function pickClosure(ctx: Ctx): WorldEventState['closure'] {
  const g = ctx.world.graph;
  const closed = new Set(
    ctx.state.world.events.flatMap((e) => (e.closure ? [e.closure.streetId] : [])),
  );
  const candidates = ctx.world.segments.filter(
    (s) =>
      s.roadClass !== RoadClass.Motorway &&
      s.roadClass <= RoadClass.UrbanMain &&
      !closed.has(s.streetId),
  );
  if (candidates.length === 0) return undefined;
  const seg = ctx.rng.world.pick(candidates);
  const edges: number[] = [];
  for (const [a, b] of [
    [seg.from, seg.to],
    [seg.to, seg.from],
  ] as const) {
    for (let k = g.outOffsets[a] ?? 0; k < (g.outOffsets[a + 1] ?? 0); k++) {
      const e = g.outEdges[k] ?? 0;
      if (g.edgeTo[e] === b) edges.push(e);
    }
  }
  return {
    edges,
    streetId: seg.streetId,
    x: Math.round(((g.x[seg.from] ?? 0) + (g.x[seg.to] ?? 0)) / 2),
    y: Math.round(((g.y[seg.from] ?? 0) + (g.y[seg.to] ?? 0)) / 2),
  };
}

/** Sperrungen an den Router geben (abgeleiteter Zustand, auch nach dem Laden). */
export function syncClosures(ctx: Pick<Ctx, 'router' | 'state'>): void {
  const edges = ctx.state.world.events.flatMap((e) => (e.closure ? [...e.closure.edges] : []));
  ctx.router.setPenalties(edges, CLOSURE_FACTOR);
}

/** Ereignis sofort beginnen lassen (Tests, später Szenario-Editor). */
export function startWorldEvent(ctx: Ctx, eventId: string): WorldEventState | undefined {
  const e = ctx.content.worldEvents.get(eventId);
  if (!e) return undefined;
  startEvent(ctx, e);
  return ctx.state.world.events.find((x) => x.eventId === eventId);
}
