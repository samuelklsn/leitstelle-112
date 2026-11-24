/**
 * Deterministische Geometrie für den Weltgenerator. Nur Grundrechenarten und `Math.sqrt`
 * (nach IEEE 754 exakt gerundet) – `Math.sin`/`Math.cos` sind in JS nicht bitgenau
 * spezifiziert und deshalb im Kern verboten (ADR-0004).
 */

export type Vec = readonly [number, number];

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;

/** Sinus über Taylorreihe nach Reduktion auf [-π, π]; Fehler < 1e-9, bitgleich auf allen Engines. */
export function detSin(rad: number): number {
  let x = rad - TWO_PI * Math.floor((rad + PI) / TWO_PI);
  // Weitere Reduktion auf [-π/2, π/2] über sin(π - x) = sin(x).
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 9; n++) {
    term *= -x2 / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}

export function detCos(rad: number): number {
  return detSin(rad + PI / 2);
}

export function degToRad(deg: number): number {
  return (deg * PI) / 180;
}

export function length(v: Vec): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}

export function dist(a: Vec, b: Vec): number {
  return length([a[0] - b[0], a[1] - b[1]]);
}

export function normalize(v: Vec): Vec {
  const l = length(v);
  return l === 0 ? [0, 0] : [v[0] / l, v[1] / l];
}

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Schneiden sich die Strecken p1–p2 und q1–q2 (echte Kreuzung, keine Berührung)? */
export function segmentsCross(p1: Vec, p2: Vec, q1: Vec, q2: Vec): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Kreuzt die Strecke a–b einen Polygonzug? */
export function crossesPolyline(a: Vec, b: Vec, line: readonly Vec[]): boolean {
  for (let i = 0; i + 1 < line.length; i++) {
    if (segmentsCross(a, b, line[i] as Vec, line[i + 1] as Vec)) return true;
  }
  return false;
}
