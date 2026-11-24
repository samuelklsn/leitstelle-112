import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SPEEDS } from '@ls112/protocol';
import { formatClock, formatDate, formatTimeOfDay } from './format';
import { lookup } from './lookup';
import { WINDOW_VIEW, useSim, type WindowView } from './sim-store';
import { useGlobalShortcuts } from './use-shortcuts';
import { CallMask } from './components/CallMask';
import { DestinationDialog, DispatchDialog } from './components/DispatchDialog';
import { MapView } from './components/MapView';
import {
  EvaluationDialog,
  HelpDialog,
  SavesDialog,
  StartScreen,
  TutorialCoach,
} from './components/Overlays';
import { BottomTabs, CallsPanel, VehiclePanel } from './components/Panels';
import { KeysDialog, WindowsDialog } from './components/Settings';
import { MciDialog } from './components/MciDialog';
import css from './App.module.css';

export function App() {
  useGlobalShortcuts();
  const dialog = useSim((s) => s.dialog);
  if (WINDOW_VIEW !== 'main') return <SecondaryWindow view={WINDOW_VIEW} />;
  return (
    <div className={css.shell}>
      <Header />
      <main className={css.workspace}>
        <CallsPanel />
        <section className={css.map} aria-label="Lagekarte">
          <MapView />
          {dialog?.kind === 'call' && <CallMask key={dialog.callId} callId={dialog.callId} />}
          {dialog?.kind === 'dispatch' && (
            <DispatchDialog key={dialog.incidentId} incidentId={dialog.incidentId} />
          )}
          {dialog?.kind === 'destination' && (
            <DestinationDialog key={dialog.vehicleId} vehicleId={dialog.vehicleId} />
          )}
          <TutorialCoach />
        </section>
        <VehiclePanel />
        <BottomTabs />
      </main>
      <Footer />
      {dialog?.kind === 'start' && <StartScreen />}
      {dialog?.kind === 'evaluation' && <EvaluationDialog shift={dialog.shift} />}
      {dialog?.kind === 'saves' && <SavesDialog />}
      {dialog?.kind === 'help' && <HelpDialog />}
      {dialog?.kind === 'windows' && <WindowsDialog />}
      {dialog?.kind === 'keys' && <KeysDialog />}
      {dialog?.kind === 'mci' && <MciDialog incidentId={dialog.incidentId} />}
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
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'windows' });
            }}
            data-testid="menu-windows"
          >
            {t('menu.windows')}
          </button>
          <button
            type="button"
            onClick={() => {
              openDialog({ kind: 'keys' });
            }}
            data-testid="menu-keys"
          >
            {t('menu.keys')}
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

function Notice() {
  const notice = useSim((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      useSim.setState({ notice: null });
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);
  return notice ? <div className={css.notice}>{notice.text}</div> : null;
}

/** Weltlage kompakt: Wetter mit Temperatur, Feiertag und laufende Ereignisse (ADR-0016). */
function WorldChips() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const view = useSim((s) => s.host?.view.world);
  if (!world || !view) return null;
  const L = lookup(world);
  const weather = world.weather.find((w) => w.id === view.weatherId);
  return (
    <span className={css.world} data-testid="world-chips">
      {weather && (
        <span
          className={`${css.chip ?? ''} ${weather.flyable ? '' : (css.chipWarn ?? '')}`}
          title={`${weather.name}${weather.flyable ? '' : ` – ${t('world.noFlying')}`}`}
          data-testid="weather-chip"
        >
          {weather.symbol} {view.temperature} °C · {weather.name}
        </span>
      )}
      {view.holiday && <span className={css.chip}>{view.holiday}</span>}
      {view.events.map((e) => {
        const name = world.worldEvents.find((x) => x.id === e.eventId)?.name ?? e.eventId;
        const place = e.townId
          ? L.townName(e.townId)
          : e.closure
            ? L.streetName(e.closure.streetId)
            : undefined;
        return (
          <span
            key={e.key}
            className={`${css.chip ?? ''} ${css.chipWarn ?? ''}`}
            title={t('world.until', { time: formatTimeOfDay(e.until) })}
          >
            {name}
            {place ? ` · ${place}` : ''}
          </span>
        );
      })}
    </span>
  );
}
