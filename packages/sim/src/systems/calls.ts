import { pickCumulative, pickWeighted, rangeInt, type Ctx } from '../context';
import { MS_PER_HOUR, MS_PER_MINUTE, TICK_MS, toCalendar } from '../time';
import type { CallState, CallerKind, CallerReport, RejectReason, Truth } from '../types';

/** Notrufe je Stunde im Tagesmittel aus Einwohnerzahl, Rate und Schwierigkeitsgrad. */
export function meanCallsPerHour(ctx: Ctx): number {
  const s = ctx.content.bundle.settings.calls;
  return (s.ratePer100k * ctx.content.population * ctx.config.callRateFactor) / 100_000;
}

/**
 * Notrufe als Bernoulli-Prozess je Tick (p = Rate × Δt) – bei Raten weit unter einem Anruf pro
 * Sekunde eine sehr gute Näherung an einen Poisson-Prozess, ohne Logarithmus (ADR-0004).
 */
export function generateCalls(ctx: Ctx): void {
  const { hour } = toCalendar(ctx.state.time);
  const profile = ctx.content.bundle.settings.calls.hourlyProfile[hour] ?? 1;
  let p = (meanCallsPerHour(ctx) * profile * TICK_MS) / MS_PER_HOUR;
  if (ctx.config.tutorial) {
    // Training: der erste Notruf kommt sofort, danach nur ein ruhiges Grundrauschen.
    if (ctx.state.shift.callsReceived === 0 && ctx.state.tick >= 5) p = 1;
    else p *= 0.3;
  }
  if (!ctx.rng.calls.chance(p)) return;
  createCall(ctx);
}

export function createCall(ctx: Ctx): CallState {
  const truth = createTruth(ctx);
  const report = createReport(ctx, truth);
  const call: CallState = {
    id: ctx.newId('N'),
    receivedAt: ctx.state.time,
    status: 'waiting',
    truth,
    report,
  };
  ctx.state.calls.push(call);
  ctx.state.shift.callsReceived++;
  const patience = rangeInt(ctx.rng.callers, ctx.content.bundle.settings.calls.abandonAfterSeconds);
  ctx.schedule(ctx.state.time + patience * 1000, { kind: 'call/abandon', callId: call.id });
  ctx.emit({ type: 'call/incoming', at: ctx.state.time, callId: call.id });
  return call;
}

/** Die tatsächliche Lage: Krankheitsbild, Ort, Patient (ADR-0014). */
function createTruth(ctx: Ctx): Truth {
  const rng = ctx.rng.patients;
  const diagnoses = ctx.content.bundle.diagnoses;
  const d = diagnoses[pickCumulative(rng, ctx.content.diagnosisCumWeights)];
  if (!d) throw new Error('Keine Krankheitsbilder');
  const { world } = ctx;
  let addressId: number;
  if (d.outdoor && world.roadAddressIds.length > 0 && rng.chance(0.5)) {
    addressId = world.roadAddressIds[rng.nextInt(0, world.roadAddressIds.length - 1)] ?? 0;
  } else {
    addressId = world.houseIds[pickCumulative(rng, world.houseWeights)] ?? 0;
  }
  const naca = rangeInt(rng, d.naca);
  return {
    diagnosisId: d.id,
    addressId,
    age: rangeInt(rng, d.ageRange),
    sex: rng.chance(0.5) ? 'w' : 'm',
    naca,
    // Ab NACA 5 (akute Lebensgefahr) ist der Notarzt immer angezeigt.
    needsDoctor: naca >= 5 || rng.chance(d.doctorNeeded),
    transport: rng.chance(d.transport),
    onSceneMs: rangeInt(rng, d.onSceneMinutes) * MS_PER_MINUTE,
  };
}

function createReport(ctx: Ctx, truth: Truth): CallerReport {
  const rng = ctx.rng.callers;
  const settings = ctx.content.bundle.settings.caller;
  const d = ctx.content.diagnoses.get(truth.diagnosisId);
  const address = ctx.world.addresses[truth.addressId];
  if (!d || !address) throw new Error('Inkonsistente Wahrheit');

  let kind: CallerKind;
  if (address.kind === 'road' || d.outdoor) kind = 'passerby';
  else if (truth.age < 14) kind = 'relative';
  else if (truth.age >= 75)
    kind = rng.pick<CallerKind>(['relative', 'neighbor', 'caregiver', 'relative']);
  else kind = rng.pick<CallerKind>(['self', 'relative', 'relative', 'neighbor']);

  let number = address.number;
  if (address.kind === 'house' && rng.chance(settings.wrongHouseNumber)) {
    // Zahlendreher oder Nachbarhaus – passiert in der Aufregung häufig.
    const n = Number(address.number);
    const alt = n + (rng.chance(0.5) ? 2 : -2);
    if (
      alt > 0 &&
      ctx.world.addresses.some(
        (a) => a.streetId === address.streetId && a.number === alt.toString(),
      )
    ) {
      number = alt.toString();
    }
  }
  const townId =
    address.kind === 'house' && rng.chance(settings.missingTown) ? null : address.townId;
  const misjudge = rng.chance(settings.misjudge) ? (rng.chance(0.5) ? 1 : -1) : 0;
  const digits = () => rng.nextInt(0, 9).toString();
  const callback = rng.chance(0.55)
    ? `01${rng.pick(['51', '52', '57', '60', '62', '76'])}${digits()} ${Array.from({ length: 7 }, digits).join('')}`
    : `0${rng.pick(['5671', '5672', '5675', '5678'])} ${Array.from({ length: 5 }, digits).join('')}`;
  const ageGuess = Math.max(1, Math.round(truth.age / 5) * 5 + rng.nextInt(-1, 1) * 5);

  return {
    kind,
    reportKey: pickWeighted(rng, d.reports).key,
    streetId: address.streetId,
    number,
    townId,
    toTownId: address.toTownId ?? null,
    callback,
    ageGuess,
    sex: truth.sex,
    misjudge,
  };
}

export function acceptCall(ctx: Ctx, callId: string): RejectReason | undefined {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (!call) return 'unknownCall';
  if (call.status !== 'waiting') return 'callNotWaiting';
  call.status = 'talking';
  call.acceptedAt = ctx.state.time;
  const waitedMs = ctx.state.time - call.receivedAt;
  ctx.state.shift.callsAccepted++;
  ctx.state.shift.totalAnswerMs += waitedMs;
  ctx.emit({ type: 'call/accepted', at: ctx.state.time, callId, waitedMs });
  return undefined;
}

/** Gespräch ohne Einsatz beenden (z. B. Fehlanruf). */
export function closeCall(ctx: Ctx, callId: string): RejectReason | undefined {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (!call) return 'unknownCall';
  if (call.status !== 'talking') return 'callNotTalking';
  ctx.state.calls = ctx.state.calls.filter((c) => c.id !== callId);
  const d = ctx.content.diagnoses.get(call.truth.diagnosisId);
  if (d && d.transport > 0) {
    // Hinter dem Anruf stand ein echter Notfall – schwerer Fehler.
    countError(ctx, 'callClosedWithEmergency');
  }
  ctx.emit({ type: 'call/closed', at: ctx.state.time, callId });
  return undefined;
}

export function abandonCall(ctx: Ctx, callId: string): void {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (call?.status !== 'waiting') return;
  ctx.state.calls = ctx.state.calls.filter((c) => c.id !== callId);
  ctx.state.shift.callsAbandoned++;
  countError(ctx, 'callAbandoned');
  ctx.emit({ type: 'call/abandoned', at: ctx.state.time, callId });
}

export function countError(ctx: Ctx, code: keyof typeof ERROR_PENALTY): void {
  const e = ctx.state.shift.errors;
  e[code] = (e[code] ?? 0) + 1;
  ctx.state.shift.score -= ERROR_PENALTY[code];
}

/** Punktabzug je Fehler (Spielbalance, docs/domain/auswertung.md). */
export const ERROR_PENALTY = {
  callAbandoned: 30,
  callClosedWithEmergency: 60,
  undertriage: 25,
  overtriage: 5,
  wrongLocation: 20,
  notNearestVehicle: 15,
  slowDispatch: 10,
  doctorLate: 15,
  unsuitableHospital: 25,
  destinationTimeout: 10,
} as const;
