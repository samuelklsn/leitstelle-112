import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentError, loadContent } from './loader';
import { loadContentFromDirs, readContentFiles } from './node';

const BASE = join(import.meta.dirname, '..', '..', '..', 'content', 'base');

describe('Basisinhalte', () => {
  it('sind gültig und vollständig verknüpft', () => {
    const c = loadContentFromDirs(BASE);
    expect(c.region.towns.length).toBeGreaterThanOrEqual(5);
    expect(c.stations.flatMap((s) => s.vehicles)).toHaveLength(7);
    expect(c.hospitals).toHaveLength(2);
    expect(c.keywords.map((k) => k.code)).toContain('RD 2');
    expect(c.diagnoses.length).toBeGreaterThanOrEqual(12);
  });
});

describe('Validierung', () => {
  const files = readContentFiles(BASE);

  it('meldet Schemafehler mit Datei und Pfad', () => {
    const broken = files.map((f) =>
      f.path.startsWith('fahrzeuge')
        ? { ...f, text: f.text.replace('radioCode: 83', 'radioCode: 830') }
        : f,
    );
    try {
      loadContent(broken);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ContentError);
      const p = (e as ContentError).problems[0];
      expect(p?.file).toBe('fahrzeuge-wachen-kliniken.yaml');
      expect(p?.path).toBe('vehicleTypes.0.radioCode');
    }
  });

  it('meldet kaputte Querverweise', () => {
    const broken = files.map((f) =>
      f.path.startsWith('einsaetze')
        ? { ...f, text: f.text.replace('keyword: base:rd3', 'keyword: base:rd9') }
        : f,
    );
    expect(() => loadContent(broken)).toThrow(/Unbekanntes Stichwort base:rd9/);
  });

  it('meldet YAML-Syntaxfehler', () => {
    expect(() => loadContent([...files, { path: 'kaputt.yaml', text: 'a: [1, 2' }])).toThrow(
      /Syntaxfehler/,
    );
  });
});
