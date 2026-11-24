/**
 * Patientenoutcome und Einsatzbewertung. Das Modell ist bewusst einfach und als Annahme
 * dokumentiert (docs/domain/auswertung.md): Es belohnt, was in der Realität zählt –
 * schnelle Hilfe, der richtige Notarzt-Einsatz und die geeignete Zielklinik.
 */
import type { Ctx } from '../context';
import { MS_PER_MINUTE } from '../time';
import type { ErrorCode, IncidentState, Outcome } from '../types';
import { countError } from './calls';

/** Zeitfenster bis zur definitiven Versorgung je Tracer-Diagnose (Minuten ab Notrufeingang). */
const TRACER_WINDOW_MIN = { acs: 120, stroke: 90, trauma: 60 } as const;
/** Behalte geschlossene Einsätze so lange in der Liste (für den Überblick). */
const KEEP_CLOSED_MS = 30 * MS_PER_MINUTE;

export function closeIncident(ctx: Ctx, incident: IncidentState): void {
  if (incident.status === 'closed') return;
  incident.status = 'closed';
  incident.closedAt = ctx.state.time;
  const d = ctx.content.diagnoses.get(incident.truth.diagnosisId);
  const shift = ctx.state.shift;

  // Hilfsfrist nur für Notfälle mit Patient.
  const hf = ctx.content.bundle.settings.hilfsfrist;
  const emergency = ctx.content.keywords.get(d?.keyword ?? '')?.emergency ?? true;
  const responseMs =
    incident.firstArrivalAt !== undefined
      ? incident.firstArrivalAt - incident.receivedAt
      : undefined;
  if (emergency && responseMs !== undefined && d?.transport !== 0) {
    shift.hilfsfristMeasured++;
    shift.totalResponseMs += responseMs;
    if (responseMs <= hf.minutes * MS_PER_MINUTE) shift.hilfsfristMet++;
    else shift.score -= 20;
  }

  // Stichwortwahl im Nachhinein beurteilen (die wahre Lage ist jetzt bekannt).
  const chosen = ctx.content.keywords.get(incident.keywordId);
  const correct = ctx.content.keywords.get(d?.keyword ?? '');
  const chosenHasDoctor = chosen?.aao.some((a) => ctx.content.doctorTypes.has(a.type)) ?? false;
  if (chosen && correct) {
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
  ctx.state.incidents = ctx.state.incidents.filter(
    (i) => i.status !== 'closed' || (i.closedAt ?? 0) > ctx.state.time - KEEP_CLOSED_MS,
  );
}

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
