/**
 * Kleine Anzeigen, die Desktop- und Telefon-Layout teilen: Hinweis-Einblendung, Weltlage, Ton.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTimeOfDay } from '../format';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import css from '../App.module.css';

export function Notice() {
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
export function WorldChips() {
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

/** Töne an/aus – gespeichert auf diesem Rechner. */
export function SoundToggle() {
  const { t } = useTranslation();
  const sound = useSim((s) => s.sound);
  const setSound = useSim((s) => s.setSound);
  return (
    <button
      type="button"
      className={css.ctrl}
      onClick={() => {
        setSound({ ...sound, enabled: !sound.enabled });
      }}
      aria-pressed={sound.enabled}
      title={sound.enabled ? t('sound.off') : t('sound.on')}
      data-testid="btn-sound"
    >
      {sound.enabled ? '🔊' : '🔇'}
    </button>
  );
}
