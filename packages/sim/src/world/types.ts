import type { RegionConfig } from '@ls112/content';
import type { RoadClass, RoadGraph } from '@ls112/routing';

export interface WorldStreet {
  readonly id: number;
  readonly name: string;
  /** Ort, zu dem die Straße gehört; `null` für überörtliche Straßen. */
  readonly townId: string | null;
  readonly roadClass: RoadClass;
}

/** Ungerichtetes Straßensegment, wie es generiert wurde (für Karte und Adressen). */
export interface WorldSegment {
  readonly from: number;
  readonly to: number;
  readonly roadClass: RoadClass;
  readonly streetId: number;
}

export type AddressKind = 'house' | 'road';

export interface WorldAddress {
  readonly id: number;
  readonly kind: AddressKind;
  readonly streetId: number;
  /** Hausnummer; leer bei Straßenabschnitten. */
  readonly number: string;
  readonly townId: string;
  /** Für Straßenabschnitte: Ort am anderen Ende („zwischen A und B"). */
  readonly toTownId?: string;
  readonly x: number;
  readonly y: number;
  /** Nächster Graphknoten (Anfahrtspunkt). */
  readonly node: number;
}

export interface WorldTown {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly population: number;
}

export interface World {
  readonly region: RegionConfig;
  readonly graph: RoadGraph;
  readonly segments: readonly WorldSegment[];
  readonly streets: readonly WorldStreet[];
  readonly addresses: readonly WorldAddress[];
  readonly towns: readonly WorldTown[];
  /** Kumulative Gewichte der Hausadressen nach Einwohnern (für die Einsatzortwahl). */
  readonly houseWeights: Float64Array;
  readonly houseIds: Uint32Array;
  /** IDs der Straßenabschnitts-Adressen (Einsätze im Freien, z. B. Verkehrsunfälle). */
  readonly roadAddressIds: Uint32Array;
}
