import { parse } from 'yaml';
import { z } from 'zod';
import {
  Climate,
  Diagnosis,
  FireScenario,
  HilfsfristPreset,
  Holiday,
  Hospital,
  MciScenario,
  ModManifest,
  TrainingScenario,
  type ModInfo,
  Keyword,
  RegionConfig,
  Settings,
  Station,
  TransportOrder,
  VehicleType,
  Weather,
  WorldEvent,
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
    fireScenarios: z.array(FireScenario).optional(),
    transportOrders: z.array(TransportOrder).optional(),
    weather: z.array(Weather).optional(),
    climate: z.array(Climate).optional(),
    worldEvents: z.array(WorldEvent).optional(),
    holidays: z.array(Holiday).optional(),
    mciScenarios: z.array(MciScenario).optional(),
    scenarios: z.array(TrainingScenario).optional(),
    hilfsfristPresets: z.array(HilfsfristPreset).optional(),
    settings: Settings.optional(),
    /** Steckbrief eines Mods (ADR-0019). */
    mod: ModManifest.optional(),
    /** Einzelne Einstellungen überschreiben, ohne alle anzugeben (nur in Mods). */
    settingsOverride: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** Eine Schicht von Inhalten: Basis oder ein Mod. Spätere Schichten ersetzen gleiche IDs. */
export interface ContentLayer {
  readonly id: string;
  readonly files: readonly ContentFile[];
}

type Lists = Omit<ContentBundle, 'region' | 'settings' | 'mods'>;
const LIST_KEYS = [
  'vehicleTypes',
  'stations',
  'hospitals',
  'keywords',
  'diagnoses',
  'fireScenarios',
  'transportOrders',
  'weather',
  'climate',
  'worldEvents',
  'holidays',
  'mciScenarios',
  'scenarios',
  'hilfsfristPresets',
] as const satisfies readonly (keyof Lists)[];

/** Schlüssel eines Eintrags: ID, bei Klima der Monat, bei Feiertagen der Name. */
function keyOf(item: unknown): string {
  const o = item as { id?: unknown; month?: unknown; name?: unknown };
  if (typeof o.id === 'string') return o.id;
  if (typeof o.month === 'number') return `monat-${o.month.toString()}`;
  return typeof o.name === 'string' ? o.name : JSON.stringify(item);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Tiefe Zusammenführung: Objekte rekursiv, alles andere (auch Listen) ersetzt. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

interface ParsedLayer {
  lists: { [K in (typeof LIST_KEYS)[number]]: Lists[K][number][] };
  region?: RegionConfig;
  settings?: Settings;
  override?: Record<string, unknown>;
  mod?: ModInfo;
}

function parseLayer(layer: ContentLayer, problems: ContentProblem[]): ParsedLayer {
  const lists = Object.fromEntries(LIST_KEYS.map((k) => [k, []])) as unknown as ParsedLayer['lists'];
  const parsed: ParsedLayer = { lists };
  for (const file of [...layer.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const name = layer.id === 'base' ? file.path : `${layer.id}/${file.path}`;
    let raw: unknown;
    try {
      raw = parse(file.text);
    } catch (error) {
      problems.push({ file: name, path: '', message: `Syntaxfehler: ${String(error)}` });
      continue;
    }
    const result = FileSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push({ file: name, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    const data = result.data;
    if (data.region) {
      if (parsed.region)
        problems.push({ file: name, path: 'region', message: 'Region doppelt definiert' });
      parsed.region = data.region;
    }
    if (data.settings) parsed.settings = data.settings;
    if (data.settingsOverride)
      parsed.override = deepMerge(parsed.override ?? {}, data.settingsOverride) as Record<
        string,
        unknown
      >;
    if (data.mod) parsed.mod = { ...data.mod, id: data.mod.id };
    for (const key of LIST_KEYS) {
      const items = data[key] as unknown[] | undefined;
      if (items) (lists[key] as unknown[]).push(...items);
    }
  }
  return parsed;
}

/**
 * Lädt Inhalte in Schichten (ADR-0019): zuerst die Basis, dann Mods. Ein Mod ergänzt neue Einträge
 * und ersetzt Einträge mit gleicher ID; Einstellungen ändert er gezielt über `settingsOverride`.
 * Innerhalb einer Schicht müssen IDs eindeutig sein.
 */
export function loadContentLayers(layers: readonly ContentLayer[]): ContentBundle {
  const problems: ContentProblem[] = [];
  const parsed = layers.map((l) => parseLayer(l, problems));
  const first = parsed[0];
  if (!first) throw new ContentError([{ file: '*', path: '', message: 'Keine Inhalte' }]);
  const lists = Object.fromEntries(
    LIST_KEYS.map((k) => [k, [...(first.lists[k] as unknown[])]]),
  ) as unknown as ParsedLayer['lists'];
  let region = first.region;
  let settings: unknown = first.settings;
  const mods: ModInfo[] = [];
  for (const layer of parsed) {
    if (layer !== first) {
      for (const key of LIST_KEYS) {
        const target = lists[key] as unknown[];
        for (const item of layer.lists[key] as unknown[]) {
          const i = target.findIndex((x) => keyOf(x) === keyOf(item));
          if (i >= 0) target[i] = item;
          else target.push(item);
        }
      }
      if (layer.region) region = layer.region;
      if (layer.settings) settings = layer.settings;
    }
    if (layer.override) settings = deepMerge(settings, layer.override);
    if (layer.mod) mods.push(layer.mod);
  }
  if (!region) problems.push({ file: '*', path: 'region', message: 'Keine Region definiert' });
  if (settings === undefined)
    problems.push({ file: '*', path: 'settings', message: 'Keine Einstellungen definiert' });
  const checked = Settings.safeParse(settings);
  if (settings !== undefined && !checked.success) {
    for (const issue of checked.error.issues)
      problems.push({ file: 'settingsOverride', path: issue.path.join('.'), message: issue.message });
  }
  if (problems.length > 0 || !region || !checked.success) throw new ContentError(problems);
  const bundle: ContentBundle = { ...lists, region, settings: checked.data, mods };
  const refProblems = checkReferences(bundle);
  if (refProblems.length > 0) throw new ContentError(refProblems);
  return bundle;
}

/** Lädt, validiert und verknüpft Inhalte. Wirft {@link ContentError} mit allen Fehlern. */
export function loadContent(files: readonly ContentFile[]): ContentBundle {
  return loadContentLayers([{ id: 'base', files }]);
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
  const hospitals = unique(
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
  for (const h of c.hospitals) {
    inside('hospitals', h.id, h.position);
    for (const dept of Object.keys(h.beds)) {
      if (!h.departments.includes(dept as never))
        problems.push({ file: 'hospitals', path: h.id, message: `Betten ohne Abteilung ${dept}` });
    }
  }
  for (const s of c.stations) {
    for (const v of s.vehicles) {
      if (v.service && v.service.to <= v.service.from)
        problems.push({ file: 'stations', path: v.id, message: 'Dienstende vor Dienstbeginn' });
    }
  }
  for (const t of c.vehicleTypes) {
    if (t.transportClass && !t.canTransport)
      problems.push({ file: 'vehicleTypes', path: t.id, message: 'Transportklasse ohne Transport' });
  }
  unique('transportOrders', c.transportOrders.map((o) => o.id));
  for (const o of c.transportOrders) {
    if (!keywords.has(o.keyword))
      problems.push({ file: 'transportOrders', path: o.id, message: `Unbekanntes Stichwort ${o.keyword}` });
    for (const h of [...o.fromHospitals, ...o.toHospitals]) {
      if (!hospitals.has(h))
        problems.push({ file: 'transportOrders', path: o.id, message: `Unbekannte Klinik ${h}` });
    }
    if (o.fromHospitals.length === 0 && o.toHospitals.length === 0)
      problems.push({ file: 'transportOrders', path: o.id, message: 'Auftrag ohne Klinik' });
  }
  const checkNeeds = (file: string, id: string, needs: readonly { type: string; alternatives: readonly string[] }[]) => {
    for (const a of needs) {
      for (const t of [a.type, ...a.alternatives]) {
        if (!types.has(t)) problems.push({ file, path: id, message: `Unbekannter Fahrzeugtyp ${t}` });
      }
    }
  };
  for (const k of c.keywords) checkNeeds('keywords', k.id, k.aao);
  const scenarios = unique('fireScenarios', c.fireScenarios.map((s) => s.id));
  const diagnosisIds = new Set(c.diagnoses.map((d) => d.id));
  for (const s of c.fireScenarios) {
    checkNeeds('fireScenarios', s.id, s.needs);
    if (!keywords.has(s.keyword)) {
      problems.push({ file: 'fireScenarios', path: s.id, message: `Unbekanntes Stichwort ${s.keyword}` });
    }
    if (s.casualty && !diagnosisIds.has(s.casualty.diagnosis)) {
      problems.push({ file: 'fireScenarios', path: s.id, message: `Unbekanntes Krankheitsbild ${s.casualty.diagnosis}` });
    }
    if (s.escalation && !scenarios.has(s.escalation.to)) {
      problems.push({ file: 'fireScenarios', path: s.id, message: `Unbekannte Folgelage ${s.escalation.to}` });
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
  // Welt (ADR-0016): Wetterlagen, Klima, Ereignisse, Feiertage.
  const weatherIds = unique(
    'weather',
    c.weather.map((w) => w.id),
  );
  const scenarioIds = new Set(c.fireScenarios.map((s) => s.id));
  const checkMultipliers = (
    file: string,
    id: string,
    m: { diagnoses: Record<string, number>; fireScenarios: Record<string, number> },
  ) => {
    for (const d of Object.keys(m.diagnoses))
      if (!diagnosisIds.has(d))
        problems.push({ file, path: id, message: `Unbekanntes Krankheitsbild ${d}` });
    for (const s of Object.keys(m.fireScenarios))
      if (!scenarioIds.has(s))
        problems.push({ file, path: id, message: `Unbekannte Feuerwehrlage ${s}` });
  };
  for (const w of c.weather) checkMultipliers('weather', w.id, w);
  unique(
    'worldEvents',
    c.worldEvents.map((e) => e.id),
  );
  for (const e of c.worldEvents) {
    checkMultipliers('worldEvents', e.id, e);
    if (!e.date && e.perDay === 0)
      problems.push({ file: 'worldEvents', path: e.id, message: 'Weder Datum noch perDay' });
  }
  if (c.weather.length > 0) {
    for (let m = 1; m <= 12; m++) {
      const entry = c.climate.find((x) => x.month === m);
      if (!entry) {
        problems.push({ file: 'climate', path: m.toString(), message: 'Monat fehlt' });
        continue;
      }
      for (const w of Object.keys(entry.weather))
        if (!weatherIds.has(w))
          problems.push({ file: 'climate', path: m.toString(), message: `Unbekanntes Wetter ${w}` });
    }
  }
  for (const h of c.holidays) {
    if ((h.date === undefined) === (h.easterOffset === undefined))
      problems.push({
        file: 'holidays',
        path: h.name,
        message: 'Genau eins von date oder easterOffset angeben',
      });
  }
  const airTypes = new Set(c.vehicleTypes.filter((t) => t.air).map((t) => t.id));
  for (const s of c.stations)
    for (const v of s.vehicles)
      if ((airTypes.has(v.type) || v.service?.daylight) && !c.settings.daylight)
        problems.push({ file: 'stations', path: v.id, message: 'Tageslicht-Tabelle fehlt' });
  // Großlagen (ADR-0017).
  unique(
    'mciScenarios',
    c.mciScenarios.map((s) => s.id),
  );
  for (const s of c.mciScenarios) {
    if (!keywords.has(s.keyword))
      problems.push({ file: 'mciScenarios', path: s.id, message: `Unbekanntes Stichwort ${s.keyword}` });
    for (const d of [...s.diagnoses.red, ...s.diagnoses.yellow, ...s.diagnoses.green])
      if (!diagnosisIds.has(d))
        problems.push({ file: 'mciScenarios', path: s.id, message: `Unbekanntes Krankheitsbild ${d}` });
    if (s.fire) checkNeeds('mciScenarios', s.id, s.fire.needs);
    for (const w of Object.keys(s.weather))
      if (!weatherIds.has(w))
        problems.push({ file: 'mciScenarios', path: s.id, message: `Unbekanntes Wetter ${w}` });
  }
  // Trainingsszenarien und Hilfsfrist-Presets (ADR-0019).
  unique(
    'scenarios',
    c.scenarios.map((x) => x.id),
  );
  const mciIds = new Set(c.mciScenarios.map((m) => m.id));
  for (const sc of c.scenarios) {
    if (sc.weather && !weatherIds.has(sc.weather))
      problems.push({ file: 'scenarios', path: sc.id, message: 'Unbekanntes Wetter ' + sc.weather });
    for (const e of sc.events)
      if (!c.worldEvents.some((w) => w.id === e))
        problems.push({ file: 'scenarios', path: sc.id, message: 'Unbekanntes Ereignis ' + e });
    for (const call of sc.calls) {
      const kinds = [call.diagnosis, call.fire, call.mci].filter((x) => x !== undefined);
      if (kinds.length !== 1)
        problems.push({ file: 'scenarios', path: sc.id, message: 'Je Notruf genau eins von diagnosis, fire oder mci' });
      if (call.diagnosis && !diagnosisIds.has(call.diagnosis))
        problems.push({ file: 'scenarios', path: sc.id, message: 'Unbekanntes Krankheitsbild ' + call.diagnosis });
      if (call.fire && !scenarioIds.has(call.fire))
        problems.push({ file: 'scenarios', path: sc.id, message: 'Unbekannte Feuerwehrlage ' + call.fire });
      if (call.mci && !mciIds.has(call.mci))
        problems.push({ file: 'scenarios', path: sc.id, message: 'Unbekannte Großlage ' + call.mci });
      if (call.town && !towns.has(call.town))
        problems.push({ file: 'scenarios', path: sc.id, message: 'Unbekannter Ort ' + call.town });
    }
  }
  unique(
    'hilfsfristPresets',
    c.hilfsfristPresets.map((x) => x.id),
  );
  if (c.diagnoses.length === 0)
    problems.push({ file: 'diagnoses', path: '', message: 'Keine Krankheitsbilder definiert' });
  return problems;
}
