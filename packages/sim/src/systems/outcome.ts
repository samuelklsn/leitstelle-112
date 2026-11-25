/**
 * Patientenoutcome und Einsatzbewertung. Das Modell ist bewusst einfach und als Annahme
 * dokumentiert (docs/domain/auswertung.md): Es belohnt, was in der Realität zählt –
 * schnelle Hilfe, der richtige Notarzt-Einsatz und die geeignete Zielklinik.
 */
import { hilfsfristOf, type Ctx } from '../context';
import { MS_PER_MINUTE } from '../time';
import type { ErrorCode, IncidentState, Outcome } from '../types';
import { countError } from './calls';
import { recordHistory } from './persons';

/** Zeitfenster bis zur definitiven Versorgung je Tracer-Diagnose (Minuten ab Notrufeingang). */
const TRACER_WINDOW_MIN = { acs: 120, stroke: 90, trauma: 60 } as const;
/** Behalte geschlossene Einsätze so lange in der Liste (für den Überblick). */
const KEEP_CLOSED_MS = 30 * MS_PER_MINUTE;

export function closeIncident(ctx: Ctx, incident: IncidentState): void {
  if (incident.status === 'closed') return;
  incident.status = 'closed';
  incident.closedAt = ctx.state.time;
  // Einsatzhistorie der Adresse fortschreiben (ADR-0018).
  recordHistory(ctx, incident);
  const d = ctx.content.diagnoses.get(incident.truth.diagnosisId);
  const shift = ctx.state.shift;

  if (incident.truth.mci) {
    closeMci(ctx, incident);
    pruneClosed(ctx);
    return;
  }

  if (incident.order) {
    // Transportauftrag: Bewertet wird die Pünktlichkeit der Abholung, nicht der Patient.
    const tolerance = ctx.content.bundle.settings.transports.toleranceMinutes * MS_PER_MINUTE;
    const onTime =
      incident.firstArrivalAt !== undefined &&
      incident.firstArrivalAt <= incident.order.dueAt + tolerance;
    shift.ordersDone++;
    if (onTime) {
      shift.ordersOnTime++;
      shift.score += ORDER_POINTS;
    }
    const outcome: Outcome = onTime ? 'gut' : 'beeintraechtigt';
    incident.outcome = outcome;
    ctx.emit({ type: 'incident/closed', at: ctx.state.time, incidentId: incident.id, outcome });
    pruneClosed(ctx);
    return;
  }

  // Hilfsfrist nur für Notfälle mit Patient – Messbeginn laut geltender Regel.
  const hf = hilfsfristOf(ctx);
  const emergency = ctx.content.keywords.get(d?.keyword ?? '')?.emergency ?? true;
  const responseMs =
    incident.firstArrivalAt !== undefined
      ? incident.firstArrivalAt - responseStart(incident, hf.measure)
      : undefined;
  const realCall = incident.callKind === 'emergency' && incident.duplicateOf === undefined;
  const realPatient = realCall && incident.truth.patient;
  // Eintreffzeit der Feuerwehr (erstes Feuerwehrfahrzeug) separat messen.
  const fire = incident.truth.fire;
  if (realCall && fire && incident.firstFireArrivalAt !== undefined) {
    shift.fireMeasured++;
    if (incident.firstFireArrivalAt - incident.receivedAt <= hf.fireMinutes * MS_PER_MINUTE) {
      shift.fireMet++;
    } else {
      shift.score -= 20;
    }
  }
  if (emergency && realPatient && responseMs !== undefined && d?.transport !== 0) {
    shift.hilfsfristMeasured++;
    shift.totalResponseMs += responseMs;
    if (responseMs <= hf.minutes * MS_PER_MINUTE) shift.hilfsfristMet++;
    else shift.score -= 20;
  }

  // Stichwortwahl im Nachhinein beurteilen (die wahre Lage ist jetzt bekannt).
  const chosen = ctx.content.keywords.get(incident.keywordId);
  const correct = ctx.content.keywords.get(d?.keyword ?? '');
  const chosenHasDoctor = chosen?.aao.some((a) => ctx.content.doctorTypes.has(a.type)) ?? false;
  const fireKeyword = fire
    ? ctx.content.keywords.get(
        ctx.content.fireScenarios.get(fire.originalScenarioId)?.keyword ?? '',
      )
    : undefined;
  if (chosen && fireKeyword && realCall && fireKeyword.priority < chosen.priority) {
    // Brand zu niedrig eingestuft (z. B. B 1 statt B 2): zu wenige Kräfte unterwegs.
    addError(ctx, incident, 'undertriage');
  }
  if (chosen && correct && realPatient && !fire) {
    // Bewertet wird nur, was am Telefon erkennbar war: das fachlich passende Stichwort zum
    // Meldebild. Ein erst vor Ort sichtbarer Notarzt-Bedarf ist kein Dispositionsfehler.
    const correctHasDoctor = correct.aao.some((a) => ctx.content.doctorTypes.has(a.type));
    if (correctHasDoctor && !chosenHasDoctor) addError(ctx, incident, 'undertriage');
    else if (chosenHasDoctor && !incident.truth.needsDoctor && correct.priority > 1)
      addError(ctx, incident, 'overtriage');
  }

  const outcome = computeOutcome(ctx, incident);
  incident.outcome = outcome;
  shift.outcomes[outcome]++;
  shift.score += OUTCOME_POINTS[outcome];
  if (outcome === 'verstorben' && d?.tracer !== 'cardiac_arrest') shift.score -= 30;

  ctx.emit({ type: 'incident/closed', at: ctx.state.time, incidentId: incident.id, outcome });
  pruneClosed(ctx);
}

/** Punkte je Patient einer Großlage (weniger als ein Einzelnotfall, dafür viele). */
const MCI_POINTS: Record<Outcome, number> = {
  gut: 40,
  beeintraechtigt: 15,
  verstorben: 0,
  keinPatient: 0,
};

/**
 * Großlage (ADR-0017): Bewertet wird jeder Patient. Schwerverletzte brauchen die Klinik innerhalb
 * der „goldenen Stunde“, Mittelschwere innerhalb von zwei Stunden. Die Hilfsfrist zählt einmal.
 */
function closeMci(ctx: Ctx, incident: IncidentState): void {
  const mci = incident.truth.mci;
  if (!mci) return;
  const shift = ctx.state.shift;
  const hf = hilfsfristOf(ctx);
  const realCall = incident.callKind === 'emergency' && incident.duplicateOf === undefined;
  if (realCall && incident.firstArrivalAt !== undefined) {
    const responseMs = incident.firstArrivalAt - responseStart(incident, hf.measure);
    shift.hilfsfristMeasured++;
    shift.totalResponseMs += responseMs;
    if (responseMs <= hf.minutes * MS_PER_MINUTE) shift.hilfsfristMet++;
    else shift.score -= 20;
  }
  const fire = incident.truth.fire;
  if (realCall && fire && incident.firstFireArrivalAt !== undefined) {
    shift.fireMeasured++;
    if (incident.firstFireArrivalAt - incident.receivedAt <= hf.fireMinutes * MS_PER_MINUTE)
      shift.fireMet++;
    else shift.score -= 20;
  }
  // Großlage ohne Großlagen-Stichwort alarmiert: viel zu wenige Kräfte.
  if (realCall && !ctx.content.keywords.get(incident.keywordId)?.mci)
    addError(ctx, incident, 'undertriage');

  let worst: Outcome = 'gut';
  const rng = ctx.rng.outcome;
  for (const p of mci.patients) {
    let outcome: Outcome;
    const minutes =
      p.deliveredAt !== undefined
        ? (p.deliveredAt - incident.receivedAt) / MS_PER_MINUTE
        : Infinity;
    if (p.state === 'deceased' || p.triage === 4) outcome = 'verstorben';
    else if (p.triage === 1) {
      // Überleben sinkt nach der ersten Stunde deutlich (Annahme, docs/domain/manv.md).
      const survive = Math.min(0.95, Math.max(0.3, 0.95 - 0.01 * Math.max(0, minutes - 60)));
      outcome = !rng.chance(survive) ? 'verstorben' : minutes <= 60 ? 'gut' : 'beeintraechtigt';
      if (outcome === 'verstorben') shift.score -= 30;
    } else if (p.triage === 2) {
      outcome = minutes <= 120 ? 'gut' : 'beeintraechtigt';
    } else {
      outcome = p.state === 'onSite' || p.state === 'delivered' ? 'gut' : 'beeintraechtigt';
    }
    shift.outcomes[outcome]++;
    shift.score += MCI_POINTS[outcome];
    if (SEVERITY[outcome] > SEVERITY[worst]) worst = outcome;
  }
  incident.outcome = worst;
  ctx.emit({
    type: 'incident/closed',
    at: ctx.state.time,
    incidentId: incident.id,
    outcome: worst,
  });
}

/** Beginn der Hilfsfrist: Notrufeingang, Alarmierung oder Ausrücken (#32). */
export function responseStart(
  incident: IncidentState,
  measure: 'call' | 'dispatch' | 'departure',
): number {
  if (measure === 'dispatch') return incident.firstAlarmAt ?? incident.receivedAt;
  if (measure === 'departure')
    return incident.firstDepartureAt ?? incident.firstAlarmAt ?? incident.receivedAt;
  return incident.receivedAt;
}

function pruneClosed(ctx: Ctx): void {
  ctx.state.incidents = ctx.state.incidents.filter(
    (i) => i.status !== 'closed' || (i.closedAt ?? 0) > ctx.state.time - KEEP_CLOSED_MS,
  );
}

/** Pünktlicher Transportauftrag – weniger als ein Notfall, aber spürbar. */
const ORDER_POINTS = 30;

const OUTCOME_POINTS: Record<Outcome, number> = {
  gut: 100,
  beeintraechtigt: 40,
  verstorben: 0,
  keinPatient: 20,
};

function addError(ctx: Ctx, incident: IncidentState, code: ErrorCode): void {
  if (incident.errors.includes(code)) return;
  incident.errors.push(code);
  countError(ctx, code);
}

export function computeOutcome(ctx: Ctx, incident: IncidentState): Outcome {
  if (incident.callKind !== 'emergency' || incident.duplicateOf !== undefined) return 'keinPatient';
  const fire = incident.truth.fire;
  if (fire) {
    // Brandausbreitung bedeutet größeren Schaden – auch ohne Verletzte.
    const fireOutcome: Outcome = fire.escalations > 0 ? 'beeintraechtigt' : 'gut';
    if (!incident.truth.patient) return fireOutcome;
    const patientOutcome = patientOutcomeOf(ctx, incident);
    return worse(fireOutcome, patientOutcome);
  }
  return patientOutcomeOf(ctx, incident);
}

const SEVERITY: Record<Outcome, number> = {
  keinPatient: 0,
  gut: 1,
  beeintraechtigt: 2,
  verstorben: 3,
};
function worse(a: Outcome, b: Outcome): Outcome {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

function patientOutcomeOf(ctx: Ctx, incident: IncidentState): Outcome {
  const d = ctx.content.diagnoses.get(incident.truth.diagnosisId);
  if (!d || (d.transport === 0 && !incident.truth.transport)) return 'keinPatient';
  const min = (t: number | undefined) =>
    t === undefined ? Infinity : (t - incident.receivedAt) / MS_PER_MINUTE;
  const arrival = min(incident.firstArrivalAt);
  const doctor = min(incident.doctorArrivalAt);
  const rng = ctx.rng.outcome;
  const hf = ctx.content.bundle.settings.hilfsfrist.minutes;

  switch (d.tracer) {
    case 'cardiac_arrest': {
      // Überleben sinkt mit jeder Minute ohne professionelle Reanimation stark (Annahme:
      // ca. 7–10 %-Punkte je Minute, Laienreanimation unterstellt). Ohne Notarzt kaum Chancen.
      let p = 0.45 - 0.07 * Math.max(0, arrival - 4);
      if (doctor > arrival + 10) p -= 0.1;
      if (incident.hospitalId && !hasDept(ctx, incident, 'herzkatheter')) p -= 0.05;
      return rng.chance(Math.max(0.02, p)) ? 'beeintraechtigt' : 'verstorben';
    }
    case 'acs':
    case 'stroke':
    case 'trauma': {
      if (d.tracer === 'trauma' && incident.truth.naca < 4) break;
      const definitive = min(incident.hospitalArrivalAt);
      const suitable = d.department ? hasDept(ctx, incident, d.department) : true;
      if (!suitable) return 'beeintraechtigt';
      if (definitive > TRACER_WINDOW_MIN[d.tracer]) return 'beeintraechtigt';
      if (incident.truth.needsDoctor && doctor > arrival + 15) return 'beeintraechtigt';
      return 'gut';
    }
    default:
      break;
  }
  if (arrival > hf * 2) return 'beeintraechtigt';
  if (incident.truth.naca >= 4 && incident.truth.needsDoctor && doctor === Infinity)
    return 'beeintraechtigt';
  if (d.department && incident.hospitalId && !hasDept(ctx, incident, d.department))
    return 'beeintraechtigt';
  return 'gut';
}

function hasDept(ctx: Ctx, incident: IncidentState, dept: string): boolean {
  const h = incident.hospitalId ? ctx.content.hospitals.get(incident.hospitalId) : undefined;
  return h?.departments.includes(dept as never) ?? false;
}
