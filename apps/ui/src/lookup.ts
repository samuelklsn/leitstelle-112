/**
 * Nachschlage-Helfer über die statischen Weltdaten (Namen, Adressen, Funkrufnamen).
 * Reine Anzeige-Logik, keine Spielregeln.
 */
import type { StaticAddress, WorldInfo } from '@ls112/protocol';

export interface Lookup {
  readonly world: WorldInfo;
  townName(id: string | null | undefined): string;
  streetName(id: number): string;
  addressLabel(id: number): string;
  address(id: number): StaticAddress | undefined;
  vehicle(
    id: string,
  ):
    | { callsign: string; short: string; type: string; stationId: string; doctor: boolean }
    | undefined;
  hospitalName(id: string | null | undefined): string;
  keywordCode(id: string): string;
  diagnosisName(id: string): string;
  toLonLat(x: number, y: number): [number, number];
  searchAddresses(text: string, limit?: number): StaticAddress[];
}

const cache = new WeakMap<WorldInfo, Lookup>();

/** Kleinschreibung und Umlaute vereinheitlichen („Mühlenweg" findet auch „muehlenweg"). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replaceAll('str.', 'strasse')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lookup(world: WorldInfo): Lookup {
  const existing = cache.get(world);
  if (existing) return existing;
  const towns = new Map(world.towns.map((t) => [t.id, t.name]));
  const streets = new Map(world.streets.map((s) => [s.id, s.name]));
  const vehicles = new Map(
    world.stations.flatMap((s) =>
      s.vehicles.map((v) => {
        const type = world.vehicleTypes.find((t) => t.id === v.type);
        const short = /(\d+\/\d+-\d+)$/.exec(v.callsign)?.[1] ?? v.callsign;
        return [
          v.id,
          {
            callsign: v.callsign,
            short,
            type: type?.short ?? '?',
            stationId: s.id,
            doctor: type?.doctor ?? false,
          },
        ] as const;
      }),
    ),
  );
  const hospitals = new Map(world.hospitals.map((h) => [h.id, h.short]));
  const keywords = new Map(world.keywords.map((k) => [k.id, k.code]));
  const diagnoses = new Map(world.diagnoses.map((d) => [d.id, d.name]));
  const addresses = world.addresses;

  const label = (a: StaticAddress): string => {
    const street = streets.get(a.streetId) ?? '?';
    if (a.kind === 'road')
      return `${street} zwischen ${towns.get(a.townId) ?? '?'} und ${towns.get(a.toTownId ?? '') ?? '?'}`;
    return `${street} ${a.number}, ${towns.get(a.townId) ?? '?'}`;
  };
  const index = addresses.map((a) => normalize(label(a)));

  const l: Lookup = {
    world,
    townName: (id) => (id ? (towns.get(id) ?? '?') : '–'),
    streetName: (id) => streets.get(id) ?? '?',
    address: (id) => addresses[id],
    addressLabel: (id) => {
      const a = addresses[id];
      return a ? label(a) : '?';
    },
    vehicle: (id) => vehicles.get(id),
    hospitalName: (id) => (id ? (hospitals.get(id) ?? '?') : '–'),
    keywordCode: (id) => keywords.get(id) ?? '?',
    diagnosisName: (id) => diagnoses.get(id) ?? '?',
    toLonLat: (x, y) => [
      world.geo.originLon + x / world.geo.metersPerDegLon,
      world.geo.originLat + y / world.geo.metersPerDegLat,
    ],
    searchAddresses: (text, limit = 12) => {
      const tokens = normalize(text).split(' ').filter(Boolean);
      if (tokens.length === 0) return [];
      const out: StaticAddress[] = [];
      for (let i = 0; i < addresses.length && out.length < limit; i++) {
        const hay = index[i] ?? '';
        const a = addresses[i];
        if (!a) continue;
        const ok = tokens.every((t) =>
          /^\d+$/.test(t)
            ? a.number === t || (a.kind === 'road' && hay.includes(t))
            : hay.includes(t),
        );
        if (ok) out.push(a);
      }
      return out;
    },
  };
  cache.set(world, l);
  return l;
}
