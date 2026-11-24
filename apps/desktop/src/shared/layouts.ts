/**
 * Fenster-Layouts für Mehrmonitor-Arbeitsplätze (#50). Reine Logik ohne Electron, damit sie
 * testbar bleibt: Profile berechnen, prüfen und als JSON lesen und schreiben.
 */

/** Ansichten, die ein eigenes Fenster bekommen können. */
export const WINDOW_VIEWS = ['main', 'map', 'lists', 'vehicles'] as const;
export type WindowView = (typeof WINDOW_VIEWS)[number];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayInfo {
  readonly id: number;
  readonly primary: boolean;
  readonly workArea: Rect;
}

export interface WindowPlacement {
  readonly view: WindowView;
  readonly bounds: Rect;
  readonly maximized: boolean;
}

export interface Layout {
  readonly name: string;
  readonly windows: readonly WindowPlacement[];
  /** Mitgeliefertes Profil (nicht löschbar). */
  readonly builtIn?: boolean;
}

export interface LayoutFile {
  readonly version: 1;
  readonly last?: string;
  readonly layouts: readonly Layout[];
}

export const EMPTY_LAYOUT_FILE: LayoutFile = { version: 1, layouts: [] };

function isView(v: unknown): v is WindowView {
  return WINDOW_VIEWS.some((x) => x === v);
}

function isRect(r: unknown): r is Rect {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(o[k]));
}

/** Liest eine Layout-Datei; Unbekanntes oder Kaputtes wird verworfen statt abzustürzen. */
export function parseLayoutFile(text: string): LayoutFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_LAYOUT_FILE;
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY_LAYOUT_FILE;
  const o = raw as { last?: unknown; layouts?: unknown };
  const layouts: Layout[] = [];
  if (Array.isArray(o.layouts)) {
    for (const l of o.layouts as unknown[]) {
      if (typeof l !== 'object' || l === null) continue;
      const { name, windows } = l as { name?: unknown; windows?: unknown };
      if (typeof name !== 'string' || !Array.isArray(windows)) continue;
      const placements = (windows as unknown[]).flatMap((w): WindowPlacement[] => {
        if (typeof w !== 'object' || w === null) return [];
        const p = w as { view?: unknown; bounds?: unknown; maximized?: unknown };
        return isView(p.view) && isRect(p.bounds)
          ? [{ view: p.view, bounds: p.bounds, maximized: p.maximized === true }]
          : [];
      });
      if (placements.some((p) => p.view === 'main'))
        layouts.push({ name: name.slice(0, 60), windows: placements });
    }
  }
  return {
    version: 1,
    ...(typeof o.last === 'string' ? { last: o.last } : {}),
    layouts,
  };
}

/** Mitgelieferte Profile passend zur Zahl der Bildschirme. */
export function builtInLayouts(displays: readonly DisplayInfo[]): Layout[] {
  const sorted = [...displays].sort(
    (a, b) => Number(b.primary) - Number(a.primary) || a.workArea.x - b.workArea.x,
  );
  const [first, second, third] = sorted;
  if (!first) return [];
  const full = (view: WindowView, d: DisplayInfo): WindowPlacement => ({
    view,
    bounds: d.workArea,
    maximized: true,
  });
  const w = first.workArea;
  const layouts: Layout[] = [
    { name: 'Ein Bildschirm', builtIn: true, windows: [full('main', first)] },
    {
      // Hauptfenster links, Lagekarte rechts – für breite Bildschirme.
      name: 'Ein Bildschirm, Karte separat',
      builtIn: true,
      windows: [
        {
          view: 'main',
          bounds: { ...w, width: Math.round(w.width * 0.6) },
          maximized: false,
        },
        {
          view: 'map',
          bounds: {
            ...w,
            x: w.x + Math.round(w.width * 0.6),
            width: w.width - Math.round(w.width * 0.6),
          },
          maximized: false,
        },
      ],
    },
  ];
  if (second) {
    layouts.push({
      name: 'Zwei Bildschirme',
      builtIn: true,
      windows: [full('main', first), full('map', second)],
    });
  }
  if (second && third) {
    layouts.push({
      name: 'Drei Bildschirme',
      builtIn: true,
      windows: [full('main', first), full('map', second), full('lists', third)],
    });
  }
  return layouts;
}

/** Liegt das Fenster zumindest teilweise auf einem vorhandenen Bildschirm? */
export function isVisible(bounds: Rect, displays: readonly DisplayInfo[]): boolean {
  return displays.some((d) => {
    const a = d.workArea;
    const ix = Math.min(a.x + a.width, bounds.x + bounds.width) - Math.max(a.x, bounds.x);
    const iy = Math.min(a.y + a.height, bounds.y + bounds.height) - Math.max(a.y, bounds.y);
    return ix >= 100 && iy >= 100;
  });
}

/** Alle wählbaren Layouts: mitgelieferte zuerst, eigene danach (gleiche Namen ersetzen nicht). */
export function allLayouts(file: LayoutFile, displays: readonly DisplayInfo[]): Layout[] {
  const builtIn = builtInLayouts(displays);
  const own = file.layouts.filter((l) => !builtIn.some((b) => b.name === l.name));
  return [...builtIn, ...own];
}

/** Layout speichern oder ersetzen. */
export function upsertLayout(file: LayoutFile, layout: Layout): LayoutFile {
  return {
    ...file,
    last: layout.name,
    layouts: [...file.layouts.filter((l) => l.name !== layout.name), layout],
  };
}

export function removeLayout(file: LayoutFile, name: string): LayoutFile {
  return {
    version: 1,
    ...(file.last !== undefined && file.last !== name ? { last: file.last } : {}),
    layouts: file.layouts.filter((l) => l.name !== name),
  };
}

/**
 * Layout auf die aktuellen Bildschirme anwenden: Fenster außerhalb aller Bildschirme
 * (abgesteckter Monitor) landen auf dem Hauptbildschirm.
 */
export function fitLayout(layout: Layout, displays: readonly DisplayInfo[]): WindowPlacement[] {
  const primary = displays.find((d) => d.primary) ?? displays[0];
  return layout.windows.map((w) =>
    isVisible(w.bounds, displays) || !primary
      ? w
      : { ...w, bounds: primary.workArea, maximized: w.view === 'main' },
  );
}
