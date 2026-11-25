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
      LS112_DIAG_DIR: userData,
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

test('Startbildschirm und Tutorial', async () => {
  await expect(page).toHaveTitle('Leitstelle 112');
  await page.waitForTimeout(800);
  await shot('startbildschirm');
  // Das Tutorial garantiert als ersten Anruf einen echten Notfall.
  await page.getByTestId('start-tutorial').click();
  await expect(page.getByTestId('tutorial-coach')).toBeVisible();
  await expect(page.getByTestId('start-screen')).toBeHidden();
  // Rettungsdienst, Hubschrauber, Einsatzleitung, SEG und 16 Feuerwehrfahrzeuge.
  await expect(page.getByTestId('vehicle-row')).toHaveCount(37);
  await expect(page.getByTestId('weather-chip')).toBeVisible();
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
  // Strukturierte Abfrage: Fragen stellen, Antworten kommen nach einigen Sekunden.
  await expect(page.getByTestId('take-address')).toBeDisabled();
  await page.getByTestId('ask-all').click();
  await expect(page.getByTestId('transcript')).toContainText('Atmet die Person normal?');
  await expect(page.getByTestId('take-address')).toBeEnabled({ timeout: 30_000 });
  // Alle Antworten abwarten – der Anrufer antwortet nacheinander.
  await expect(page.getByTestId('typing')).toHaveCount(0, { timeout: 90_000 });
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
  await expect(page.getByTestId('vehicle-marker').filter({ visible: true }).first()).toBeVisible();
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

test('Logistik: Transportaufträge, Kliniken und Status 6', async () => {
  // Freies Spiel: Zum Schichtbeginn liegen vorbestellte Krankentransporte vor.
  await page.getByTestId('menu-new').click();
  // Sommerbeginn: anderes Wetter und andere Lage als im Training (ADR-0016).
  await page.getByTestId('start-preset').selectOption('summer');
  await page.getByTestId('start-free').click();
  await expect(page.getByTestId('start-screen')).toBeHidden();
  await page.getByTestId('tab-orders').click();
  // Vorbestellte Aufträge: werktags fünf, am Wochenende weniger.
  await expect(page.getByTestId('order-row').first()).toBeVisible();
  await page.getByTestId('order-row').first().getByRole('button').click();
  await expect(page.getByTestId('dispatch-dialog')).toBeVisible();
  await page.getByTestId('alarm').click();
  await expect(page.getByTestId('dispatch-dialog')).toBeHidden();
  // Tages-RTW, ITW und ein KTW beginnen erst um 8 Uhr (Status 6).
  await expect(page.getByTestId('vehicle-panel')).toContainText('Dienstende');
  await page.waitForTimeout(1500);
  await page.getByTestId('btn-pause').click();
  await shot('auftraege');
  await page.getByTestId('tab-hospitals').click();
  await expect(page.getByTestId('hospital-panel')).toContainText('Stroke Unit');
  await shot('kliniken');
  await page.getByTestId('tab-incidents').click();
  await page.getByTestId('btn-pause').click();
});

test('Mehrfenster: Lagekarte auf einem weiteren Bildschirm, Auswahl gilt überall', async () => {
  await page.getByTestId('menu-windows').click();
  await expect(page.getByTestId('windows-dialog')).toContainText('Ein Bildschirm');
  await shot('fenster');
  const opened = app.waitForEvent('window');
  await page.getByTestId('open-window-lists').click();
  const lists = await opened;
  await expect(lists.getByTestId('window-lists')).toBeVisible();
  // Nebenfenster haben kein Menü und keinen Startbildschirm.
  await expect(lists.getByTestId('menu-windows')).toHaveCount(0);
  await expect(lists.getByTestId('start-screen')).toHaveCount(0);
  await lists.getByTestId('tab-orders').click();
  await expect(lists.getByTestId('order-row').first()).toBeVisible();
  // Disponieren im Nebenfenster öffnet den Dialog im Hauptfenster.
  await lists.getByRole('button', { name: 'Disponieren' }).first().click();
  await expect(page.getByTestId('dispatch-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await lists.close();
});

test('Tastenbelegung ändern und Diagnosepaket erstellen', async () => {
  await page.getByTestId('menu-keys').click();
  await page.getByTestId('key-help').click();
  await page.keyboard.press('F6');
  await expect(page.getByTestId('key-help')).toHaveText('F6');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('keys-dialog')).toBeHidden();
  await page.keyboard.press('F6');
  await expect(page.getByRole('dialog', { name: 'Tastatur und Ablauf' })).toBeVisible();
  await page.getByTestId('create-diagnostics').click();
  await expect.poll(() => readdirSync(userData).filter((f) => f.endsWith('.zip')).length).toBe(1);
  await page.keyboard.press('Escape');
});

test('MANV-Übung: Großlage melden, alarmieren, Sichtung abwarten', async () => {
  await page.getByTestId('menu-new').click();
  await page.getByTestId('start-preset').selectOption('drill');
  await page.getByTestId('start-free').click();
  await expect(page.getByTestId('call-row').first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('F2');
  await page.getByTestId('ask-all').click();
  await expect(page.getByTestId('take-address')).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId('typing')).toHaveCount(0, { timeout: 90_000 });
  await page.getByTestId('take-address').click();
  await page.getByTestId('address-results').locator('button').first().click();
  await page.getByTestId('keyword-MANV2').click();
  await page.getByTestId('create-incident').click();
  await expect(page.getByTestId('alarm')).toBeEnabled();
  await page.getByTestId('alarm').click();
  await page.getByTestId('btn-speed-10').click();
  // Lagemeldung nach dem Eintreffen, dann Sichtung durch den Leitenden Notarzt.
  await expect(page.getByTestId('open-mci')).toBeVisible({ timeout: 180_000 });
  await page.getByTestId('open-mci').click();
  await expect(page.getByTestId('mci-dialog')).toBeVisible();
  // Der Haken folgt dem Zustand des Sim-Hosts – erst klicken, dann auf die Rückmeldung warten.
  await page.getByTestId('mci-auto').click();
  await expect(page.getByTestId('mci-auto')).toBeChecked();
  await expect(page.getByTestId('mci-patients')).toBeVisible({ timeout: 240_000 });
  await shot('manv');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mci-dialog')).toBeHidden();
});

test('Tages-Herausforderung: Laufbahn und Bedarfsplanung in der Auswertung', async () => {
  await page.getByTestId('menu-new').click();
  await page.getByTestId('start-preset').selectOption('daily');
  await page.getByTestId('start-free').click();
  await expect(page.getByTestId('start-screen')).toBeHidden();
  await page.keyboard.press('F9');
  await expect(page.getByTestId('evaluation')).toBeVisible();
  await expect(page.getByTestId('career')).toContainText('Disponent');
  await expect(page.getByTestId('daily-challenge')).toBeVisible();
  await shot('laufbahn');
  await page.keyboard.press('Escape');
});

test('Szenario-Editor: eigenes Szenario als Mod speichern und spielen', async () => {
  await page.getByTestId('menu-mods').click();
  await page.getByTestId('open-scenario-editor').click();
  await page.getByTestId('scenario-name').fill('Übung Nordkreis');
  await page.getByTestId('add-call').click();
  await page.getByTestId('add-call').click();
  await shot('szenario-editor');
  await page.getByTestId('save-scenario').click();
  // Der Sim-Host prüft und lädt die Inhalte neu; der Mod erscheint als geladen.
  await expect(page.getByTestId('mods-dialog')).toContainText('eigene-inhalte', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('mods-dialog')).toContainText('geladen');
  await page.keyboard.press('Escape');
  await page.getByTestId('menu-new').click();
  await page.getByTestId('start-scenario').selectOption({ label: 'Übung Nordkreis' });
  await page.getByTestId('start-hilfsfrist').selectOption('base:hf-by');
  await page.getByTestId('start-free').click();
  await expect(page.getByTestId('call-row').first()).toBeVisible({ timeout: 30_000 });
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
