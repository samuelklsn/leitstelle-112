/** Lädt Inhalte aus einem Ordner (Node/Electron). Getrennt, damit der Kern ohne `fs` auskommt. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadContent, type ContentFile } from './loader';
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
