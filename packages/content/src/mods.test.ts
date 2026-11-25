import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ContentError, loadContentLayers } from './loader';
import { loadWithMods, readContentFiles } from './node';

const BASE = join(import.meta.dirname, '..', '..', '..', 'content', 'base');
const tmp = mkdtempSync(join(tmpdir(), 'ls112-mods-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mod(folder: string, files: Record<string, unknown>): void {
  const dir = join(tmp, folder);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files))
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
}

describe('Mods (ADR-0019)', () => {
  const base = { id: 'base', files: readContentFiles(BASE) };

  it('ein Mod ersetzt Einträge mit gleicher ID und ergänzt neue', () => {
    const bundle = loadContentLayers([
      base,
      {
        id: 'test',
        files: [
          {
            path: 'mod.json',
            text: JSON.stringify({ mod: { id: 'test', name: 'Test', version: '1.0.0' } }),
          },
          {
            path: 'wache.json',
            text: JSON.stringify({
              stations: [
                {
                  id: 'base:rw-tannrode',
                  name: 'Rettungswache Tannrode (neu)',
                  kind: 'rettungswache',
                  position: [21000, 4600],
                  vehicles: [
                    { id: 'base:rtw-3-83-1', callsign: 'Rettung Tannrode 3/83-1', type: 'base:rtw' },
                    { id: 'test:rtw-2', callsign: 'Rettung Tannrode 3/83-2', type: 'base:rtw' },
                  ],
                },
              ],
              settingsOverride: { hilfsfrist: { minutes: 10 } },
            }),
          },
        ],
      },
    ]);
    const tannrode = bundle.stations.find((s) => s.id === 'base:rw-tannrode');
    expect(tannrode?.name).toBe('Rettungswache Tannrode (neu)');
    expect(tannrode?.vehicles).toHaveLength(2);
    expect(bundle.stations.filter((s) => s.id === 'base:rw-tannrode')).toHaveLength(1);
    // Einstellungen gezielt geändert, alles andere bleibt.
    expect(bundle.settings.hilfsfrist.minutes).toBe(10);
    expect(bundle.settings.hilfsfrist.targetQuota).toBe(0.95);
    expect(bundle.mods.map((m) => m.id)).toEqual(['test']);
  });

  it('ungültige Einstellungen aus einem Mod werden gemeldet', () => {
    expect(() =>
      loadContentLayers([
        base,
        {
          id: 'kaputt',
          files: [
            {
              path: 'x.json',
              text: JSON.stringify({ settingsOverride: { hilfsfrist: { minutes: -3 } } }),
            },
          ],
        },
      ]),
    ).toThrow(ContentError);
  });

  it('kaputte Mods werden übersprungen, gute geladen', () => {
    mod('a-gut', {
      mod: { mod: { id: 'gut', name: 'Gut', version: '1.0' } },
      szenario: {
        scenarios: [
          {
            id: 'gut:uebung',
            name: 'Übung',
            startHour: 9,
            calls: [{ atMinutes: 1, diagnosis: 'base:fall' }],
          },
        ],
      },
    });
    mod('b-kaputt', {
      mod: { mod: { id: 'kaputt', name: 'Kaputt', version: '1.0' } },
      fehler: { stations: [{ id: 'x:wache' }] },
    });
    mod('c-verweis', {
      szenario: {
        scenarios: [
          { id: 'c:uebung', name: 'Verweis', startHour: 9, calls: [{ atMinutes: 1, fire: 'x:gibtsnicht' }] },
        ],
      },
    });
    const { bundle, mods } = loadWithMods(BASE, tmp);
    expect(mods.map((m) => [m.folder, m.ok])).toEqual([
      ['a-gut', true],
      ['b-kaputt', false],
      ['c-verweis', false],
    ]);
    expect(mods[2]?.problems?.join(' ')).toContain('x:gibtsnicht');
    expect(bundle.scenarios.some((s) => s.id === 'gut:uebung')).toBe(true);
    expect(bundle.scenarios.some((s) => s.id === 'c:uebung')).toBe(false);
  });

  it('das Beispiel-Mod der Doku lädt fehlerfrei', () => {
    const { mods, bundle } = loadWithMods(BASE, join(import.meta.dirname, '..', '..', '..', 'docs', 'examples', 'mods'));
    expect(mods).toEqual([
      expect.objectContaining({ folder: 'beispiel-nachtdienst', ok: true, id: 'beispiel-nachtdienst' }),
    ]);
    expect(bundle.stations.find((x) => x.id === 'base:rw-tannrode')?.vehicles).toHaveLength(3);
    expect(bundle.settings.hilfsfrist.minutes).toBe(10);
  });

  it('ohne Mod-Ordner gibt es nur die Basis', () => {
    const { bundle, mods } = loadWithMods(BASE, join(tmp, 'gibt-es-nicht'));
    expect(mods).toEqual([]);
    expect(bundle.mods).toEqual([]);
    expect(bundle.hilfsfristPresets.length).toBeGreaterThanOrEqual(4);
    expect(bundle.scenarios.length).toBeGreaterThanOrEqual(3);
  });
});
