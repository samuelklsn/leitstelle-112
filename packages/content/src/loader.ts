import { parse } from 'yaml';
import { z } from 'zod';
import {
  Diagnosis,
  Hospital,
  Keyword,
  RegionConfig,
  Settings,
  Station,
  VehicleType,
  type ContentBundle,
} from './schema';

/** Eine Inhaltsdatei: relativer Pfad und Text (YAML oder JSON). */
export interface ContentFile {
  readonly path: string;
  readonly text: string;
}

export interface ContentProblem {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export class ContentError extends Error {
  constructor(readonly problems: readonly ContentProblem[]) {
    super(
      `Inhalte ungültig (${problems.length.toString()} Fehler):\n` +
        problems.map((p) => `  ${p.file}${p.path ? ` › ${p.path}` : ''}: ${p.message}`).join('\n'),
    );
    this.name = 'ContentError';
  }
}

/**
 * Jede Datei hat einen Typ-Schlüssel auf oberster Ebene. So kann ein Mod beliebig viele Dateien
 * mitbringen, ohne Dateinamen-Konventionen.
 */
const FileSchema = z
  .object({
    region: RegionConfig.optional(),
    vehicleTypes: z.array(VehicleType).optional(),
    stations: z.array(Station).optional(),
    hospitals: z.array(Hospital).optional(),
    keywords: z.array(Keyword).optional(),
    diagnoses: z.array(Diagnosis).optional(),
    settings: Settings.optional(),
  })
  .strict();

/** Lädt, validiert und verknüpft Inhalte. Wirft {@link ContentError} mit allen Fehlern. */
export function loadContent(files: readonly ContentFile[]): ContentBundle {
  const problems: ContentProblem[] = [];
  const merged = {
    region: undefined as RegionConfig | undefined,
    vehicleTypes: [] as VehicleType[],
    stations: [] as Station[],
    hospitals: [] as Hospital[],
    keywords: [] as Keyword[],
    diagnoses: [] as Diagnosis[],
    settings: undefined as Settings | undefined,
  };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    let raw: unknown;
    try {
      raw = parse(file.text);
    } catch (error) {
      problems.push({ file: file.path, path: '', message: `Syntaxfehler: ${String(error)}` });
      continue;
    }
    const result = FileSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push({ file: file.path, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    const data = result.data;
    if (data.region) {
      if (merged.region)
        problems.push({ file: file.path, path: 'region', message: 'Region doppelt definiert' });
      merged.region = data.region;
    }
    if (data.settings) merged.settings = data.settings;
    merged.vehicleTypes.push(...(data.vehicleTypes ?? []));
    merged.stations.push(...(data.stations ?? []));
    merged.hospitals.push(...(data.hospitals ?? []));
    merged.keywords.push(...(data.keywords ?? []));
    merged.diagnoses.push(...(data.diagnoses ?? []));
  }

  if (!merged.region)
    problems.push({ file: '*', path: 'region', message: 'Keine Region definiert' });
  if (!merged.settings)
    problems.push({ file: '*', path: 'settings', message: 'Keine Einstellungen definiert' });
  if (problems.length > 0 || !merged.region || !merged.settings) throw new ContentError(problems);

  const bundle: ContentBundle = { ...merged, region: merged.region, settings: merged.settings };
  const refProblems = checkReferences(bundle);
  if (refProblems.length > 0) throw new ContentError(refProblems);
  return bundle;
}

/** Zweite Stufe: Querverweise und Eindeutigkeit (ADR-0009). */
export function checkReferences(c: ContentBundle): ContentProblem[] {
  const problems: ContentProblem[] = [];
  const unique = (kind: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push({ file: kind, path: id, message: 'ID ist nicht eindeutig' });
      seen.add(id);
    }
    return seen;
  };
  const types = unique(
    'vehicleTypes',
    c.vehicleTypes.map((v) => v.id),
  );
  const keywords = unique(
    'keywords',
    c.keywords.map((k) => k.id),
  );
  unique(
    'stations',
    c.stations.map((s) => s.id),
  );
  unique(
    'hospitals',
    c.hospitals.map((h) => h.id),
  );
  unique(
    'diagnoses',
    c.diagnoses.map((d) => d.id),
  );
  unique(
    'vehicles',
    c.stations.flatMap((s) => s.vehicles.map((v) => v.id)),
  );
  const towns = unique(
    'towns',
    c.region.towns.map((t) => t.id),
  );

  const inside = (file: string, id: string, [x, y]: readonly [number, number]) => {
    if (x < 0 || y < 0 || x > c.region.size.width || y > c.region.size.height) {
      problems.push({ file, path: id, message: 'Position liegt außerhalb der Region' });
    }
  };
  for (const s of c.stations) {
    inside('stations', s.id, s.position);
    for (const v of s.vehicles) {
      if (!types.has(v.type))
        problems.push({
          file: 'stations',
          path: `${s.id}.${v.id}`,
          message: `Unbekannter Fahrzeugtyp ${v.type}`,
        });
    }
  }
  for (const h of c.hospitals) inside('hospitals', h.id, h.position);
  for (const k of c.keywords) {
    for (const a of k.aao) {
      if (!types.has(a.type))
        problems.push({
          file: 'keywords',
          path: k.id,
          message: `AAO verweist auf unbekannten Fahrzeugtyp ${a.type}`,
        });
    }
  }
  for (const d of c.diagnoses) {
    if (!keywords.has(d.keyword))
      problems.push({
        file: 'diagnoses',
        path: d.id,
        message: `Unbekanntes Stichwort ${d.keyword}`,
      });
    if (d.department && !c.hospitals.some((h) => h.departments.includes(d.department as never))) {
      problems.push({
        file: 'diagnoses',
        path: d.id,
        message: `Keine Klinik mit Abteilung ${d.department}`,
      });
    }
  }
  for (const r of c.region.roads) {
    for (const p of r.path) {
      if (typeof p === 'string' && !towns.has(p))
        problems.push({ file: 'region', path: r.name, message: `Unbekannter Ort ${p}` });
    }
  }
  for (const e of c.region.motorway?.exits ?? []) {
    if (!towns.has(e.to))
      problems.push({ file: 'region', path: e.name, message: `Unbekannter Ort ${e.to}` });
  }
  if (c.diagnoses.length === 0)
    problems.push({ file: 'diagnoses', path: '', message: 'Keine Krankheitsbilder definiert' });
  return problems;
}
