/**
 * Mods auf die Basis legen, ohne Dateisystem (ADR-0019). Windows liest die Schichten aus
 * Ordnern (`node.ts`), Android aus IndexedDB (ADR-0021) – die Regeln sind dieselben.
 */
import { ContentError, loadContentLayers, type ContentLayer } from './loader';
import type { ContentBundle } from './schema';

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
 * Jeder Mod wird einzeln geprüft: Ein fehlerhafter Mod wird übersprungen und gemeldet, statt das
 * Spiel zu blockieren. Die Reihenfolge der Mods bestimmt, wer gleiche IDs zuletzt ersetzt.
 */
export function loadWithModLayers(
  base: ContentLayer,
  mods: readonly ContentLayer[],
): { bundle: ContentBundle; mods: ModStatus[] } {
  const layers: ContentLayer[] = [base];
  const status: ModStatus[] = [];
  let bundle = loadContentLayers(layers);
  for (const layer of mods) {
    try {
      const next = loadContentLayers([...layers, layer]);
      layers.push(layer);
      bundle = next;
      const info = next.mods.at(-1);
      status.push({
        folder: layer.id,
        ok: true,
        ...(info ? { id: info.id, name: info.name, version: info.version } : {}),
      });
    } catch (error) {
      const problems =
        error instanceof ContentError
          ? error.problems.map((p) => `${p.file}${p.path ? ` › ${p.path}` : ''}: ${p.message}`)
          : [String(error)];
      status.push({ folder: layer.id, ok: false, problems: problems.slice(0, 20) });
    }
  }
  return { bundle, mods: status };
}
