/**
 * Akustische Signale der Leitstelle: Notruf klingelt, Sprechwunsch piept, Großlage alarmiert.
 * Alle Töne entstehen zur Laufzeit per Web Audio (eigene Erzeugung, keine Tondateien, offline).
 * Reine Darstellung – die Simulation weiß nichts davon (CLAUDE.md, Regel 4).
 */
import type { SimEvent } from '@ls112/protocol';

export type Cue = 'ring' | 'request' | 'alarm';

const STORAGE_KEY = 'ls112.sound';

export interface SoundSettings {
  readonly enabled: boolean;
  /** Lautstärke 0 … 1. */
  readonly volume: number;
}

export function loadSoundSettings(): SoundSettings {
  try {
    const raw = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (typeof raw === 'object' && raw !== null) {
      const o = raw as { enabled?: unknown; volume?: unknown };
      return {
        enabled: o.enabled !== false,
        volume: typeof o.volume === 'number' ? Math.min(1, Math.max(0, o.volume)) : 0.5,
      };
    }
  } catch {
    // Kein Speicher – Vorgabe.
  }
  return { enabled: true, volume: 0.5 };
}

export function saveSoundSettings(s: SoundSettings): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignorieren
  }
}

/** Welche Ereignisse hörbar sind – höchstens ein Ton je Paket, der wichtigste zuerst. */
export function cueFor(events: readonly SimEvent[]): Cue | undefined {
  let cue: Cue | undefined;
  for (const e of events) {
    if (e.type === 'radio' && e.message === 'mciReport') return 'alarm';
    if (e.type === 'call/incoming') cue = 'ring';
    else if (
      e.type === 'radio' &&
      ['requestDestination', 'requestDoctor', 'requestUnits', 'wrongLocation', 'defect'].includes(
        e.message,
      ) &&
      cue === undefined
    )
      cue = 'request';
  }
  return cue;
}

/** Ton-Muster: Frequenzen (Hz), Dauer je Ton (s) und Pause (s). */
const PATTERNS: Record<Cue, { tones: number[][]; length: number; gap: number }> = {
  // Doppeltes Klingeln wie ein Telefon (zwei überlagerte Töne).
  ring: {
    tones: [
      [440, 480],
      [440, 480],
    ],
    length: 0.4,
    gap: 0.2,
  },
  // Kurzer Doppelton für Sprechwünsche.
  request: { tones: [[880], [660]], length: 0.12, gap: 0.05 },
  // Dreiklang-Gong bei Großlagen.
  alarm: { tones: [[523], [659], [784], [1047]], length: 0.25, gap: 0.03 },
};

let ctx: AudioContext | undefined;

function audio(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  ctx ??= new AudioContext();
  // Nach der ersten Bedienung darf der Kontext laufen (Autoplay-Regeln).
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function play(cue: Cue, settings: SoundSettings): void {
  if (!settings.enabled || settings.volume <= 0) return;
  const ac = audio();
  if (!ac) return;
  const p = PATTERNS[cue];
  let t = ac.currentTime + 0.02;
  for (const tone of p.tones) {
    const gain = ac.createGain();
    gain.connect(ac.destination);
    // Weiche Hüllkurve gegen Knacken.
    const peak = (0.25 * settings.volume) / tone.length;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.01);
    gain.gain.setValueAtTime(peak, t + p.length - 0.03);
    gain.gain.linearRampToValueAtTime(0, t + p.length);
    for (const f of tone) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + p.length);
    }
    t += p.length + p.gap;
  }
}
