/**
 * Telefon-Layout (ADR-0021): Auf kleinen Bildschirmen passt die Arbeitsfläche mit Notrufen,
 * Karte, Fahrzeugen und Listen nicht nebeneinander. Hier ist immer ein Bereich sichtbar, die
 * Leiste unten wechselt und zeigt an, wo etwas wartet. Schnellknöpfe ersetzen F2/F3/F4.
 * Dieselben Bausteine wie am Desktop – nur anders angeordnet, keine eigene Spiellogik.
 */
import { useTranslation } from 'react-i18next';
import { SPEEDS } from '@ls112/protocol';
import { formatClock, formatDate } from '../format';
import { lookup } from '../lookup';
import { isAndroid } from '../platform';
import { useSim, type Dialog, type MobilePane } from '../sim-store';
import { runAction } from '../use-shortcuts';
import { MapView } from './MapView';
import { Modal, TutorialCoach } from './Overlays';
import { GlobalDialogs, SideDialogs } from './DialogHost';
import { BottomTabs, CallsPanel, VehiclePanel, needsUnits } from './Panels';
import { Notice, SoundToggle, WorldChips } from './StatusBits';
import dialogCss from './Dialog.module.css';
import css from './MobileShell.module.css';

const PANES: readonly { pane: MobilePane; icon: string; label: string }[] = [
  { pane: 'map', icon: '🗺', label: 'mobile.pane.map' },
  { pane: 'calls', icon: '☎', label: 'mobile.pane.calls' },
  { pane: 'vehicles', icon: '🚑', label: 'mobile.pane.vehicles' },
  { pane: 'lists', icon: '☰', label: 'mobile.pane.lists' },
];

export function MobileShell() {
  const pane = useSim((s) => s.mobilePane);
  const dialog = useSim((s) => s.dialog);
  const sideOpen =
    dialog?.kind === 'call' || dialog?.kind === 'dispatch' || dialog?.kind === 'destination';
  return (
    <div className={css.shell} data-testid="mobile-shell">
      <MobileHeader />
      <main className={css.panes}>
        {/* Die Karte bleibt eingehängt, damit Zoom und Ausschnitt beim Wechseln erhalten bleiben. */}
        <section
          className={`${css.pane ?? ''} ${pane === 'map' ? '' : (css.hidden ?? '')}`}
          aria-label="Lagekarte"
        >
          <MapView />
          <TutorialCoach />
        </section>
        {pane === 'calls' && (
          <section className={css.pane}>
            <CallsPanel />
          </section>
        )}
        {pane === 'vehicles' && (
          <section className={css.pane}>
            <VehiclePanel />
          </section>
        )}
        {pane === 'lists' && (
          <section className={css.pane}>
            <BottomTabs />
          </section>
        )}
      </main>
      {!sideOpen && <QuickActions />}
      <TabBar />
      {sideOpen && (
        <div className={css.sheet}>
          <SideDialogs />
        </div>
      )}
      <GlobalDialogs />
      {dialog?.kind === 'menu' && <MenuSheet />}
      <Notice />
    </div>
  );
}

function MobileHeader() {
  const { t } = useTranslation();
  const host = useSim((s) => s.host);
  const togglePause = useSim((s) => s.togglePause);
  const setSpeed = useSim((s) => s.setSpeed);
  const openDialog = useSim((s) => s.openDialog);
  const paused = host?.paused ?? false;
  const speed = host?.speed ?? 1;
  // Ein Knopf schaltet reihum durch die Zeitraffer-Stufen – vier Knöpfe passen nicht.
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
  return (
    <header className={css.header}>
      <div className={css.headRow}>
        <span className={css.brandMark} aria-hidden="true">
          112
        </span>
        <div className={css.clock} data-testid="sim-clock">
          {host && (
            <>
              <span className={css.time} data-testid="sim-time">
                {formatClock(host.view.calendar)}
              </span>
              <span className={css.date}>
                {/* Pause in der Datumszeile – neben der Uhr ist auf dem Telefon kein Platz. */}
                {paused && (
                  <span className={css.paused} data-testid="paused-badge">
                    {t('clock.paused')}
                  </span>
                )}
                {formatDate(
                  host.view.calendar,
                  t(`clock.weekday.${host.view.calendar.weekday.toString()}`),
                )}{' '}
                · {t('clock.shift', { n: host.view.shift.index })}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          className={`${css.ctrl ?? ''} ${paused ? (css.ctrlActive ?? '') : ''}`}
          onClick={togglePause}
          aria-pressed={paused}
          aria-label={paused ? t('clock.resume') : t('clock.pause')}
          data-testid="btn-pause"
        >
          {paused ? '▶' : '❚❚'}
        </button>
        <button
          type="button"
          className={css.ctrl}
          onClick={() => {
            setSpeed(nextSpeed);
          }}
          aria-label={t('clock.speed', { speed: nextSpeed })}
          data-testid="btn-speed-cycle"
        >
          {speed}×
        </button>
        <SoundToggle />
        <button
          type="button"
          className={css.ctrl}
          onClick={() => {
            openDialog({ kind: 'menu' });
          }}
          aria-label={t('mobile.menu')}
          data-testid="menu-open"
        >
          ≡
        </button>
      </div>
      <div className={css.chips}>
        <WorldChips />
      </div>
    </header>
  );
}

/** Zähler für die Leiste: Wo wartet gerade etwas auf den Disponenten? */
function usePaneCounts(): Record<MobilePane, { n: number; alarm: boolean }> {
  const view = useSim((s) => s.host?.view);
  const world = useSim((s) => s.world);
  const waiting = view?.calls.filter((c) => c.status === 'waiting').length ?? 0;
  const requests = view?.vehicles.filter((v) => v.requestSince !== undefined).length ?? 0;
  const L = world ? lookup(world) : undefined;
  const open = L ? (view?.incidents.filter((i) => needsUnits(i, L)).length ?? 0) : 0;
  return {
    map: { n: 0, alarm: false },
    calls: { n: view?.calls.length ?? 0, alarm: waiting > 0 },
    vehicles: { n: requests, alarm: requests > 0 },
    lists: { n: open, alarm: open > 0 },
  };
}

function TabBar() {
  const { t } = useTranslation();
  const pane = useSim((s) => s.mobilePane);
  const setPane = useSim((s) => s.setMobilePane);
  const counts = usePaneCounts();
  return (
    <nav className={css.tabBar} aria-label={t('mobile.menu')}>
      {PANES.map((p) => {
        const c = counts[p.pane];
        return (
          <button
            key={p.pane}
            type="button"
            className={`${css.tab ?? ''} ${pane === p.pane ? (css.tabActive ?? '') : ''}`}
            onClick={() => {
              setPane(p.pane);
            }}
            aria-current={pane === p.pane ? 'page' : undefined}
            data-testid={`pane-${p.pane}`}
          >
            <span className={css.tabIcon} aria-hidden="true">
              {p.icon}
            </span>
            <span>{t(p.label)}</span>
            {c.n > 0 && (
              <span className={`${css.badge ?? ''} ${c.alarm ? (css.badgeAlarm ?? '') : ''}`}>
                {c.n}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Die drei häufigsten Handgriffe als große Knöpfe – mit denselben Regeln wie F2, F3 und F4.
 * Nur sichtbar, wenn es etwas zu tun gibt.
 */
function QuickActions() {
  const { t } = useTranslation();
  const view = useSim((s) => s.host?.view);
  const world = useSim((s) => s.world);
  const start = useSim((s) => s.dialog?.kind === 'start');
  if (!view || !world || start) return null;
  const L = lookup(world);
  const call = view.calls.length > 0;
  const dispatch = view.incidents.some((i) => needsUnits(i, L));
  const destination = view.vehicles.some((v) => v.task === 'awaitDestination');
  if (!call && !dispatch && !destination) return null;
  return (
    <div className={css.quick} role="group" aria-label={t('mobile.quick')}>
      {call && (
        <button
          type="button"
          className={`${css.quickBtn ?? ''} ${css.quickCall ?? ''}`}
          onClick={() => runAction('acceptCall')}
          data-testid="quick-accept"
        >
          ☎ {t('mobile.accept')}
        </button>
      )}
      {dispatch && (
        <button
          type="button"
          className={css.quickBtn}
          onClick={() => runAction('dispatch')}
          data-testid="quick-dispatch"
        >
          🚨 {t('mobile.dispatch')}
        </button>
      )}
      {destination && (
        <button
          type="button"
          className={css.quickBtn}
          onClick={() => runAction('destination')}
          data-testid="quick-destination"
        >
          🏥 {t('mobile.destination')}
        </button>
      )}
    </div>
  );
}

/** Hauptmenü als Liste – ersetzt die Menüzeile des Desktops. */
function MenuSheet() {
  const { t } = useTranslation();
  const openDialog = useSim((s) => s.openDialog);
  const items: readonly { dialog: Dialog; label: string; testId: string }[] = [
    { dialog: { kind: 'start' }, label: 'menu.new', testId: 'menu-new' },
    { dialog: { kind: 'saves' }, label: 'menu.saves', testId: 'menu-saves' },
    { dialog: { kind: 'evaluation' }, label: 'menu.evaluation', testId: 'open-evaluation' },
    { dialog: { kind: 'help' }, label: 'menu.help', testId: 'menu-help' },
    { dialog: { kind: 'mods' }, label: 'menu.mods', testId: 'menu-mods' },
    // Tastenbelegung nur, wo eine Tastatur wahrscheinlich ist (Desktop-Browser, Tablet mit Tastatur).
    ...(isAndroid()
      ? []
      : [{ dialog: { kind: 'keys' } as const, label: 'menu.keys', testId: 'menu-keys' }]),
  ];
  return (
    <Modal
      title={t('mobile.menu')}
      onClose={() => {
        openDialog(null);
      }}
      testId="menu-sheet"
    >
      <div className={css.menuList}>
        {items.map((item) => (
          <button
            key={item.testId}
            type="button"
            className={`${dialogCss.btn ?? ''} ${css.menuItem ?? ''}`}
            onClick={() => {
              openDialog(item.dialog);
            }}
            data-testid={item.testId}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
    </Modal>
  );
}
