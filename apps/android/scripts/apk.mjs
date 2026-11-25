// Baut die Web-App, überträgt sie ins Android-Projekt und erzeugt die APK (ADR-0021).
// Plattformneutral: ruft auf Windows gradlew.bat, sonst ./gradlew auf.
// Aufruf: pnpm --filter @ls112/android apk [-- --release]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const release = process.argv.includes('--release');
const win = process.platform === 'win32';

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: win });
}

if (
  !process.env.ANDROID_HOME &&
  !process.env.ANDROID_SDK_ROOT &&
  !existsSync(join(androidDir, 'local.properties'))
) {
  console.error('Android-SDK nicht gefunden: ANDROID_HOME setzen (siehe docs/android.md).');
  process.exit(1);
}

run('pnpm', ['run', 'build'], root);
run('pnpm', ['exec', 'cap', 'sync', 'android'], root);
run(win ? 'gradlew.bat' : './gradlew', [release ? 'assembleRelease' : 'assembleDebug'], androidDir);

const out = join(androidDir, 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
console.log(`APK gebaut → ${out}`);
