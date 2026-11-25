/**
 * OSM-Import (ADR-0020): wandelt einen OpenStreetMap-Auszug (OSM-XML, z. B. aus JOSM, Overpass
 * oder `osmium cat auszug.pbf -o auszug.osm`) in ein Regionspaket für Leitstelle 112 um.
 *
 * Ergebnis ist ein Mod: Region mit fertigem Straßennetz und Adressen, dazu Wachen, Kliniken und
 * Krankentransport-Vorlagen aus den OSM-Einrichtungen. Kartendaten © OpenStreetMap-Mitwirkende,
 * Lizenz ODbL – die Namensnennung steht in der Region.
 *
 * Läuft nur zur Build-Zeit (kein Teil des deterministischen Kerns); Kosinus für die Projektion ist
 * hier erlaubt.
 */

export interface OsmNode {
  readonly lat: number;
  readonly lon: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface OsmWay {
  readonly id: string;
  readonly refs: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

export interface OsmData {
  readonly nodes: ReadonlyMap<string, OsmNode>;
  readonly ways: readonly OsmWay[];
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

function decode(text: string): string {
  return text.replace(/&(amp|quot|apos|lt|gt);/g, (m) => ENTITIES[m] ?? m);
}

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1] ?? ''] = decode(m[2] ?? '');
  return out;
}

function tags(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g))
    out[decode(m[1] ?? '')] = decode(m[2] ?? '');
  return out;
}

/** Einfacher, robuster Parser für OSM-XML (Knoten und Wege; Relationen werden ignoriert). */
export function parseOsm(xml: string): OsmData {
  const nodes = new Map<string, OsmNode>();
  for (const m of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(m[1] ?? '');
    const lat = Number(a.lat);
    const lon = Number(a.lon);
    if (a.id && Number.isFinite(lat) && Number.isFinite(lon))
      nodes.set(a.id, { lat, lon, tags: tags(m[2] ?? '') });
  }
  const ways: OsmWay[] = [];
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(m[1] ?? '');
    const body = m[2] ?? '';
    const refs = [...body.matchAll(/<nd\s+ref="([^"]+)"\s*\/>/g)].map((r) => r[1] ?? '');
    if (a.id) ways.push({ id: a.id, refs, tags: tags(body) });
  }
  return { nodes, ways };
}

// ---------------------------------------------------------------------------- Umwandlung

export interface BuildOptions {
  /** Namensraum und Mod-ID, z. B. `mein-kreis`. */
  readonly id: string;
  /** Anzeigename, z. B. „Landkreis Musterstadt“. */
  readonly name: string;
}

/** Ergebnis: Dateien eines Mods (Name → JSON-Inhalt). */
export type ModFiles = Record<string, unknown>;

type Vec = [number, number];

const HIGHWAY_CLASS: Record<string, number> = {
  motorway: 0,
  trunk: 1,
  primary: 1,
  secondary: 2,
  tertiary: 3,
  unclassified: 3,
  residential: 5,
  living_street: 5,
  road: 5,
  motorway_link: 6,
  trunk_link: 6,
  primary_link: 6,
  secondary_link: 6,
  tertiary_link: 6,
};

const PLACE = {
  city: { kind: 'kreisstadt', radius: 3000, population: 60_000 },
  town: { kind: 'stadt', radius: 1500, population: 12_000 },
  village: { kind: 'gemeinde', radius: 600, population: 1200 },
  hamlet: { kind: 'gemeinde', radius: 250, population: 150 },
} as const;

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replaceAll('ä', 'ae')
      .replaceAll('ö', 'oe')
      .replaceAll('ü', 'ue')
      .replaceAll('ß', 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ort'
  );
}

function dist2(a: Vec, b: Vec): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

/** Größte zusammenhängende Komponente (ungerichtet) – abgehängte Reststücke fallen weg. */
function largestComponent(n: number, edges: readonly [number, number][]): boolean[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] ?? r;
    while (parent[x] !== r) {
      const next = parent[x] ?? r;
      parent[x] = r;
      x = next;
    }
    return r;
  };
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  let best = 0;
  let bestSize = -1;
  for (const [root, s] of size) if (s > bestSize) [best, bestSize] = [root, s];
  return Array.from({ length: n }, (_, i) => find(i) === best);
}

/** Wandelt OSM-Daten in die Dateien eines Region-Mods um. */
export function buildRegionMod(osm: OsmData, options: BuildOptions): ModFiles {
  const ns = options.id;
  const roadWays = osm.ways.filter(
    (w) => w.tags.highway !== undefined && HIGHWAY_CLASS[w.tags.highway] !== undefined,
  );
  if (roadWays.length === 0) throw new Error('Keine Straßen im OSM-Auszug gefunden');

  // Projektion: lokale Meter ab der Südwest-Ecke (gleichabstandsnahe Zylinderprojektion).
  const used = new Set<string>();
  for (const w of roadWays) for (const r of w.refs) used.add(r);
  const usedNodes = [...used].map((id) => osm.nodes.get(id)).filter((n): n is OsmNode => !!n);
  const minLat = Math.min(...usedNodes.map((n) => n.lat));
  const maxLat = Math.max(...usedNodes.map((n) => n.lat));
  const minLon = Math.min(...usedNodes.map((n) => n.lon));
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const project = (n: { lat: number; lon: number }): Vec => [
    Math.round((n.lon - minLon) * metersPerDegLon * 10) / 10 + 200,
    Math.round((n.lat - minLat) * metersPerDegLat * 10) / 10 + 200,
  ];

  // Orte aus place-Knoten.
  const towns: {
    id: string;
    name: string;
    kind: string;
    x: number;
    y: number;
    radius: number;
    population: number;
  }[] = [];
  for (const node of osm.nodes.values()) {
    const place = node.tags.place as keyof typeof PLACE | undefined;
    const name = node.tags.name;
    if (!place || !name || !(place in PLACE)) continue;
    const spec = PLACE[place];
    const pop = Number(node.tags.population);
    const [x, y] = project(node);
    let id = `${ns}:${slug(name)}`;
    while (towns.some((t) => t.id === id)) id += '-2';
    towns.push({
      id,
      name,
      kind: spec.kind,
      x,
      y,
      radius: spec.radius,
      population: Number.isFinite(pop) && pop > 0 ? Math.round(pop) : spec.population,
    });
  }
  if (towns.length === 0) throw new Error('Keine Orte (place=city/town/village/hamlet) gefunden');
  towns.sort((a, b) => b.population - a.population);
  const nearestTown = (p: Vec) =>
    towns.reduce((best, t) => (dist2(p, [t.x, t.y]) < dist2(p, [best.x, best.y]) ? t : best));
  const townAt = (p: Vec) => {
    const t = nearestTown(p);
    return dist2(p, [t.x, t.y]) <= (t.radius * 1.5) ** 2 ? t : undefined;
  };

  // Knoten und Segmente; Straßen je Name und Ort.
  const nodeIndex = new Map<string, number>();
  const nodes: Vec[] = [];
  const indexOf = (ref: string): number | undefined => {
    const known = nodeIndex.get(ref);
    if (known !== undefined) return known;
    const node = osm.nodes.get(ref);
    if (!node) return undefined;
    nodeIndex.set(ref, nodes.length);
    nodes.push(project(node));
    return nodes.length - 1;
  };
  const streets: { name: string; town: string | null; roadClass: number }[] = [];
  const streetKey = new Map<string, number>();
  const rawSegments: [number, number, number, number, number][] = [];
  for (const w of roadWays) {
    const cls = HIGHWAY_CLASS[w.tags.highway ?? ''] ?? 5;
    const refs = w.tags.oneway === '-1' ? [...w.refs].reverse() : w.refs;
    const idx = refs.map(indexOf).filter((i): i is number => i !== undefined);
    if (idx.length < 2) continue;
    const mid = nodes[idx[Math.floor(idx.length / 2)] ?? 0] ?? [0, 0];
    const town = cls >= 4 || cls === 3 ? townAt(mid) : undefined;
    const name = w.tags.name ?? w.tags.ref ?? 'Unbenannte Straße';
    const key = `${name}|${town?.id ?? ''}`;
    let street = streetKey.get(key);
    if (street === undefined) {
      street = streets.length;
      streets.push({ name, town: town?.id ?? null, roadClass: cls === 3 && town ? 4 : cls });
      streetKey.set(key, street);
    }
    const oneway = ['yes', '1', 'true', '-1'].includes(w.tags.oneway ?? '') ? 1 : 0;
    const roadClass = cls === 3 && town ? 4 : cls;
    for (let i = 0; i + 1 < idx.length; i++)
      rawSegments.push([idx[i] ?? 0, idx[i + 1] ?? 0, roadClass, street, oneway]);
  }

  // Nur das zusammenhängende Netz behalten und neu nummerieren.
  const keep = largestComponent(
    nodes.length,
    rawSegments.map(([a, b]) => [a, b]),
  );
  const remap = new Map<number, number>();
  const finalNodes: Vec[] = [];
  nodes.forEach((p, i) => {
    if (keep[i]) {
      remap.set(i, finalNodes.length);
      finalNodes.push(p);
    }
  });
  const segments = rawSegments
    .filter(([a, b]) => a !== b && remap.has(a) && remap.has(b))
    .map(([a, b, c, s, o]) => [remap.get(a) ?? 0, remap.get(b) ?? 0, c, s, o] as const);

  // Räumlicher Index für die nächsten Knoten (Raster 250 m).
  const CELL = 250;
  const grid = new Map<string, number[]>();
  finalNodes.forEach(([x, y], i) => {
    const k = `${Math.floor(x / CELL).toString()}|${Math.floor(y / CELL).toString()}`;
    const list = grid.get(k) ?? [];
    list.push(i);
    grid.set(k, list);
  });
  const nearestNode = (p: Vec): number => {
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    for (let r = 1; r < 200; r++) {
      let best = -1;
      let bestD = Number.POSITIVE_INFINITY;
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (const i of grid.get(`${(cx + dx).toString()}|${(cy + dy).toString()}`) ?? []) {
            const d = dist2(p, finalNodes[i] ?? [0, 0]);
            if (d < bestD) [best, bestD] = [i, d];
          }
      if (best >= 0) return best;
    }
    return 0;
  };
  const streetNodes = new Map<number, number[]>();
  for (const [a, b, , s] of segments) {
    const list = streetNodes.get(s) ?? [];
    list.push(a, b);
    streetNodes.set(s, list);
  }

  // Hausadressen aus addr:*; fehlen sie, werden Hausnummern entlang der Wohnstraßen gesetzt.
  const addresses: [number, string, string, number, number, number][] = [];
  const centroid = (refs: readonly string[]): Vec | undefined => {
    const pts = refs
      .map((r) => osm.nodes.get(r))
      .filter((n): n is OsmNode => !!n)
      .map(project);
    if (pts.length === 0) return undefined;
    return [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ];
  };
  const addAddress = (streetName: string, number: string, p: Vec) => {
    const town = nearestTown(p);
    const candidates = streets
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s.name === streetName && streetNodes.has(x.i));
    const street = candidates.find((x) => x.s.town === town.id) ?? candidates[0] ?? undefined;
    if (!street) {
      // Straßenname nicht im Netz (Schreibweise, Fußweg): nächster Knoten und dessen Straße.
      const node = nearestNode(p);
      const seg = segments.find(([a, b]) => a === node || b === node);
      if (seg) addresses.push([seg[3], number, town.id, Math.round(p[0]), Math.round(p[1]), node]);
      return;
    }
    const own = streetNodes.get(street.i) ?? [];
    const node = own.reduce((best, i) =>
      dist2(p, finalNodes[i] ?? [0, 0]) < dist2(p, finalNodes[best] ?? [0, 0]) ? i : best,
    );
    addresses.push([street.i, number, town.id, Math.round(p[0]), Math.round(p[1]), node]);
  };
  for (const node of osm.nodes.values()) {
    const nr = node.tags['addr:housenumber'];
    const st = node.tags['addr:street'];
    if (nr && st) addAddress(st, nr, project(node));
  }
  for (const w of osm.ways) {
    const nr = w.tags['addr:housenumber'];
    const st = w.tags['addr:street'];
    const c = nr && st ? centroid(w.refs) : undefined;
    if (nr && st && c) addAddress(st, nr, c);
  }
  for (const town of towns) {
    if (addresses.filter((a) => a[2] === town.id).length >= 30) continue;
    // Zu wenige Adressen in OSM: alle 30 m beidseitig Hausnummern an Wohnstraßen des Ortes.
    streets.forEach((s, si) => {
      if (s.town !== town.id || s.roadClass < 4 || s.roadClass > 5) return;
      let odd = 1;
      let even = 2;
      for (const [a, b, , sid] of segments) {
        if (sid !== si) continue;
        const pa = finalNodes[a] ?? [0, 0];
        const pb = finalNodes[b] ?? [0, 0];
        const len = Math.sqrt(dist2(pa, pb));
        const count = Math.floor(len / 30);
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          const x = pa[0] + (pb[0] - pa[0]) * t;
          const y = pa[1] + (pb[1] - pa[1]) * t;
          const nx = (pb[1] - pa[1]) / len;
          const ny = -(pb[0] - pa[0]) / len;
          addresses.push([
            si,
            odd.toString(),
            town.id,
            Math.round(x + nx * 12),
            Math.round(y + ny * 12),
            t < 0.5 ? a : b,
          ]);
          addresses.push([
            si,
            even.toString(),
            town.id,
            Math.round(x - nx * 12),
            Math.round(y - ny * 12),
            t < 0.5 ? a : b,
          ]);
          odd += 2;
          even += 2;
        }
      }
    });
  }
  if (addresses.length === 0) throw new Error('Keine Adressen ableitbar');

  // Einsatzorte im Freien: Mitte überörtlicher Straßen zwischen zwei Orten.
  const roadSections: [number, string, string, number][] = [];
  streets.forEach((s, si) => {
    if (s.town !== null || s.roadClass < 1 || s.roadClass > 3) return;
    const own = streetNodes.get(si) ?? [];
    if (own.length < 2) return;
    const first = nearestTown(finalNodes[own[0] ?? 0] ?? [0, 0]);
    const last = nearestTown(finalNodes[own.at(-1) ?? 0] ?? [0, 0]);
    if (first.id === last.id) return;
    roadSections.push([si, first.id, last.id, own[Math.floor(own.length / 2)] ?? 0]);
  });

  // Einrichtungen: Kliniken, Feuerwachen, Rettungswachen.
  const facilities = (pred: (t: Readonly<Record<string, string>>) => boolean) => {
    const out: { name: string; p: Vec }[] = [];
    for (const node of osm.nodes.values())
      if (pred(node.tags)) out.push({ name: node.tags.name ?? '', p: project(node) });
    for (const w of osm.ways) {
      const c = pred(w.tags) ? centroid(w.refs) : undefined;
      if (c) out.push({ name: w.tags.name ?? '', p: c });
    }
    return out;
  };
  const hospitalsRaw = facilities((t) => t.amenity === 'hospital');
  const fireRaw = facilities((t) => t.amenity === 'fire_station');
  const ambulanceRaw = facilities((t) => t.emergency === 'ambulance_station');
  const biggest = towns[0];
  if (!biggest) throw new Error('Kein Ort');
  const center: Vec = [biggest.x, biggest.y];
  if (hospitalsRaw.length === 0) hospitalsRaw.push({ name: `Klinikum ${biggest.name}`, p: center });
  if (ambulanceRaw.length === 0)
    ambulanceRaw.push({ name: `Rettungswache ${biggest.name}`, p: center });

  const hospitals = hospitalsRaw.map((h, i) => {
    const town = nearestTown(h.p);
    const name = h.name || `Krankenhaus ${town.name}`;
    return {
      id: `${ns}:kh-${(i + 1).toString()}`,
      name,
      short: name.slice(0, 16),
      level: i === 0 ? 'schwerpunktversorgung' : 'grundversorgung',
      position: [Math.round(h.p[0]), Math.round(h.p[1])],
      departments:
        i === 0
          ? [
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
            ]
          : ['innere', 'chirurgie'],
      beds:
        i === 0
          ? { innere: 6, chirurgie: 4, unfallchirurgie: 4, stroke: 2, intensiv: 2 }
          : { innere: 4, chirurgie: 3 },
    };
  });
  const stations: unknown[] = [];
  ambulanceRaw.forEach((s, i) => {
    const town = nearestTown(s.p);
    const no = (i + 1).toString();
    stations.push({
      id: `${ns}:rw-${no}`,
      name: s.name || `Rettungswache ${town.name}`,
      kind: 'rettungswache',
      position: [Math.round(s.p[0]), Math.round(s.p[1])],
      vehicles: [
        { id: `${ns}:rtw-${no}-1`, callsign: `Rettung ${town.name} ${no}/83-1`, type: 'base:rtw' },
        { id: `${ns}:rtw-${no}-2`, callsign: `Rettung ${town.name} ${no}/83-2`, type: 'base:rtw' },
        {
          id: `${ns}:ktw-${no}-1`,
          callsign: `Rettung ${town.name} ${no}/85-1`,
          type: 'base:ktw',
          service: { from: 7, to: 19 },
        },
      ],
    });
  });
  const firstHospital = hospitals[0];
  if (firstHospital) {
    stations.push({
      id: `${ns}:na-1`,
      name: `Notarztstandort ${firstHospital.name}`,
      kind: 'notarztstandort',
      position: firstHospital.position,
      vehicles: [
        { id: `${ns}:nef-1`, callsign: `Rettung ${biggest.name} 1/82-1`, type: 'base:nef' },
      ],
    });
  }
  fireRaw.forEach((s, i) => {
    const town = nearestTown(s.p);
    const no = (i + 1).toString();
    const career = /feuerwache|berufsfeuerwehr/i.test(s.name);
    stations.push({
      id: `${ns}:fw-${no}`,
      name: s.name || `Feuerwehr ${town.name}`,
      kind: 'feuerwache',
      position: [Math.round(s.p[0]), Math.round(s.p[1])],
      ...(career ? {} : { turnout: { day: [240, 420], night: [300, 480] } }),
      vehicles: [
        { id: `${ns}:hlf-${no}`, callsign: `Florian ${town.name} ${no}/46-1`, type: 'base:hlf' },
        ...(career
          ? [
              {
                id: `${ns}:elw-${no}`,
                callsign: `Florian ${town.name} ${no}/11-1`,
                type: 'base:elw1',
              },
              {
                id: `${ns}:dlk-${no}`,
                callsign: `Florian ${town.name} ${no}/33-1`,
                type: 'base:dlk',
              },
            ]
          : [
              {
                id: `${ns}:lf-${no}`,
                callsign: `Florian ${town.name} ${no}/44-1`,
                type: 'base:lf',
              },
            ]),
      ],
    });
  });

  // Wald und größter Fluss für die Karte.
  const forests = osm.ways
    .filter((w) => w.tags.landuse === 'forest' || w.tags.natural === 'wood')
    .map((w) => {
      const pts = w.refs
        .map((r) => osm.nodes.get(r))
        .filter((n): n is OsmNode => !!n)
        .map(project);
      const step = Math.max(1, Math.ceil(pts.length / 200));
      return {
        ...(w.tags.name ? { name: w.tags.name } : {}),
        points: pts
          .filter((_, i) => i % step === 0)
          .map(([x, y]) => [Math.round(x), Math.round(y)]),
      };
    })
    .filter((f) => f.points.length >= 3);
  const rivers = osm.ways.filter((w) => w.tags.waterway === 'river');
  const longest = rivers.sort((a, b) => b.refs.length - a.refs.length)[0];
  const riverPoints = longest
    ? longest.refs
        .map((r) => osm.nodes.get(r))
        .filter((n): n is OsmNode => !!n)
        .map(project)
    : [];

  const width = Math.ceil(Math.max(...finalNodes.map((p) => p[0])) + 200);
  const height = Math.ceil(Math.max(...finalNodes.map((p) => p[1])) + 200);
  const clampInside = (p: number[]) => [
    Math.min(width, Math.max(0, p[0] ?? 0)),
    Math.min(height, Math.max(0, p[1] ?? 0)),
  ];
  for (const h of hospitals) h.position = clampInside(h.position);
  for (const s of stations as { position: number[] }[]) s.position = clampInside(s.position);

  let seed = 0;
  for (const ch of ns) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const region = {
    id: `${ns}:region`,
    name: options.name,
    center: `ILS ${options.name.replace(/^Landkreis\s+/, '')}`,
    seed,
    size: { width, height },
    geo: {
      originLon: minLon - 200 / metersPerDegLon,
      originLat: minLat - 200 / metersPerDegLat,
      metersPerDegLon,
      metersPerDegLat,
    },
    attribution: 'Kartendaten © OpenStreetMap-Mitwirkende, ODbL 1.0 (openstreetmap.org/copyright)',
    towns: towns.map((t) => ({
      ...t,
      x: Math.round(t.x),
      y: Math.round(t.y),
      blockSize: 120,
    })),
    roads: [],
    ...(riverPoints.length >= 2
      ? {
          river: {
            name: longest?.tags.name ?? 'Fluss',
            points: riverPoints.map(([x, y]) => [Math.round(x), Math.round(y)]),
            width: 20,
          },
        }
      : {}),
    forests,
    prebuilt: {
      nodes: finalNodes.map(([x, y]) => [x, y]),
      segments: segments.map((s) => [...s]),
      streets,
      addresses,
      roadSections,
    },
  };
  const hospitalIds = hospitals.map((h) => h.id);
  return {
    mod: {
      mod: {
        id: ns,
        name: options.name,
        version: '1.0.0',
        description: `Echte Region aus OpenStreetMap: ${towns.length.toString()} Orte, ${finalNodes.length.toString()} Knoten, ${addresses.length.toString()} Adressen.`,
        replaces: ['stations', 'hospitals', 'transportOrders', 'scenarios'],
      },
    },
    region: { region },
    einrichtungen: {
      stations,
      hospitals,
      transportOrders: [
        {
          id: `${ns}:einweisung`,
          name: 'Einweisung zur stationären Aufnahme',
          weight: 4,
          keyword: 'base:ktp',
          toHospitals: hospitalIds,
          leadMinutes: [20, 150],
          pickupMinutes: [8, 15],
          handoverMinutes: [8, 12],
          naca: [1, 2],
          ageRange: [55, 95],
        },
        {
          id: `${ns}:entlassung`,
          name: 'Entlassung nach Hause',
          weight: 4,
          keyword: 'base:ktp',
          fromHospitals: hospitalIds,
          leadMinutes: [30, 120],
          pickupMinutes: [10, 20],
          handoverMinutes: [5, 10],
          naca: [1, 1],
          ageRange: [60, 98],
        },
      ],
    },
  };
}
