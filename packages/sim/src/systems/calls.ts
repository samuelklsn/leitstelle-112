import { pickCumulative, pickWeighted, rangeInt, type Ctx } from '../context';
import { MS_PER_HOUR, MS_PER_MINUTE, TICK_MS, toCalendar } from '../time';
import {
  QUESTIONS,
  type CallKind,
  type CallSource,
  type CallState,
  type CallerKind,
  type CallerReport,
  type Question,
  type RejectReason,
  type Truth,
} from '../types';

/** Notrufe je Stunde im Tagesmittel aus Einwohnerzahl, Rate und Schwierigkeitsgrad. */
export function meanCallsPerHour(ctx: Ctx): number {
  const s = ctx.content.bundle.settings.calls;
  return (s.ratePer100k * ctx.content.population * ctx.config.callRateFactor) / 100_000;
}

/** Doppelmeldungen beziehen sich auf Einsätze, die höchstens so alt sind. */
const DUPLICATE_WINDOW_MS = 20 * MS_PER_MINUTE;

/**
 * Notrufe als Bernoulli-Prozess je Tick (p = Rate × Δt) – bei Raten weit unter einem Anruf pro
 * Sekunde eine sehr gute Näherung an einen Poisson-Prozess, ohne Logarithmus (ADR-0004).
 */
export function generateCalls(ctx: Ctx): void {
  const { hour } = toCalendar(ctx.state.time);
  const profile = ctx.content.bundle.settings.calls.hourlyProfile[hour] ?? 1;
  let p = (meanCallsPerHour(ctx) * profile * TICK_MS) / MS_PER_HOUR;
  const tutorialFirst = ctx.config.tutorial && ctx.state.shift.callsReceived === 0;
  if (ctx.config.tutorial) {
    // Training: der erste Notruf kommt sofort, danach nur ein ruhiges Grundrauschen.
    if (tutorialFirst && ctx.state.tick >= 5) p = 1;
    else p *= 0.3;
  }
  if (!ctx.rng.calls.chance(p)) return;
  createCall(ctx, tutorialFirst ? 'emergency' : pickKind(ctx));
}

/** Welche Art von Anruf als nächstes kommt (Anteile aus den Einstellungen). */
function pickKind(ctx: Ctx): CallKind {
  const k = ctx.content.bundle.settings.calls.kinds;
  const rng = ctx.rng.calls;
  const r = rng.nextFloat();
  if (r < k.misdial) return 'misdial';
  if (r < k.misdial + k.prank) return 'prank';
  if (r < k.misdial + k.prank + k.info) return 'info';
  const recent = ctx.state.incidents.some(
    (i) => i.status !== 'closed' && ctx.state.time - i.receivedAt < DUPLICATE_WINDOW_MS,
  );
  if (recent && rng.chance(k.duplicate)) return 'duplicate';
  return 'emergency';
}

export function createCall(ctx: Ctx, kind: CallKind = 'emergency'): CallState {
  const settings = ctx.content.bundle.settings.calls;
  let truth: Truth;
  let duplicateOf: string | undefined;
  if (kind === 'duplicate') {
    const candidates = ctx.state.incidents.filter(
      (i) => i.status !== 'closed' && ctx.state.time - i.receivedAt < DUPLICATE_WINDOW_MS,
    );
    const original = candidates[ctx.rng.calls.nextInt(0, Math.max(0, candidates.length - 1))];
    if (original) {
      truth = original.truth;
      duplicateOf = original.id;
    } else {
      kind = 'emergency';
      truth = createTruth(ctx);
    }
  } else if (kind === 'emergency') {
    truth = createTruth(ctx);
  } else {
    truth = createNonEmergencyTruth(ctx);
  }
  const d = ctx.content.diagnoses.get(truth.diagnosisId);
  // Die Polizei übergibt vor allem Einsätze im Freien – mit geprüften Angaben.
  const source: CallSource =
    kind === 'emergency' && d?.outdoor === true && ctx.rng.callers.chance(settings.kinds.police)
      ? '110'
      : '112';
  const report = createReport(ctx, truth, kind, source);
  const call: CallState = {
    id: ctx.newId('N'),
    receivedAt: ctx.state.time,
    status: 'waiting',
    kind,
    source,
    ...(duplicateOf !== undefined ? { duplicateOf } : {}),
    truth,
    report,
    answered: source === '110' ? [...QUESTIONS] : [],
    asked: [],
  };
  ctx.state.calls.push(call);
  ctx.state.shift.callsReceived++;
  const patience = rangeInt(ctx.rng.callers, settings.abandonAfterSeconds);
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

/** Fehl-, Scherz- und Auskunftsanrufe: niemand braucht vor Ort Hilfe. */
function createNonEmergencyTruth(ctx: Ctx): Truth {
  const rng = ctx.rng.patients;
  const none = ctx.content.bundle.diagnoses.find((d) => d.transport === 0);
  return {
    diagnosisId: none?.id ?? ctx.content.bundle.diagnoses[0]?.id ?? '',
    addressId: ctx.world.houseIds[pickCumulative(rng, ctx.world.houseWeights)] ?? 0,
    age: rng.nextInt(18, 70),
    sex: rng.chance(0.5) ? 'w' : 'm',
    naca: 1,
    needsDoctor: false,
    transport: false,
    onSceneMs: 5 * MS_PER_MINUTE,
  };
}

/** Meldebilder, mit denen Scherzanrufer gern übertreiben. */
const PRANK_REPORTS = ['not_responding', 'traffic_accident', 'unconscious', 'chest_pain'];

function createReport(ctx: Ctx, truth: Truth, kind: CallKind, source: CallSource): CallerReport {
  const rng = ctx.rng.callers;
  const settings = ctx.content.bundle.settings.caller;
  const d = ctx.content.diagnoses.get(truth.diagnosisId);
  const address = ctx.world.addresses[truth.addressId];
  if (!d || !address) throw new Error('Inkonsistente Wahrheit');
  const official = source === '110';

  let caller: CallerKind;
  if (address.kind === 'road' || d.outdoor || kind === 'duplicate') caller = 'passerby';
  else if (truth.age < 14) caller = 'relative';
  else if (truth.age >= 75)
    caller = rng.pick<CallerKind>(['relative', 'neighbor', 'caregiver', 'relative']);
  else caller = rng.pick<CallerKind>(['self', 'relative', 'relative', 'neighbor']);

  let number = address.number;
  if (!official && address.kind === 'house' && rng.chance(settings.wrongHouseNumber)) {
    // Zahlendreher oder Nachbarhaus – passiert in der Aufregung häufig.
    const alt = Number(address.number) + (rng.chance(0.5) ? 2 : -2);
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
    !official && address.kind === 'house' && rng.chance(settings.missingTown)
      ? null
      : address.townId;
  const misjudge = official ? 0 : rng.chance(settings.misjudge) ? (rng.chance(0.5) ? 1 : -1) : 0;
  const digits = () => rng.nextInt(0, 9).toString();
  const callback =
    kind === 'prank' || kind === 'misdial'
      ? ''
      : rng.chance(0.55)
        ? `01${rng.pick(['51', '52', '57', '60', '62', '76'])}${digits()} ${Array.from({ length: 7 }, digits).join('')}`
        : `0${rng.pick(['5671', '5672', '5675', '5678'])} ${Array.from({ length: 5 }, digits).join('')}`;
  const ageGuess = Math.max(1, Math.round(truth.age / 5) * 5 + rng.nextInt(-1, 1) * 5);

  let reportKey = pickWeighted(rng, d.reports).key;
  if (kind === 'misdial') reportKey = 'silence';
  if (kind === 'info') reportKey = rng.pick(['info_pharmacy', 'info_doctor', 'info_transport']);
  if (kind === 'prank') reportKey = rng.pick(PRANK_REPORTS);
  if (kind === 'duplicate') reportKey = d.outdoor ? 'witness' : reportKey;

  const tracer = d.tracer;
  let conscious: CallerReport['conscious'] = 'yes';
  let breathing: CallerReport['breathing'] = 'normal';
  if (tracer === 'cardiac_arrest') {
    conscious = 'no';
    breathing = 'none';
  } else if (['unconscious', 'not_responding', 'child_seizure', 'seizure'].includes(reportKey)) {
    conscious = 'no';
  }
  if (reportKey === 'breathing' || reportKey === 'allergy' || d.id.includes('dyspnea'))
    breathing = 'difficult';
  if (kind === 'prank') {
    conscious = rng.pick(['no', 'unclear']);
    breathing = 'unclear';
  }
  // Panische Anrufer können oft nicht sicher sagen, ob jemand atmet.
  if (misjudge > 0 && rng.chance(0.5)) breathing = 'unclear';

  return {
    kind: caller,
    reportKey,
    streetId: address.streetId,
    number,
    townId,
    toTownId: address.toTownId ?? null,
    callback,
    ageGuess,
    sex: truth.sex,
    misjudge,
    conscious,
    breathing,
  };
}

/** Ein Disponent führt immer nur ein Gespräch gleichzeitig. */
export function acceptCall(ctx: Ctx, callId: string): RejectReason | undefined {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (!call) return 'unknownCall';
  if (call.status !== 'waiting') return 'callNotWaiting';
  if (ctx.state.calls.some((c) => c.status === 'talking')) return 'lineBusy';
  call.status = 'talking';
  call.acceptedAt = ctx.state.time;
  const waitedMs = ctx.state.time - call.receivedAt;
  ctx.state.shift.callsAccepted++;
  ctx.state.shift.totalAnswerMs += waitedMs;
  ctx.emit({ type: 'call/accepted', at: ctx.state.time, callId, waitedMs });
  return undefined;
}

/**
 * Eine Frage stellen. Der Anrufer antwortet nach einigen Sekunden – aufgeregte Anrufer brauchen
 * länger. Diese Zeit läuft in die Hilfsfrist: früh alarmieren oder erst fertig abfragen?
 */
export function askQuestion(
  ctx: Ctx,
  callId: string,
  question: Question,
): RejectReason | undefined {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (!call) return 'unknownCall';
  if (call.status !== 'talking') return 'callNotTalking';
  if (call.answered.includes(question) || call.asked.includes(question)) return undefined;
  call.asked.push(question);
  if (call.asked.length === 1) scheduleAnswer(ctx, call);
  return undefined;
}

function scheduleAnswer(ctx: Ctx, call: CallState): void {
  const range = ctx.content.bundle.settings.calls.answerSeconds;
  const panic = call.report.misjudge > 0 ? 3 : 0;
  const seconds = rangeInt(ctx.rng.callers, range) + panic;
  ctx.schedule(ctx.state.time + seconds * 1000, { kind: 'call/answer', callId: call.id });
}

export function onAnswer(ctx: Ctx, callId: string): void {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (call?.status !== 'talking') return;
  const question = call.asked.shift();
  if (!question) return;
  call.answered.push(question);
  ctx.emit({ type: 'call/answer', at: ctx.state.time, callId, question });
  if (call.asked.length > 0) scheduleAnswer(ctx, call);
}

/** Gespräch ohne Einsatz beenden (z. B. Fehl-, Scherz- oder Auskunftsanruf). */
export function closeCall(ctx: Ctx, callId: string): RejectReason | undefined {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (!call) return 'unknownCall';
  if (call.status !== 'talking') return 'callNotTalking';
  ctx.state.calls = ctx.state.calls.filter((c) => c.id !== callId);
  if (call.kind === 'emergency' && call.truth.transport) {
    // Hinter dem Anruf stand ein echter Notfall – schwerer Fehler.
    countError(ctx, 'callClosedWithEmergency');
  }
  ctx.emit({ type: 'call/closed', at: ctx.state.time, callId });
  return undefined;
}

/** Weitere Meldung einem bestehenden Einsatz zuordnen (Doppelmeldung). */
export function linkCall(ctx: Ctx, callId: string, incidentId: string): RejectReason | undefined {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (!call) return 'unknownCall';
  if (call.status !== 'talking') return 'callNotTalking';
  const incident = ctx.state.incidents.find((i) => i.id === incidentId);
  if (!incident) return 'unknownIncident';
  if (incident.status === 'closed') return 'incidentClosed';
  ctx.state.calls = ctx.state.calls.filter((c) => c.id !== callId);
  // Wer einen echten neuen Notfall einem fremden Einsatz zuordnet, lässt einen Patienten liegen.
  if (call.kind === 'emergency' && call.truth.transport) countError(ctx, 'callClosedWithEmergency');
  ctx.emit({ type: 'call/linked', at: ctx.state.time, callId, incidentId });
  return undefined;
}

export function abandonCall(ctx: Ctx, callId: string): void {
  const call = ctx.state.calls.find((c) => c.id === callId);
  if (call?.status !== 'waiting') return;
  ctx.state.calls = ctx.state.calls.filter((c) => c.id !== callId);
  ctx.state.shift.callsAbandoned++;
  // Nur ein unbeantworteter *Notfall* ist ein Fehler; Fehlanrufe legen ohnehin wieder auf.
  if (call.kind === 'emergency' || call.kind === 'duplicate') countError(ctx, 'callAbandoned');
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
  duplicateIncident: 15,
  prankDispatched: 10,
  nonEmergencyDispatched: 10,
} as const;
