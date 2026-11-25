import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SPEEDS } from '@ls112/protocol';
import { MAX_CATCH_UP_TICKS, SimClock } from './clock';

describe('SimClock', () => {
  it('erzeugt bei 1x einen Tick pro Echtzeitsekunde', () => {
    const clock = new SimClock();
    let ticks = 0;
    for (let i = 0; i < 200; i++) ticks += clock.advance(50);
    expect(ticks).toBe(10);
  });

  it('skaliert mit dem Zeitraffer', () => {
    for (const speed of SPEEDS) {
      const clock = new SimClock({ speed });
      let ticks = 0;
      for (let i = 0; i < 100; i++) ticks += clock.advance(10);
      expect(ticks).toBe(speed);
    }
  });

  it('liefert in der Pause keine Ticks', () => {
    const clock = new SimClock({ paused: true });
    expect(clock.advance(10_000)).toBe(0);
    clock.setPaused(false);
    expect(clock.advance(1000)).toBe(1);
  });

  it('begrenzt das Nachholen nach Hängern', () => {
    const clock = new SimClock({ speed: 10 });
    expect(clock.advance(60 * 60 * 1000)).toBe(MAX_CATCH_UP_TICKS);
    expect(clock.advance(0)).toBe(0);
  });

  it('verliert über viele kleine Schritte keine Zeit', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 500 }),
        fc.constantFrom(...SPEEDS),
        (steps, speed) => {
          const clock = new SimClock({ speed });
          let ticks = 0;
          let total = 0;
          for (const ms of steps) {
            ticks += clock.advance(ms);
            total += ms;
          }
          expect(ticks).toBe(Math.floor((total * speed) / 1000));
        },
      ),
    );
  });
});
