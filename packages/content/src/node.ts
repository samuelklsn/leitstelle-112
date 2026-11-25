/** Lädt Inhalte aus einem Ordner (Node/Electron). Getrennt, damit der Kern ohne `fs` auskommt. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ContentError, loadContent, loadContentLayers, type ContentFile, type ContentLayer } from './loader';
import type { ContentBundle } from './schema';

export function readContentFiles(...dirs: string[]): ContentFile[] {
  const files: ContentFile[] = [];
  const walk = (root: string, dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(root, full);
      else if (/\.(ya?ml|json)$/i.test(name)) {
        files.push({
          path: relative(root, full).replaceAll('\\', '/'),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  for (const dir of dirs) walk(dir, dir);
  return files;
}

export function loadContentFromDirs(...dirs: string[]): ContentBundle {
  return loadContent(readContentFiles(...dirs));
}

/** Ergebnis eines Mods beim Laden: geladen oder mit Fehlern übersprungen. */
export interface ModStatus {
  readonly folder: string;
  readonly id?: string;
  readonly name?: string;
  readonly version?: string;
  readonly ok: boolean;
  readonly problems?: readonly string[];
}

/**
 * Basis plus Mods aus Unterordnern (ADR-0019). Jeder Mod wird einzeln geprüft: Ein fehlerhafter
 * Mod wird übersprungen und gemeldet, statt das Spiel zu blockieren.
 */
export function loadWithMods(
  baseDir: string,
  modsDir: string | undefined,
): { bundle: ContentBundle; mods: ModStatus[] } {
  const base: ContentLayer = { id: 'base', files: readContentFiles(baseDir) };
  const layers: ContentLayer[] = [base];
  const status: ModStatus[] = [];
  let bundle = loadContentLayers(layers);
  const folders =
    modsDir && existsSync(modsDir)
      ? readdirSync(modsDir)
          .filter((n) => statSync(join(modsDir, n)).isDirectory())
          .sort()
      : [];
  for (const folder of folders) {
    const layer: ContentLayer = { id: folder, files: readContentFiles(join(modsDir ?? '', folder)) };
    try {
      const next = loadContentLayers([...layers, layer]);
      layers.push(layer);
      bundle = next;
      const info = next.mods.at(-1);
      status.push({
        folder,
        ok: true,
        ...(info ? { id: info.id, name: info.name, version: info.version } : {}),
      });
    } catch (error) {
      const problems =
        error instanceof ContentError
          ? error.problems.map((p) => `${p.file}${p.path ? ` › ${p.path}` : ''}: ${p.message}`)
          : [String(error)];
      status.push({ folder, ok: false, problems: problems.slice(0, 20) });
    }
  }
  return { bundle, mods: status };
}
