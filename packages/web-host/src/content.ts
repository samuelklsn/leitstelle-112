/**
 * Basisinhalte und eigene Mods als Inhalts-Schichten (ADR-0009, ADR-0019, ADR-0021).
 * Die Basis-YAML-Dateien bündelt Vite beim Bauen in die App – zur Laufzeit wird nichts geladen.
 */
import type { ContentFile, ContentLayer } from '@ls112/content';
import type { ModFileRecord } from './idb';

const baseFiles = import.meta.glob<string>('../../../content/base/*.{yaml,yml,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const BASE_LAYER: ContentLayer = {
  id: 'base',
  files: Object.entries(baseFiles)
    .map(([path, text]): ContentFile => ({ path: path.split('/').at(-1) ?? path, text }))
    .sort((a, b) => a.path.localeCompare(b.path)),
};

/** Mod-Dateien aus IndexedDB zu Schichten bündeln – je Mod eine, nach Ordnername sortiert. */
export function modLayers(files: readonly ModFileRecord[]): ContentLayer[] {
  const byMod = new Map<string, ContentFile[]>();
  for (const f of files) {
    const list = byMod.get(f.modId) ?? [];
    list.push({ path: `${f.fileName}.json`, text: f.text });
    byMod.set(f.modId, list);
  }
  return [...byMod.keys()].sort().map((id) => ({
    id,
    files: (byMod.get(id) ?? []).sort((a, b) => a.path.localeCompare(b.path)),
  }));
}
