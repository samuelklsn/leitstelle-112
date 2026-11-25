/** Lädt Inhalte aus einem Ordner (Node/Electron). Getrennt, damit der Kern ohne `fs` auskommt. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadContent, type ContentFile, type ContentLayer } from './loader';
import { loadWithModLayers, type ModStatus } from './mods';
import type { ContentBundle } from './schema';

export type { ModStatus };

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

/**
 * Basis plus Mods aus Unterordnern (ADR-0019). Jeder Mod wird einzeln geprüft: Ein fehlerhafter
 * Mod wird übersprungen und gemeldet, statt das Spiel zu blockieren.
 */
export function loadWithMods(
  baseDir: string,
  modsDir: string | undefined,
): { bundle: ContentBundle; mods: ModStatus[] } {
  const base: ContentLayer = { id: 'base', files: readContentFiles(baseDir) };
  const folders =
    modsDir && existsSync(modsDir)
      ? readdirSync(modsDir)
          .filter((n) => statSync(join(modsDir, n)).isDirectory())
          .sort()
      : [];
  const mods = folders.map(
    (folder): ContentLayer => ({ id: folder, files: readContentFiles(join(modsDir ?? '', folder)) }),
  );
  return loadWithModLayers(base, mods);
}
