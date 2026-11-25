import { useTranslation } from 'react-i18next';
import { SPEEDS } from '@ls112/protocol';
import { formatClock, formatDate } from './format';
import { isAndroid, useCompact } from './platform';
import { WINDOW_VIEW, useSim, type WindowView } from './sim-store';
import { useGlobalShortcuts } from './use-shortcuts';
import { MapView } from './components/MapView';
import { TutorialCoach } from './components/Overlays';
import { GlobalDialogs, SideDialogs } from './components/DialogHost';
import { BottomTabs, CallsPanel, VehiclePanel } from './components/Panels';
import { MobileShell } from './components/MobileShell';
import { Notice, SoundToggle, WorldChips } from './components/StatusBits';
import css from './App.module.css';

export function App() {
  useGlobalShortcuts();
  const compact = useCompact();
  if (WINDOW_VIEW !== 'main') return <SecondaryWindow view={WINDOW_VIEW} />;
  // Telefone und schmale Fenster: ein Bereich zur Zeit (ADR-0021).
  if (compact) return <MobileShell />;
  return (
    <div className={css.shell}>
      <Header />
      <main className={css.workspace}>
        <CallsPanel />
        <section className={css.map} aria-label="Lagekarte">
          <MapView />
          <SideDialogs />
          <TutorialCoach />
        </section>
        <VehiclePanel />
        <BottomTabs />
      </main>
      <Footer />
      <GlobalDialogs />
      <Notice />
    </div>
  );
}

/**
 * Ausgelagerte Ansicht für einen weiteren Bildschirm (#50): Lagekarte, Listen oder
 * Fahrzeugstatus. Dialoge öffnen sich im Hauptfenster.
 */
function SecondaryWindow({ view }: { view: Exclude<WindowView, 'main'> }) {
  return (
    <div className={css.shell}>
      <Header secondary />
      <main className={css.single} data-testid={`window-${view}`}>
        {view === 'map' && (
          <section className={css.map} aria-label="Lagekarte">
            <MapView />
          </section>
        )}
        {view === 'lists' && <BottomTabs />}
        {view === 'vehicles' && <VehiclePanel />}
      </main>
      <Notice />
    </div>
  );
}

function Header({ secondary = false }: { secondary?: boolean }) {
  const { t } = useTranslation();
  const host = useSim((s) => s.host);
  const world = useSim((s) => s.world);
  const status = useSim((s) => s.status);
  const togglePause = useSim((s) => s.togglePause);
  const setSpeed = useSim((s) => s.setSpeed);
  const openDialog = useSim((s) => s.openDialog);
  const paused = host?.paused ?? false;
  return (
    <header className={css.header}>
      <div className={css.brand}>
        <span className={css.brandMark} aria-hidden="true">
          112
        </span>
        <span className={css.brandTitle}>{t('app.title')}</span>
        <span className={css.brandSub}>{world?.centerName}</span>
      </div>
      {!secondary && (
        <nav className={css.menu}>
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'start' });
            }}
            data-testid="menu-new"
          >
            {t('menu.new')}
          </button>
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'saves' });
            }}
          >
            {t('menu.saves')}
          </button>
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'evaluation' });
            }}
            data-testid="open-evaluation"
          >
            {t('menu.evaluation')}
          </button>
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'help' });
            }}
          >
            {t('menu.help')}
          </button>
          {/* Mehrere Fenster gibt es nur unter Windows (#50). */}
          {!isAndroid() && (
            <button
              type="button"
              onClick={() => {
                openDialog({ kind: 'windows' });
              }}
              data-testid="menu-windows"
            >
              {t('menu.windows')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'keys' });
            }}
            data-testid="menu-keys"
          >
            {t('menu.keys')}
          </button>
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'mods' });
            }}
            data-testid="menu-mods"
          >
            {t('menu.mods')}
          </button>
        </nav>
      )}
      <div className={css.clock} data-testid="sim-clock">
        {host && (
          <>
            <span className={css.shift}>{t('clock.shift', { n: host.view.shift.index })}</span>
            <span className={css.clockDate}>
              {formatDate(
                host.view.calendar,
                t(`clock.weekday.${host.view.calendar.weekday.toString()}`),
              )}
            </span>
            <span className={css.clockTime} data-testid="sim-time">
              {formatClock(host.view.calendar)}
            </span>
            <WorldChips />
            {paused && (
              <span className={css.pausedBadge} data-testid="paused-badge">
                {t('clock.paused')}
              </span>
            )}
          </>
        )}
      </div>
      <div className={css.controls} role="group" aria-label={t('shortcuts.speed')}>
        <button
          type="button"
          className={`${css.ctrl ?? ''} ${paused ? (css.ctrlActive ?? '') : ''}`}
          onClick={togglePause}
          aria-pressed={paused}
          data-testid="btn-pause"
          title={`${paused ? t('clock.resume') : t('clock.pause')} (Leertaste)`}
        >
          {paused ? '▶' : '❚❚'}
        </button>
        {SPEEDS.map((speed, i) => (
          <button
            key={speed}
            type="button"
            className={`${css.ctrl ?? ''} ${host?.speed === speed && !paused ? (css.ctrlActive ?? '') : ''}`}
            onClick={() => {
              setSpeed(speed);
            }}
            aria-pressed={host?.speed === speed}
            data-testid={`btn-speed-${speed.toString()}`}
            title={`${t('clock.speed', { speed })} (${(i + 1).toString()})`}
          >
            {speed}×
          </button>
        ))}
      </div>
      <SoundToggle />
      <div className={css.connection} role="status" title={t(`app.${status}`)}>
        <span
          className={`${css.dot ?? ''} ${status === 'connected' ? (css.dotOk ?? '') : status === 'disconnected' ? (css.dotBad ?? '') : ''}`}
        />
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useTranslation();
  const shift = useSim((s) => s.host?.view.shift);
  const quota =
    shift && shift.hilfsfristMeasured > 0
      ? `${Math.round((100 * shift.hilfsfristMet) / shift.hilfsfristMeasured).toString()} %`
      : '–';
  return (
    <footer className={css.footer}>
      <span className={css.stat}>
        {t('stats.received')}
        <strong data-testid="stat-received">{shift?.callsReceived ?? 0}</strong>
      </span>
      <span className={css.stat}>
        {t('stats.incidents')}
        <strong>{shift?.incidents ?? 0}</strong>
      </span>
      <span className={css.stat}>
        {t('stats.hilfsfrist')}
        <strong>{quota}</strong>
      </span>
      <span className={css.stat}>
        {t('stats.score')}
        <strong data-testid="stat-score">{shift?.score ?? 0}</strong>
      </span>
      <span className={css.shortcuts} aria-label={t('shortcuts.title')}>
        <span>
          <kbd>Leertaste</kbd> {t('shortcuts.pause')}
        </span>
        <span>
          <kbd>1–4</kbd> {t('shortcuts.speed')}
        </span>
        <span>
          <kbd>F2</kbd> {t('shortcuts.accept')}
        </span>
        <span>
          <kbd>F3</kbd> {t('shortcuts.dispatch')}
        </span>
        <span>
          <kbd>F4</kbd> {t('shortcuts.destination')}
        </span>
      </span>
    </footer>
  );
}
