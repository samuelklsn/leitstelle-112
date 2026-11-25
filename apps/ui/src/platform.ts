/**
 * Plattform- und Bildschirmerkennung (ADR-0021). Die Oberfläche ist für Windows und Android
 * dieselbe; hier entscheidet sich nur, welche Bedienelemente sinnvoll sind.
 */
import { useSyncExternalStore } from 'react';
import { useSim } from './sim-store';

export { onCue } from './sim-store';

/** Mehrere Fenster und Layouts gibt es nur unter Windows (#50) – und im Browser zur Ansicht. */
export function hasMultiWindow(): boolean {
  const platform = typeof window === 'undefined' ? undefined : window.ls112?.platform;
  return platform === undefined || platform === 'windows';
}

/** Läuft die Oberfläche in der Android-App? */
export function isAndroid(): boolean {
  return typeof window !== 'undefined' && window.ls112?.platform === 'android';
}

/**
 * Unterhalb dieser Breite (CSS-Pixel) passt die Leitstellen-Arbeitsfläche mit vier Bereichen
 * nicht mehr nebeneinander – Telefone im Hoch- und kleine im Querformat.
 */
export const COMPACT_MAX_WIDTH = 899;
const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH.toString()}px)`;

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(COMPACT_QUERY);
  mq.addEventListener('change', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
  };
}

/** Kompaktes Layout (ein Bereich zur Zeit, Leiste unten) – reagiert auf Drehen des Geräts. */
export function useCompact(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  );
}

/**
 * Android-Zurück-Taste: erst einen offenen Dialog schließen, dann zur Lagekarte zurück.
 * Rückgabe `false` heißt: nichts mehr zu schließen – die App darf in den Hintergrund.
 */
export function handleBack(): boolean {
  const sim = useSim.getState();
  if (sim.mapPick) {
    sim.setMapPick(null);
    return true;
  }
  if (sim.dialog && sim.dialog.kind !== 'start') {
    sim.openDialog(null);
    return true;
  }
  if (sim.mobilePane !== 'map' && window.matchMedia(COMPACT_QUERY).matches) {
    sim.setMobilePane('map');
    return true;
  }
  return false;
}
