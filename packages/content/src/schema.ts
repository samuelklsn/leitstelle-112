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

const Int = z.number().int().nonnegative();

/**
 * Fertig aufgebaute Welt aus einem Regionspaket (ADR-0020), z. B. aus OpenStreetMap. Kompakt als
 * Tupel, weil echte Landkreise Zehntausende Knoten und Adressen haben.
 */
export const PrebuiltWorld = z.object({
  /** Knoten [x, y] in Metern. */
  nodes: z.array(Point),
  /** Straßenstücke [von, nach, Straßenklasse 0–6, Straße, Einbahn 0/1]. */
  segments: z.array(z.tuple([Int, Int, z.number().int().min(0).max(6), Int, z.number().int().min(0).max(1)])),
  streets: z.array(
    z.object({ name: z.string(), town: Id.nullable(), roadClass: z.number().int().min(0).max(6) }),
  ),
  /** Hausadressen [Straße, Hausnummer, Ort, x, y, Anfahrtsknoten]. */
  addresses: z.array(z.tuple([Int, z.string(), Id, z.number(), z.number(), Int])),
  /** Einsatzorte im Freien [Straße, Ort A, Ort B, Knoten]. */
  roadSections: z.array(z.tuple([Int, Id, Id, Int])).default([]),
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
  /** Echte Region: Straßennetz und Adressen kommen fertig aus dem Region-Builder (ADR-0020). */
  prebuilt: PrebuiltWorld.optional(),
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
  /**
   * Wofür das Fahrzeug Patienten transportiert (ADR-0015): Nur `notfall` fährt Notfallpatienten
   * und zählt für die Hilfsfrist; `krankentransport` (KTW) und `intensiv` (ITW) für Aufträge.
   */
  transportClass: z.enum(['notfall', 'krankentransport', 'intensiv']).optional(),
  /** Luftrettungsmittel (RTH): fliegt Luftlinie, nur bei Tageslicht und Flugwetter. */
  air: z.boolean().default(false),
  /**
   * Führungs- und Sonderrolle bei Großlagen (ADR-0017): Leitender Notarzt (sichtet), Organisatorischer
   * Leiter (Bereitstellungsraum), Gerätewagen Sanität (versorgt Leichtverletzte vor Ort).
   */
  role: z.enum(['lna', 'orgl', 'gwsan']).optional(),
});

/** Dienstzeit eines Fahrzeugs (volle Stunden, Ortszeit); ohne Angabe rund um die Uhr. */
export const Service = z.object({
  from: z.number().int().min(0).max(23).default(0),
  to: z.number().int().min(1).max(24).default(24),
  /** Nur montags bis freitags besetzt (nicht an Feiertagen). */
  weekdaysOnly: z.boolean().default(false),
  /** Nur bei Tageslicht (Luftrettung) – Zeiten je Monat aus den Einstellungen. */
  daylight: z.boolean().default(false),
});

export const Station = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(['rettungswache', 'notarztstandort', 'feuerwache', 'luftrettung']),
  position: Point,
  /**
   * Eigene Ausrückzeit (Sekunden) – z. B. Freiwillige Feuerwehr: Alarm über Meldeempfänger,
   * Anfahrt zum Gerätehaus, Ausrücken. Ohne Angabe gelten die allgemeinen Einstellungen.
   */
  turnout: z.object({ day: Range, night: Range }).optional(),
  /** Reserve (SEG, Einsatzleitung): nur bei Großlagen vorgeschlagen. */
  reserve: z.boolean().default(false),
  vehicles: z
    .array(
      z.object({
        id: Id,
        /** Funkrufname, z. B. „Rettung Brakenfeld 1/83-1". */
        callsign: z.string(),
        type: Id,
        service: Service.optional(),
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
  'geriatrie',
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
  /**
   * Freie Aufnahmeplätze für Notfallpatienten je Abteilung (ADR-0015). Abteilungen ohne Angabe
   * nehmen immer auf. Ist kein Platz frei, meldet sich die Abteilung ab.
   */
  beds: z.partialRecord(Department, z.number().int().min(1)).default({}),
});

// ---------------------------------------------------------------- Einsätze

/** Bedarf an Fahrzeugen eines Typs; Ersatztypen zählen mit (z. B. LF statt HLF). */
export const UnitNeed = z.object({
  type: Id,
  count: z.number().int().min(1),
  alternatives: z.array(Id).default([]),
});

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
  aao: z.array(UnitNeed).min(1),
  /** Nur für Transportaufträge, nicht für die Notrufabfrage (ADR-0015). */
  planned: z.boolean().default(false),
  /** Stichwort für einen Massenanfall von Verletzten oder eine Großlage (ADR-0017). */
  mci: z.boolean().default(false),
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
  /** Kommt nur als Verletzter einer Feuerwehrlage vor, nicht als eigener Notruf. */
  onlyAsCasualty: z.boolean().default(false),
  /** Wahrscheinlichkeit einer Infektion, nach der das Fahrzeug desinfiziert werden muss. */
  infectious: Probability.default(0),
});

/**
 * Vorlage für einen Transportauftrag (Krankentransport, Verlegung, Intensivverlegung). Aufträge
 * kommen nicht über die 112, sondern von Praxen, Kliniken und Pflegeheimen – oft mit Termin.
 */
export const TransportOrder = z.object({
  id: Id,
  name: z.string(),
  weight: z.number().positive(),
  /** Stichwort mit der AAO, z. B. KTP mit KTW. */
  keyword: Id,
  /** Abholung zu Hause (Wohnadresse) oder in einer dieser Kliniken. */
  fromHospitals: z.array(Id).default([]),
  /** Ziel: eine dieser Kliniken – ohne Angabe nach Hause (Entlassung). */
  toHospitals: z.array(Id).default([]),
  /** Der Auftrag geht so lange vor dem Abholtermin ein (Minuten; 0 = sofort). */
  leadMinutes: Range,
  /** Patient übernehmen bzw. übergeben (Minuten). */
  pickupMinutes: Range,
  handoverMinutes: Range,
  naca: Range,
  ageRange: Range,
  infectious: Probability.default(0),
});

/**
 * Brand- oder Hilfeleistungslage (die „wahre Lage" eines Feuerwehreinsatzes). Der Bedarf an
 * Kräften zeigt sich erst mit der Lagemeldung; ohne rechtzeitige Kräfte breitet sich die Lage aus.
 */
export const FireScenario = z.object({
  id: Id,
  name: z.string(),
  weight: z.number().positive(),
  kind: z.enum(['brand', 'th']),
  /** Fachlich angemessenes Stichwort. */
  keyword: Id,
  reports: z.array(z.object({ key: z.string(), weight: z.number().positive() })).min(1),
  outdoor: z.boolean().default(false),
  /** Kräfte, die zur Abarbeitung tatsächlich nötig sind. */
  needs: z.array(UnitNeed).min(1),
  /** Arbeitszeit vor Ort, sobald alle nötigen Kräfte da sind (Minuten). */
  workMinutes: Range,
  /** Verletzte Person (Krankheitsbild) mit Wahrscheinlichkeit. */
  casualty: z.object({ diagnosis: Id, probability: Probability }).optional(),
  /** Ohne Kräfte vor Ort breitet sich die Lage nach dieser Zeit aus (Minuten ab Notruf). */
  escalation: z.object({ after: Range, to: Id }).optional(),
});

// ---------------------------------------------------------------- Mods, Szenarien (ADR-0019)

/** Steckbrief eines Mods. */
export const ModManifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'nur Kleinbuchstaben, Ziffern und Bindestrich'),
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(20),
  author: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
  /**
   * Diese Listen der Basis vollständig ersetzen statt ergänzen – z. B. Wachen und Kliniken einer
   * echten Region, die mit dem fiktiven Landkreis nichts zu tun haben.
   */
  replaces: z
    .array(
      z.enum([
        'stations',
        'hospitals',
        'transportOrders',
        'scenarios',
        'worldEvents',
        'mciScenarios',
        'fireScenarios',
        'hilfsfristPresets',
      ]),
    )
    .default([]),
});

/** Hilfsfrist-Regel eines Landes mit Quelle (#32). */
export const HilfsfristPreset = z.object({
  id: Id,
  label: z.string(),
  minutes: z.number().positive(),
  targetQuota: Probability,
  /** Ab wann gemessen wird: Notrufeingang, Alarmierung oder Ausrücken (nur Fahrzeit). */
  measure: z.enum(['call', 'dispatch', 'departure']).default('call'),
  source: z.string(),
});

/**
 * Trainingsszenario: feste Startzeit und Wetter, geplante Notrufe und Ziele. Mit dem
 * Szenario-Editor lassen sich eigene Szenarien als Mod speichern.
 */
export const TrainingScenario = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  description: z.string().max(1000).default(''),
  startHour: z.number().int().min(0).max(23),
  month: z.number().int().min(1).max(12).optional(),
  weather: Id.optional(),
  /** Faktor auf das übrige Aufkommen (0 = nur die geplanten Notrufe). */
  callRateFactor: z.number().min(0).max(5).default(1),
  durationHours: z.number().positive().max(24).default(2),
  /** Ereignisse der Weltlage, die mit dem Szenario beginnen (z. B. Volksfest). */
  events: z.array(Id).default([]),
  calls: z
    .array(
      z.object({
        atMinutes: z.number().nonnegative(),
        diagnosis: Id.optional(),
        fire: Id.optional(),
        mci: Id.optional(),
        /** Ort des Einsatzes (sonst zufällig nach Einwohnern). */
        town: Id.optional(),
      }),
    )
    .default([]),
  goals: z
    .object({ hilfsfristQuota: Probability.optional(), maxErrors: z.number().int().nonnegative().optional() })
    .default({}),
});

// ---------------------------------------------------------------- Großlagen (ADR-0017)

/** Sichtungskategorien: T1 rot, T2 gelb, T3 grün, T4 blau/schwarz. */
export const Triage = z.object({
  red: z.number().nonnegative(),
  yellow: z.number().nonnegative(),
  green: z.number().nonnegative(),
  black: z.number().nonnegative(),
});

/** Massenanfall von Verletzten bzw. seltene Großlage (Busunfall, Zugunglück, Gefahrgut …). */
export const MciScenario = z.object({
  id: Id,
  name: z.string(),
  weight: z.number().positive(),
  /** Fachlich angemessenes Stichwort. */
  keyword: Id,
  reports: z.array(z.object({ key: z.string(), weight: z.number().positive() })).min(1),
  outdoor: z.boolean().default(true),
  /** Zahl der Betroffenen. */
  casualties: Range,
  /** Anteile der Sichtungskategorien. */
  triage: Triage,
  /** Anteil der Leichtverletzten, die ins Krankenhaus müssen (der Rest wird vor Ort versorgt). */
  greenTransport: Probability.default(0.5),
  /** Krankheitsbilder je Kategorie (bestimmen die Fachabteilung). */
  diagnoses: z.object({
    red: z.array(Id).min(1),
    yellow: z.array(Id).min(1),
    green: z.array(Id).min(1),
  }),
  /** Technische Rettung, Brandbekämpfung oder Gefahrgut: Kräfte und Arbeitszeit. */
  fire: z.object({ needs: z.array(UnitNeed).min(1), workMinutes: Range }).optional(),
  /** Häufigkeit je Wetterlage (z. B. Massenkarambolage bei Nebel und Glätte). */
  weather: z.record(Id, z.number().nonnegative()).default({}),
});

// ---------------------------------------------------------------- Welt (ADR-0016)

/** Faktoren je Krankheitsbild bzw. Feuerwehrlage (1 = unverändert). */
const Multipliers = z.record(Id, z.number().nonnegative()).default({});

/** Wetterlage mit ihren Auswirkungen auf Fahrzeiten, Aufkommen und Einsatzmix. */
export const Weather = z.object({
  id: Id,
  name: z.string(),
  /** Kurzzeichen für die Oberfläche. */
  symbol: z.string().max(4),
  /** Faktor auf die Fahrgeschwindigkeit (1 = trocken). */
  speed: z.number().positive().max(1),
  /** Faktor auf das Notrufaufkommen. */
  calls: z.number().positive(),
  /** Hubschrauber dürfen fliegen. */
  flyable: z.boolean(),
  /** Temperaturgrenzen der Wetterlage (Hitze ist heiß, Glätte kalt), °C. */
  minTemperature: z.number().optional(),
  maxTemperature: z.number().optional(),
  diagnoses: Multipliers,
  fireScenarios: Multipliers,
});

/** Klima je Monat: Temperaturbereich und Häufigkeit der Wetterlagen. */
export const Climate = z.object({
  month: z.number().int().min(1).max(12),
  /** Temperaturbereich in °C (auch unter null). */
  temperature: z.tuple([z.number(), z.number()]),
  weather: z.record(Id, z.number().nonnegative()),
});

/**
 * Ereignis der Weltlage (Volksfest, Grippewelle, Baustelle, Silvester). Entweder an einem festen
 * Datum oder zufällig in passenden Monaten und an passenden Wochentagen.
 */
export const WorldEvent = z.object({
  id: Id,
  name: z.string(),
  /** Festes Datum mit Startstunde (z. B. Silvester 18 Uhr). */
  date: z
    .object({
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
      hour: z.number().int().min(0).max(23),
    })
    .optional(),
  months: z.array(z.number().int().min(1).max(12)).default([]),
  weekdays: z.array(z.number().int().min(1).max(7)).default([]),
  /** Wahrscheinlichkeit, dass das Ereignis an einem passenden Tag beginnt. */
  perDay: Probability.default(0),
  startHour: Range.default([0, 23]),
  durationHours: Range,
  /** Findet in einem Ort statt; dorthin geht ein Teil der Notrufe. */
  town: z.boolean().default(false),
  minPopulation: z.number().nonnegative().default(0),
  localShare: Probability.default(0),
  calls: z.number().positive().default(1),
  diagnoses: Multipliers,
  fireScenarios: Multipliers,
  /** Sperrt einen Straßenabschnitt (Baustelle, Veranstaltung). */
  closure: z.boolean().default(false),
});

/** Gesetzlicher Feiertag: festes Datum oder Abstand zum Ostersonntag. */
export const Holiday = z.object({
  name: z.string(),
  date: z
    .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
    .optional(),
  easterOffset: z.number().int().min(-60).max(70).optional(),
});

// ---------------------------------------------------------------- Einstellungen

export const Settings = z.object({
  hilfsfrist: z.object({
    label: z.string(),
    minutes: z.number().positive(),
    targetQuota: Probability,
    /** Eintreffzeit der Feuerwehr (erstes Löschfahrzeug), Minuten. */
    fireMinutes: z.number().positive().default(10),
    /** Messbeginn: Notrufeingang, Alarmierung oder Ausrücken (#32). */
    measure: z.enum(['call', 'dispatch', 'departure']).default('call'),
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
    /** Faktor je Wochentag (Montag … Sonntag); Feiertage zählen als Sonntag. */
    weekdayFactor: z.array(z.number().positive()).length(7).default([1, 1, 1, 1, 1, 1, 1]),
    abandonAfterSeconds: Range,
    /** Antwortzeit des Anrufers je Frage der Notrufabfrage (Sekunden). */
    answerSeconds: Range.default([3, 8]),
    /** Anteil der Notrufe, die Brand- oder Hilfeleistungslagen sind. */
    fireShare: Probability.default(0),
    /** Anteile besonderer Anrufe (ADR-0014). */
    kinds: z
      .object({
        /** Hosentaschen- und Fehlanrufe (Stille). */
        misdial: Probability,
        /** Scherz- und Missbrauchsanrufe. */
        prank: Probability,
        /** Auskunftsanrufe (Apotheke, Bereitschaftsdienst, Krankentransport). */
        info: Probability,
        /** Wahrscheinlichkeit einer weiteren Meldung zu einem laufenden Einsatz. */
        duplicate: Probability,
        /** Anteil der Einsätze im Freien, die die Polizei (110) übergibt. */
        police: Probability,
      })
      .default({ misdial: 0.06, prank: 0.03, info: 0.05, duplicate: 0.12, police: 0.25 }),
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
  /** Transportaufträge (ADR-0015). */
  transports: z
    .object({
      /** Aufträge je Stunde und 100.000 Einwohner im Tagesmittel. */
      ratePer100k: z.number().nonnegative(),
      hourlyProfile: z.array(z.number().nonnegative()).length(24),
      /** Faktor an Wochenenden und Feiertagen (Praxen und Dialysen arbeiten kaum). */
      restDayFactor: z.number().nonnegative().default(1),
      /** Pünktlich ist, wer spätestens so viele Minuten nach dem Termin abholt. */
      toleranceMinutes: z.number().positive(),
      /** Am Vortag bestellte Aufträge, die zum Spielbeginn schon in der Liste stehen. */
      preBooked: z.number().int().nonnegative().default(0),
      /** Termine der vorbestellten Aufträge ab Spielbeginn (Minuten). */
      preBookedMinutes: Range.default([20, 180]),
    })
    .default({
      ratePer100k: 0,
      hourlyProfile: Array.from({ length: 24 }, () => 1),
      toleranceMinutes: 15,
      restDayFactor: 1,
      preBooked: 0,
      preBookedMinutes: [20, 180],
    }),
  /** Verfügbarkeit von Fahrzeugen und Besatzungen (ADR-0015). */
  logistics: z
    .object({
      /** Desinfektion nach Infektionstransport auf der Wache (Minuten). */
      disinfectionMinutes: Range,
      /** Fahrstunden, die eine Tankfüllung reicht; unter 25 % wird getankt. */
      fuelHours: z.number().positive(),
      refuelMinutes: Range,
      /** Wahrscheinlichkeit eines Defekts je Einsatz und Dauer der Reparatur (Stunden). */
      defectPerMission: Probability,
      defectHours: Range,
      /** Besatzungen wechseln zu diesen Stunden (24-Stunden-Fahrzeuge). */
      crewChangeHours: z.array(z.number().int().min(0).max(23)).min(1),
      /** Pause nach so vielen Stunden Dienst beantragen; Dauer in Minuten. */
      breakAfterHours: z.number().positive(),
      breakMinutes: z.number().int().positive(),
      /** Aufnahmeplätze: Anteil, der je Stunde wieder frei wird. */
      bedReleasePerHour: Probability,
      /** Belegung durch andere (Selbsteinweiser, Nachbarbereiche) je Abteilung und Stunde. */
      bedOtherPerHour: z.number().nonnegative(),
      /** Kurzfristige Abmeldung einer Abteilung (Geräteausfall) je Klinik und Tag, Dauer (h). */
      closurePerDay: Probability,
      closureHours: Range,
    })
    .default({
      disinfectionMinutes: [30, 50],
      fuelHours: 8,
      refuelMinutes: [10, 15],
      defectPerMission: 0,
      defectHours: [1, 3],
      crewChangeHours: [7, 19],
      breakAfterHours: 6,
      breakMinutes: 30,
      bedReleasePerHour: 0.5,
      bedOtherPerHour: 0,
      closurePerDay: 0,
      closureHours: [1, 3],
    }),
  /** Wetterwechsel (ADR-0016): Dauer einer Wetterlage, Neigung zum Beibehalten. */
  weather: z
    .object({ changeHours: Range, persistence: Probability })
    .default({ changeHours: [3, 8], persistence: 0.4 }),
  /**
   * Einsatz-Regie (ADR-0014, Punkt 8): Das Aufkommen schwankt in Phasen um höchstens ± amplitude
   * um die Basisrate – Ruhe und Spitzen wechseln, ohne Unrealistisches zu erfinden.
   */
  director: z
    .object({ amplitude: z.number().min(0).max(0.5), phaseMinutes: Range })
    .default({ amplitude: 0, phaseMinutes: [30, 90] }),
  /** Tageslicht je Monat (Januar … Dezember): Stunden [hell ab, dunkel ab], Ortszeit. */
  daylight: z.array(Range).length(12).optional(),
  /**
   * Langzeitspiel (ADR-0018): Laufbahn mit Erfahrungspunkten; höhere Stufen übernehmen einen
   * größeren Bereich (mehr Aufkommen). Bedarfsplanung kostet Budget aus guten Schichten.
   */
  career: z
    .object({
      ranks: z
        .array(z.object({ id: z.string(), xp: z.number().int().nonnegative(), area: z.number().positive() }))
        .min(1),
      /** Budget je Punkt der Schichtauswertung. */
      budgetPerPoint: z.number().nonnegative(),
      costs: z.object({
        rtw: z.number().int().positive(),
        rtwDay: z.number().int().positive(),
        ktw: z.number().int().positive(),
        nef: z.number().int().positive(),
      }),
      /** Auslastung der Fahrzeuge dieses Typs an der Wache, ab der ein Antrag begründet ist. */
      justifyUtilization: Probability,
    })
    .default({
      ranks: [{ id: 'disponent', xp: 0, area: 1 }],
      budgetPerPoint: 0.25,
      costs: { rtw: 400, rtwDay: 250, ktw: 150, nef: 350 },
      justifyUtilization: 0.35,
    }),
  /** Wiederkehrende Personen und Adressen (ADR-0018). */
  persons: z
    .object({
      /** Anteil der Notrufe, die von bekannten Personen kommen. */
      share: Probability,
      frequent: z.number().int().nonnegative(),
      regular: z.number().int().nonnegative(),
      danger: z.number().int().nonnegative(),
      regularDiagnoses: z.array(Id),
      frequentDiagnoses: z.array(Id),
      dangerDiagnoses: z.array(Id),
      /** Ohne verständigte Polizei warten die Kräfte an einer Gefahrenadresse (Minuten). */
      policeWaitMinutes: Range,
    })
    .default({
      share: 0,
      frequent: 0,
      regular: 0,
      danger: 0,
      regularDiagnoses: [],
      frequentDiagnoses: [],
      dangerDiagnoses: [],
      policeWaitMinutes: [5, 10],
    }),
  /** Großlagen (ADR-0017): Häufigkeit und Zeiten an der Einsatzstelle. */
  mci: z
    .object({
      /** Wahrscheinlichkeit einer Großlage je Tag. */
      perDay: Probability,
      /** Sichtung mit Arzt bzw. nur durch Rettungsdienst-Besatzungen (Minuten). */
      triageDoctorMinutes: Range,
      triageCrewMinutes: Range,
      /** Versorgung bis zur Transportfähigkeit je Kategorie (Minuten). */
      loadRed: Range,
      loadYellow: Range,
      loadGreen: Range,
      /** Ladeplätze an der Einsatzstelle; darüber hinaus stauen sich Fahrzeuge. */
      loadingSlots: z.number().int().positive(),
      congestionMinutes: z.number().nonnegative(),
      /** Abruf aus dem Bereitstellungsraum (Minuten). */
      stagingMinutes: z.number().nonnegative(),
      /** Versorgung der Leichtverletzten vor Ort (Minuten). */
      onSiteMinutes: Range,
    })
    .default({
      perDay: 0,
      triageDoctorMinutes: [6, 10],
      triageCrewMinutes: [15, 25],
      loadRed: [15, 25],
      loadYellow: [10, 15],
      loadGreen: [5, 10],
      loadingSlots: 4,
      congestionMinutes: 3,
      stagingMinutes: 2,
      onSiteMinutes: [25, 40],
    }),
  /** Luftrettung: Reisegeschwindigkeit, Start- und Landezeit. */
  air: z
    .object({
      speedKmh: z.number().positive(),
      liftoffSeconds: Range,
      landingSeconds: Range,
      /** Wahrscheinlichkeit je Stunde für einen Einsatz außerhalb des Bereichs, Dauer (Min.). */
      externalPerHour: Probability.default(0),
      externalMinutes: Range.default([45, 90]),
    })
    .default({
      speedKmh: 220,
      liftoffSeconds: [120, 240],
      landingSeconds: [120, 180],
      externalPerHour: 0,
      externalMinutes: [45, 90],
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
export type FireScenario = z.infer<typeof FireScenario>;
export type UnitNeed = z.infer<typeof UnitNeed>;
export type TransportOrder = z.infer<typeof TransportOrder>;
export type Service = z.infer<typeof Service>;
export type Weather = z.infer<typeof Weather>;
export type Climate = z.infer<typeof Climate>;
export type WorldEvent = z.infer<typeof WorldEvent>;
export type Holiday = z.infer<typeof Holiday>;
export type MciScenario = z.infer<typeof MciScenario>;
export type ModInfo = z.infer<typeof ModManifest>;
export type HilfsfristPreset = z.infer<typeof HilfsfristPreset>;
export type TrainingScenario = z.infer<typeof TrainingScenario>;

/** Vollständiger, validierter Inhaltsstand, den die Simulation erhält. */
export interface ContentBundle {
  readonly region: RegionConfig;
  readonly vehicleTypes: readonly VehicleType[];
  readonly stations: readonly Station[];
  readonly hospitals: readonly Hospital[];
  readonly keywords: readonly Keyword[];
  readonly diagnoses: readonly Diagnosis[];
  readonly fireScenarios: readonly FireScenario[];
  readonly transportOrders: readonly TransportOrder[];
  readonly weather: readonly Weather[];
  readonly climate: readonly Climate[];
  readonly worldEvents: readonly WorldEvent[];
  readonly holidays: readonly Holiday[];
  readonly mciScenarios: readonly MciScenario[];
  readonly scenarios: readonly TrainingScenario[];
  readonly hilfsfristPresets: readonly HilfsfristPreset[];
  /** Geladene Mods in Ladereihenfolge (ADR-0019). */
  readonly mods: readonly ModInfo[];
  readonly settings: Settings;
}
