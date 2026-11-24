/**
 * Inhalts-Schemas (ADR-0009). Einzige Definition der Datenformate; TypeScript-Typen werden daraus
 * abgeleitet, JSON-Schemas für Modder ebenfalls. Alle fachlichen Annahmen sind hier *Daten*,
 * nicht Code – Herleitung in docs/domain/.
 */
import { z } from 'zod';

/** Namensraum-ID, z. B. `base:rtw` oder `meinmod:hlf20`. */
export const Id = z
  .string()
  .regex(/^[a-z0-9_-]+:[a-z0-9_.-]+$/, 'ID im Format namensraum:name erwartet (Kleinbuchstaben)');

const Point = z.tuple([z.number(), z.number()]);
const Range = z
  .tuple([z.number().nonnegative(), z.number().nonnegative()])
  .refine(([a, b]) => a <= b, 'Bereich [min, max] mit min ≤ max erwartet');
const Probability = z.number().min(0).max(1);

// ---------------------------------------------------------------- Region

export const TownKind = z.enum(['kreisstadt', 'stadt', 'gemeinde']);

export const Town = z.object({
  id: Id,
  name: z.string().min(1),
  kind: TownKind,
  x: z.number(),
  y: z.number(),
  /** Radius der bebauten Fläche in Metern. */
  radius: z.number().min(150).max(5000),
  /** Blockgröße des Straßenrasters in Metern. */
  blockSize: z.number().min(60).max(300),
  rotationDeg: z.number().min(-90).max(90).default(0),
  population: z.number().int().positive(),
  /** Jede n-te Querstraße darf den Fluss überqueren (Brücke). */
  bridgeEvery: z.number().int().min(1).default(6),
  /** Namen der beiden Hauptachsen. */
  mainStreets: z.tuple([z.string(), z.string()]).default(['Hauptstraße', 'Bahnhofstraße']),
});

export const RoadClassName = z.enum(['bundesstrasse', 'landesstrasse', 'kreisstrasse']);

export const Road = z.object({
  name: z.string().min(1),
  roadClass: RoadClassName,
  /** Folge aus Orts-IDs (Anschluss an den Ortsrand) und freien Stützpunkten [x, y]. */
  path: z.array(z.union([Id, Point])).min(2),
});

export const Motorway = z.object({
  name: z.string().min(1),
  points: z.array(Point).min(2),
  exits: z.array(
    z.object({
      name: z.string(),
      at: Point,
      to: Id,
      roadName: z.string(),
      roadClass: RoadClassName,
    }),
  ),
});

export const RegionConfig = z.object({
  id: Id,
  name: z.string(),
  /** Name der Leitstelle für die Oberfläche. */
  center: z.string(),
  seed: z.number().int().min(0).max(0xffffffff),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }),
  geo: z.object({
    originLon: z.number().min(-180).max(180),
    originLat: z.number().min(-85).max(85),
    metersPerDegLon: z.number().positive(),
    metersPerDegLat: z.number().positive(),
  }),
  /** Pflicht-Attribution, falls Daten aus Fremdquellen (z. B. OSM) stammen. */
  attribution: z.string().optional(),
  towns: z.array(Town).min(1),
  roads: z.array(Road).default([]),
  motorway: Motorway.optional(),
  river: z
    .object({ name: z.string(), points: z.array(Point).min(2), width: z.number().positive() })
    .optional(),
  forests: z
    .array(z.object({ name: z.string().optional(), points: z.array(Point).min(3) }))
    .default([]),
});

// ---------------------------------------------------------------- Fahrzeuge, Wachen, Kliniken

export const VehicleType = z.object({
  id: Id,
  /** Kurzbezeichnung, z. B. „RTW". */
  short: z.string().min(1).max(8),
  name: z.string(),
  canTransport: z.boolean(),
  /** Bringt einen Notarzt mit. */
  doctor: z.boolean().default(false),
  /** Funkrufname-Kennzahl, z. B. 83 für RTW. */
  radioCode: z.number().int().min(1).max(99),
});

export const Station = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(['rettungswache', 'notarztstandort', 'feuerwache']),
  position: Point,
  vehicles: z
    .array(
      z.object({
        id: Id,
        /** Funkrufname, z. B. „Rettung Brakenfeld 1/83-1". */
        callsign: z.string(),
        type: Id,
      }),
    )
    .min(1),
});

export const Department = z.enum([
  'innere',
  'chirurgie',
  'unfallchirurgie',
  'neurologie',
  'stroke',
  'herzkatheter',
  'paediatrie',
  'gynaekologie',
  'psychiatrie',
  'intensiv',
]);

export const Hospital = z.object({
  id: Id,
  name: z.string(),
  short: z.string().max(16),
  level: z.enum([
    'grundversorgung',
    'regelversorgung',
    'schwerpunktversorgung',
    'maximalversorgung',
  ]),
  position: Point,
  departments: z.array(Department).min(1),
});

// ---------------------------------------------------------------- Einsätze

export const Keyword = z.object({
  id: Id,
  /** Anzeige, z. B. „RD 2". */
  code: z.string(),
  name: z.string(),
  description: z.string(),
  /** 1 = höchste Dringlichkeit. */
  priority: z.number().int().min(1).max(3),
  emergency: z.boolean(),
  /** Alarm- und Ausrückeordnung: Fahrzeugtypen und Anzahl. */
  aao: z.array(z.object({ type: Id, count: z.number().int().min(1) })).min(1),
});

export const Tracer = z.enum(['none', 'acs', 'stroke', 'trauma', 'cardiac_arrest']);

export const Diagnosis = z.object({
  id: Id,
  name: z.string(),
  /** Relative Häufigkeit innerhalb aller Notrufe. */
  weight: z.number().positive(),
  ageRange: Range,
  /** NACA-Score-Bereich (1–7). */
  naca: Range,
  tracer: Tracer.default('none'),
  /** Fachlich angemessenes Stichwort. */
  keyword: Id,
  /** Wahrscheinlichkeit einer Notarzt-Indikation, die sich erst vor Ort zeigt. */
  doctorNeeded: Probability,
  /** Wahrscheinlichkeit eines Transports. */
  transport: Probability,
  /** Benötigte Fachabteilung der Zielklinik. */
  department: Department.optional(),
  /** Behandlungszeit vor Ort in Minuten. */
  onSceneMinutes: Range,
  /** Einsatzort draußen auf der Straße (z. B. Verkehrsunfall) statt in einem Gebäude. */
  outdoor: z.boolean().default(false),
  /** Meldebilder, wie Anrufer die Lage schildern (i18n-Schlüssel) und deren Gewicht. */
  reports: z.array(z.object({ key: z.string(), weight: z.number().positive() })).min(1),
});

// ---------------------------------------------------------------- Einstellungen

export const Settings = z.object({
  hilfsfrist: z.object({
    label: z.string(),
    minutes: z.number().positive(),
    targetQuota: Probability,
    source: z.string(),
  }),
  shift: z.object({
    startHour: z.number().int().min(0).max(23),
    hours: z.number().int().min(1).max(24),
  }),
  calls: z.object({
    /** Notrufe pro Stunde je 100.000 Einwohner im Tagesmittel. */
    ratePer100k: z.number().positive(),
    hourlyProfile: z.array(z.number().nonnegative()).length(24),
    abandonAfterSeconds: Range,
  }),
  times: z.object({
    /** Ausrückzeit von der Wache tagsüber / nachts (Sekunden). */
    turnoutDaySeconds: Range,
    turnoutNightSeconds: Range,
    /** Reaktionszeit, wenn das Fahrzeug bereits frei auf der Straße ist. */
    turnoutMobileSeconds: Range,
    handoverMinutes: Range,
    /** Ohne Zielklinik-Zuweisung entscheidet die Besatzung nach dieser Zeit selbst. */
    destinationTimeoutSeconds: z.number().positive(),
    callbackSeconds: Range,
  }),
  caller: z.object({
    /** Wahrscheinlichkeiten für ungenaue Adressangaben. */
    wrongHouseNumber: Probability,
    missingTown: Probability,
    /** Anteil der Anrufer, die die Lage unter- bzw. überschätzen. */
    misjudge: Probability,
  }),
});

export type RegionConfig = z.infer<typeof RegionConfig>;
export type Town = z.infer<typeof Town>;
export type Road = z.infer<typeof Road>;
export type VehicleType = z.infer<typeof VehicleType>;
export type Station = z.infer<typeof Station>;
export type Hospital = z.infer<typeof Hospital>;
export type Department = z.infer<typeof Department>;
export type Keyword = z.infer<typeof Keyword>;
export type Diagnosis = z.infer<typeof Diagnosis>;
export type Tracer = z.infer<typeof Tracer>;
export type Settings = z.infer<typeof Settings>;

/** Vollständiger, validierter Inhaltsstand, den die Simulation erhält. */
export interface ContentBundle {
  readonly region: RegionConfig;
  readonly vehicleTypes: readonly VehicleType[];
  readonly stations: readonly Station[];
  readonly hospitals: readonly Hospital[];
  readonly keywords: readonly Keyword[];
  readonly diagnoses: readonly Diagnosis[];
  readonly settings: Settings;
}
