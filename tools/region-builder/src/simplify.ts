/**
 * Vereinfacht das Straßennetz aus OSM: Stützpunkte auf nahezu geraden Abschnitten derselben
 * Straße fallen weg, Kreuzungen, Kurven und Straßenwechsel bleiben. Abschnitte werden höchstens
 * {@link MAX_SPAN_M} lang, damit Adressen weiterhin nahe Anfahrtsknoten haben (ADR-0020).
 */

export type Vec = [number, number];
/** Straßenstück [von, nach, Straßenklasse, Straße, Einbahn 0/1]. */
export type Seg = readonly [number, number, number, number, number];

/** Richtungsänderung, ab der ein Stützpunkt als Kurve erhalten bleibt (Grad). */
const MAX_TURN_DEG = 15;
/** Längster Abschnitt ohne Zwischenknoten (m). */
export const MAX_SPAN_M = 300;

const COS_TURN = Math.cos((MAX_TURN_DEG * Math.PI) / 180);

function dist(a: Vec, b: Vec): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

export function simplifyNetwork(
  nodes: readonly Vec[],
  segs: readonly Seg[],
): { nodes: Vec[]; segs: Seg[] } {
  const incident: number[][] = nodes.map(() => []);
  segs.forEach((s, i) => {
    incident[s[0]]?.push(i);
    incident[s[1]]?.push(i);
  });
  const other = (s: Seg, n: number) => (s[0] === n ? s[1] : s[0]);

  /** Kann der Knoten wegfallen? Genau zwei gleichartige Stücke, fast gerade weiter. */
  const removable = nodes.map((p, n) => {
    const inc = incident[n] ?? [];
    if (inc.length !== 2) return false;
    const a = segs[inc[0] ?? 0];
    const b = segs[inc[1] ?? 0];
    if (!a || !b || a[2] !== b[2] || a[3] !== b[3] || a[4] !== b[4]) return false;
    const pa = other(a, n);
    const pb = other(b, n);
    if (pa === pb) return false;
    // Einbahnstraße: Richtung muss durchlaufen (… → n → …).
    if (a[4] === 1 && !((a[1] === n && b[0] === n) || (b[1] === n && a[0] === n))) return false;
    const u: Vec = [p[0] - (nodes[pa]?.[0] ?? 0), p[1] - (nodes[pa]?.[1] ?? 0)];
    const v: Vec = [(nodes[pb]?.[0] ?? 0) - p[0], (nodes[pb]?.[1] ?? 0) - p[1]];
    const lu = Math.hypot(u[0], u[1]);
    const lv = Math.hypot(v[0], v[1]);
    if (lu === 0 || lv === 0) return true;
    return (u[0] * v[0] + u[1] * v[1]) / (lu * lv) >= COS_TURN;
  });

  const visited = new Uint8Array(segs.length);
  const kept = new Set<number>();
  const out: Seg[] = [];
  const walk = (origin: number, firstSeg: number) => {
    let start = origin;
    let first = firstSeg;
    let from = origin;
    let segIndex = firstSeg;
    let span = 0;
    for (;;) {
      visited[segIndex] = 1;
      const seg = segs[segIndex];
      if (!seg) return;
      const cur = other(seg, from);
      span += dist(nodes[from] ?? [0, 0], nodes[cur] ?? [0, 0]);
      from = cur;
      const next = (incident[cur] ?? []).find((i) => i !== segIndex);
      if (removable[cur] && next !== undefined && !visited[next] && span < MAX_SPAN_M) {
        segIndex = next;
        continue;
      }
      // Abschnitt abschließen; die Richtung einer Einbahnstraße bleibt erhalten.
      kept.add(start);
      kept.add(cur);
      const f = segs[first];
      const forward = !f || f[4] === 0 || f[0] === start;
      out.push(
        forward ? [start, cur, seg[2], seg[3], seg[4]] : [cur, start, seg[2], seg[3], seg[4]],
      );
      if (!removable[cur] || next === undefined || visited[next]) return;
      // Langer gerader Abschnitt: am Zwischenknoten neu beginnen.
      start = cur;
      first = next;
      span = 0;
      segIndex = next;
    }
  };
  nodes.forEach((_, n) => {
    if (removable[n]) return;
    for (const s of incident[n] ?? []) if (!visited[s]) walk(n, s);
  });
  // Ringe ganz ohne festen Knoten (z. B. ein Kreisverkehr ohne Abzweig).
  segs.forEach((s, i) => {
    if (!visited[i]) walk(s[0], i);
  });

  const remap = new Map<number, number>();
  const newNodes: Vec[] = [];
  for (const n of [...kept].sort((a, b) => a - b)) {
    remap.set(n, newNodes.length);
    newNodes.push(nodes[n] ?? [0, 0]);
  }
  return {
    nodes: newNodes,
    segs: out
      .filter(([a, b]) => a !== b)
      .map(([a, b, c, s, o]) => [remap.get(a) ?? 0, remap.get(b) ?? 0, c, s, o] as const),
  };
}
