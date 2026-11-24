import { describe, expect, it } from 'vitest';
import {
  EMPTY_LAYOUT_FILE,
  allLayouts,
  builtInLayouts,
  fitLayout,
  parseLayoutFile,
  removeLayout,
  upsertLayout,
  type DisplayInfo,
} from './layouts';

const left: DisplayInfo = {
  id: 1,
  primary: true,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const right: DisplayInfo = {
  id: 2,
  primary: false,
  workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
};
const third: DisplayInfo = {
  id: 3,
  primary: false,
  workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
};

describe('Fenster-Layouts', () => {
  it('bietet Profile passend zur Zahl der Bildschirme', () => {
    expect(builtInLayouts([left]).map((l) => l.name)).toEqual([
      'Ein Bildschirm',
      'Ein Bildschirm, Karte separat',
    ]);
    const two = builtInLayouts([right, left]);
    expect(two.map((l) => l.name)).toContain('Zwei Bildschirme');
    const zwei = two.find((l) => l.name === 'Zwei Bildschirme');
    // Hauptfenster auf dem Hauptbildschirm, Karte auf dem zweiten.
    expect(zwei?.windows[0]?.bounds.x).toBe(0);
    expect(zwei?.windows[1]).toMatchObject({ view: 'map', bounds: right.workArea });
    expect(builtInLayouts([left, right, third]).map((l) => l.name)).toContain('Drei Bildschirme');
  });

  it('liest gespeicherte Layouts robust und verwirft Kaputtes', () => {
    expect(parseLayoutFile('kein json')).toEqual(EMPTY_LAYOUT_FILE);
    const file = parseLayoutFile(
      JSON.stringify({
        last: 'Nacht',
        layouts: [
          {
            name: 'Nacht',
            windows: [
              { view: 'main', bounds: { x: 0, y: 0, width: 800, height: 600 }, maximized: true },
              { view: 'unbekannt', bounds: { x: 0, y: 0, width: 1, height: 1 } },
            ],
          },
          { name: 'Ohne Hauptfenster', windows: [{ view: 'map', bounds: left.workArea }] },
          { name: 42 },
        ],
      }),
    );
    expect(file.last).toBe('Nacht');
    expect(file.layouts).toHaveLength(1);
    expect(file.layouts[0]?.windows).toHaveLength(1);
  });

  it('speichert, ersetzt und löscht eigene Layouts', () => {
    const layout = {
      name: 'Mein Platz',
      windows: [{ view: 'main' as const, bounds: left.workArea, maximized: true }],
    };
    let file = upsertLayout(EMPTY_LAYOUT_FILE, layout);
    file = upsertLayout(file, layout);
    expect(file.layouts).toHaveLength(1);
    expect(file.last).toBe('Mein Platz');
    expect(allLayouts(file, [left]).map((l) => l.name)).toContain('Mein Platz');
    file = removeLayout(file, 'Mein Platz');
    expect(file.layouts).toHaveLength(0);
    expect(file.last).toBeUndefined();
  });

  it('holt Fenster eines abgesteckten Monitors auf den Hauptbildschirm', () => {
    const zwei = builtInLayouts([left, right]).find((l) => l.name === 'Zwei Bildschirme');
    if (!zwei) throw new Error('Profil fehlt');
    const fitted = fitLayout(zwei, [left]);
    expect(fitted[1]?.bounds).toEqual(left.workArea);
    expect(fitted[0]?.bounds).toEqual(left.workArea);
  });
});
