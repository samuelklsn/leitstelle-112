import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@ls112/protocol';
import { cueFor, loadSoundSettings } from './sound';

const radio = (message: string): SimEvent =>
  ({ type: 'radio', at: 0, vehicleId: 'v', status: 5, message, incidentId: null }) as SimEvent;

describe('Akustische Signale', () => {
  it('Notruf klingelt, Sprechwunsch piept, Großlage geht vor', () => {
    expect(cueFor([{ type: 'call/incoming', at: 0, callId: 'N1' }])).toBe('ring');
    expect(cueFor([radio('requestDestination')])).toBe('request');
    expect(
      cueFor([radio('requestDestination'), { type: 'call/incoming', at: 0, callId: 'N1' }]),
    ).toBe('ring');
    expect(cueFor([{ type: 'call/incoming', at: 0, callId: 'N1' }, radio('mciReport')])).toBe(
      'alarm',
    );
    expect(cueFor([radio('arrived')])).toBeUndefined();
  });

  it('ohne Speicher gelten die Vorgaben', () => {
    expect(loadSoundSettings()).toEqual({ enabled: true, volume: 0.5 });
  });
});
