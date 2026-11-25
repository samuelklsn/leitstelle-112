/**
 * Kommandozeile des Region-Builders (ADR-0020):
 *
 *   pnpm --filter @ls112/region-builder region -- --input kreis.osm --id mein-kreis \
 *     --name "Landkreis Musterstadt" --out "%APPDATA%/Leitstelle112/mods/mein-kreis"
 *
 * Eingabe ist OSM-XML. Aus einer PBF-Datei (z. B. von Geofabrik) entsteht sie mit
 * `osmium extract` und `osmium cat auszug.pbf -o auszug.osm` (Osmium ist ein externes Werkzeug).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRegionMod, parseOsm } from './osm';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const input = arg('input');
const id = arg('id');
const name = arg('name');
const out = arg('out');
if (!input || !id || !name || !out) {
  console.error('Aufruf: --input <datei.osm> --id <mod-id> --name <Name> --out <Mod-Ordner>');
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) {
  console.error('Die ID darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.');
  process.exit(2);
}
const started = Date.now();
const files = buildRegionMod(parseOsm(readFileSync(input, 'utf8')), { id, name });
mkdirSync(out, { recursive: true });
for (const [file, data] of Object.entries(files))
  writeFileSync(join(out, `${file}.json`), JSON.stringify(data));
console.log(
  `Region-Mod „${name}“ geschrieben nach ${out} (${((Date.now() - started) / 1000).toFixed(1)} s).`,
);
console.log(
  'Kartendaten © OpenStreetMap-Mitwirkende, ODbL 1.0 – die Namensnennung steht in der Region.',
);
