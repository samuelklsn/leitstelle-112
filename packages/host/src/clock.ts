import { TICK_MS } from '@ls112/sim';
import type { Speed } from '@ls112/protocol';

/**
 * Übersetzt vergangene Echtzeit in Simulationsticks (Zeitgeber außerhalb des Kerns, ADR-0004).
 *
 * Zeitraffer bedeutet mehr Ticks pro Echtzeitsekunde. Bleibt der Rechner hängen (Standby,
 * Debugger), werden höchstens {@link MAX_CATCH_UP_TICKS} Ticks nachgeholt – sonst würde die
 * Simulation nach dem Aufwachen minutenlang „vorspulen".
 */
export const MAX_CATCH_UP_TICKS = 50;

export class SimClock {
  private accumulatorMs = 0;
  private _paused: boolean;
  private _speed: Speed;

  constructor(options: { paused?: boolean; speed?: Speed } = {}) {
    this._paused = options.paused ?? false;
    this._speed = options.speed ?? 1;
  }

  get paused(): boolean {
    return this._paused;
  }

  get speed(): Speed {
    return this._speed;
  }

  setPaused(paused: boolean): void {
    this._paused = paused;
    // Beim Pausieren keine angefangenen Teilticks mitnehmen.
    if (paused) this.accumulatorMs = 0;
  }

  setSpeed(speed: Speed): void {
    this._speed = speed;
  }

  /** Meldet vergangene Echtzeit und liefert die Anzahl auszuführender Ticks. */
  advance(realElapsedMs: number): number {
    if (this._paused || realElapsedMs <= 0 || !Number.isFinite(realElapsedMs)) return 0;
    this.accumulatorMs += realElapsedMs * this._speed;
    let ticks = Math.floor(this.accumulatorMs / TICK_MS);
    this.accumulatorMs -= ticks * TICK_MS;
    if (ticks > MAX_CATCH_UP_TICKS) {
      ticks = MAX_CATCH_UP_TICKS;
      this.accumulatorMs = 0;
    }
    return ticks;
  }
}
