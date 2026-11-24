import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * E2E gegen die gebaute App (`pnpm build` vorher): Start, Takt, Pause, Zeitraffer und ein
 * kompletter Einsatz vom Notruf bis zur Zielklinik – wie ein Spieler ihn bedient.
 * Mit LS112_SCREENSHOTS=1 entstehen dabei die Bilder für die Dokumentation (docs/images).
 */
let app: ElectronApplication;
let page: Page;
let userData: string;
const SHOTS = process.env.LS112_SCREENSHOTS === '1';
const shot = async (name: string) => {
  if (SHOTS)
    await page.screenshot({
      path: join(import.meta.dirname, '..', 'docs', 'images', `${name}.png`),
    });
};

const readClock = async () => (await page.getByTestId('sim-time').textContent()) ?? '';
const toSeconds = (hms: string) => {
  const [h, m, s] = hms.split(':').map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'ls112-e2e-'));
  const started = Date.now();
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'apps', 'desktop')],
    env: {
      ...process.env,
      LS112_E2E: '1',
      LS112_USER_DATA: userData,
      LS112_SEED: '112',
      LS112_CALL_RATE: '12',
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByTestId('start-screen')).toBeVisible();
  // Anforderung: Spielstart unter 5 Sekunden.
  expect(Date.now() - started).toBeLessThan(5000);
});

test.afterAll(async () => {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
});

test('Startbildschirm und freies Spiel', async () => {
  await expect(page).toHaveTitle('Leitstelle 112');
  await page.waitForTimeout(800);
  await shot('startbildschirm');
  await page.getByTestId('start-free').click();
  await expect(page.getByTestId('start-screen')).toBeHidden();
  await expect(page.getByTestId('vehicle-row')).toHaveCount(7);
});

test('Takt, Pause und Zeitraffer', async () => {
  const a = toSeconds(await readClock());
  await page.waitForTimeout(2100);
  expect(toSeconds(await readClock()) - a).toBeGreaterThanOrEqual(1);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('paused-badge')).toBeVisible();
  const p = await readClock();
  await page.waitForTimeout(1200);
  expect(await readClock()).toBe(p);
  await page.keyboard.press('Space');
  await page.getByTestId('btn-speed-10').click();
  const b = toSeconds(await readClock());
  await page.waitForTimeout(2000);
  expect(toSeconds(await readClock()) - b).toBeGreaterThanOrEqual(12);
});

test('kompletter Einsatz: Notruf → Disposition → Anfahrt → Zielklinik', async () => {
  await expect(page.getByTestId('call-row').first()).toBeVisible({ timeout: 40_000 });
  await page.keyboard.press('1');
  await page.keyboard.press('F2');
  const mask = page.getByTestId('call-mask');
  await expect(mask).toBeVisible();
  await expect(page.getByTestId('transcript')).toContainText('Wo genau');
  await page.getByTestId('take-address').click();
  const results = page.getByTestId('address-results').locator('button');
  await expect(results.first()).toBeVisible();
  await results.first().click();
  await page.getByTestId('keyword-RD2').click();
  await page.getByTestId('btn-pause').click();
  await shot('notrufabfrage');
  await page.getByTestId('btn-pause').click();
  await page.getByTestId('create-incident').click();

  const dispatch = page.getByTestId('dispatch-dialog');
  await expect(dispatch).toBeVisible();
  await expect(page.getByTestId('alarm')).toBeEnabled();
  await shot('disposition');
  await page.getByTestId('alarm').click();
  await expect(dispatch).toBeHidden();

  await page.getByTestId('btn-speed-10').click();
  await expect(page.getByTestId('vehicle-marker').first()).toBeVisible();
  await page.getByTestId('tab-radio').click();
  await expect(page.getByTestId('event-log')).toContainText('Einsatz übernommen', {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  await shot('lagekarte-funk');
  await page.getByTestId('tab-incidents').click();

  // Auf den Sprechwunsch warten (Status 5) und Zielklinik zuweisen.
  // Behandlung vor Ort dauert realistisch 10–35 Spielminuten.
  await expect(page.getByTestId('destination-btn').first()).toBeVisible({ timeout: 360_000 });
  await page.getByTestId('btn-pause').click();
  await page.keyboard.press('F4');
  await expect(page.getByTestId('destination-dialog')).toBeVisible();
  await shot('zielklinik');
  await page.getByTestId('assign-destination').click();
  await page.getByTestId('btn-pause').click();
  await expect(page.getByTestId('incident-list')).toContainText('▶');
});

test('Auswertung zeigt die laufende Schicht', async () => {
  await page.waitForTimeout(3000);
  await page.getByTestId('btn-pause').click();
  await shot('einsatzliste');
  await page.getByTestId('open-evaluation').click();
  await expect(page.getByTestId('evaluation')).toBeVisible();
  await shot('auswertung');
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-pause').click();
});

test('stellt die Simulation nach einem Absturz aus dem Autosave wieder her', async () => {
  // Autosave alle 5 Spielminuten – bei 10× genügen gut 30 s Echtzeit.
  await page.getByTestId('btn-speed-10').click();
  await page.waitForTimeout(32_000);
  await page.evaluate(() => {
    window.ls112?.e2eCrashSimHost();
  });
  await expect
    .poll(async () => page.evaluate(async () => (await window.ls112?.appInfo())?.simHostRestarts), {
      timeout: 15_000,
    })
    .toBe(1);
  await page.waitForTimeout(1500);
  // Fortgesetzt aus dem Autosave – nicht wieder beim Schichtbeginn um 07:00.
  expect(toSeconds(await readClock())).toBeGreaterThan(7 * 3600 + 120);
  const crashes = readdirSync(join(userData, 'crashes')).filter((f) =>
    f.endsWith('-sim-host.json'),
  );
  expect(crashes.length).toBe(1);
});
