/**
 * Wiederkehrende Personen und Adressen (ADR-0018): Vielanrufer, Stammpatienten und
 * Gefahrenadressen. Die Region bekommt ein Gedächtnis: Die Leitstelle sieht die Einsatzhistorie
 * einer Adresse und erkennt bekannte Rufnummern.
 */
import { pickCumulative, rangeInt, type Ctx } from '../context';
import { MS_PER_MINUTE } from '../time';
import type { AddressHistory, IncidentState, PersonState, Truth, VehicleState } from '../types';
import { radio } from './vehicles';

/** So viele Adressen behält die Historie (älteste fallen heraus). */
const HISTORY_LIMIT = 400;

function phone(ctx: Ctx): string {
  const rng = ctx.rng.callers;
  const digits = () => rng.nextInt(0, 9).toString();
  return `0${rng.pick(['5671', '5672', '5675', '5678'])} ${Array.from({ length: 5 }, digits).join('')}`;
}

/** Bekannte Personen entstehen einmal je Spiel – aus dem Seed, also reproduzierbar. */
export function initialPersons(ctx: Ctx): PersonState[] {
  const s = ctx.content.bundle.settings.persons;
  const rng = ctx.rng.callers;
  const out: PersonState[] = [];
  const add = (kind: PersonState['kind'], diagnoses: readonly string[], count: number) => {
    if (diagnoses.length === 0) return;
    for (let i = 0; i < count; i++) {
      out.push({
        id: `P${(out.length + 1).toString()}`,
        kind,
        addressId: ctx.world.houseIds[pickCumulative(rng, ctx.world.houseWeights)] ?? 0,
        callback: phone(ctx),
        diagnosisId: rng.pick(diagnoses),
        calls: 0,
      });
    }
  };
  add('frequent', s.frequentDiagnoses, s.frequent);
  add('regular', s.regularDiagnoses, s.regular);
  add('danger', s.dangerDiagnoses, s.danger);
  return out;
}

/** Ruft gerade eine bekannte Person an? */
export function pickPerson(ctx: Ctx): PersonState | undefined {
  const persons = ctx.state.persons;
  if (persons.length === 0 || ctx.config.tutorial) return undefined;
  if (!ctx.rng.calls.chance(ctx.content.bundle.settings.persons.share)) return undefined;
  return ctx.rng.calls.pick(persons);
}

/** Wahre Lage für den Anruf einer bekannten Person (Krankheitsbild, Adresse, Gefahr). */
export function personTruth(person: PersonState, base: Truth): Truth {
  person.calls++;
  return {
    ...base,
    addressId: person.addressId,
    personId: person.id,
    ...(person.kind === 'danger' ? { danger: true } : {}),
  };
}

export function personOf(ctx: Pick<Ctx, 'state'>, truth: Truth): PersonState | undefined {
  return truth.personId !== undefined
    ? ctx.state.persons.find((p) => p.id === truth.personId)
    : undefined;
}

/** Einsatz abgeschlossen: Adresse merkt sich Zahl, Stichwort und Hinweise. */
export function recordHistory(ctx: Ctx, incident: IncidentState): void {
  if (incident.order || incident.callKind !== 'emergency') return;
  const key = incident.truth.addressId.toString();
  const h: AddressHistory = ctx.state.addressHistory[key] ?? {
    count: 0,
    lastAt: 0,
    keywords: [],
    flags: [],
  };
  h.count++;
  h.lastAt = ctx.state.time;
  h.keywords = [incident.keywordId, ...h.keywords].slice(0, 3);
  const person = personOf(ctx, incident.truth);
  if (incident.truth.danger && !h.flags.includes('danger')) h.flags.push('danger');
  if (person?.kind === 'frequent' && !h.flags.includes('frequent')) h.flags.push('frequent');
  ctx.state.addressHistory[key] = h;
  const keys = Object.keys(ctx.state.addressHistory);
  if (keys.length > HISTORY_LIMIT) {
    // Älteste Einträge entfernen – über eine neue Zuordnung statt dynamischem delete.
    const keep = keys
      .map((k) => [k, ctx.state.addressHistory[k]] as const)
      .sort((a, b) => (b[1]?.lastAt ?? 0) - (a[1]?.lastAt ?? 0))
      .slice(0, HISTORY_LIMIT);
    ctx.state.addressHistory = Object.fromEntries(keep) as Record<string, AddressHistory>;
  }
}

/**
 * Gefahrenadresse: Ohne verständigte Polizei warten die Kräfte vor Ort, bis sie eintrifft.
 * Liefert die Wartezeit in ms (0 = keine Gefahr oder Polizei schon da).
 */
export function policeDelay(ctx: Ctx, incident: IncidentState, v: VehicleState): number {
  if (!incident.truth.danger || incident.policeRequested) return 0;
  radio(ctx, v, 'waitingForPolice');
  return (
    rangeInt(ctx.rng.crews, ctx.content.bundle.settings.persons.policeWaitMinutes) * MS_PER_MINUTE
  );
}
