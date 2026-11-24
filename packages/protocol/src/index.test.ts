import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseSimCommand } from './index';

describe('parseClientMessage', () => {
  it('akzeptiert gültige Nachrichten', () => {
    expect(parseClientMessage({ type: 'clock/setSpeed', speed: 5 })).toEqual({
      type: 'clock/setSpeed',
      speed: 5,
    });
    expect(parseClientMessage({ type: 'clock/togglePause' })).toEqual({
      type: 'clock/togglePause',
    });
    expect(
      parseClientMessage({
        type: 'query',
        id: 3,
        query: { type: 'suggestVehicles', incidentId: 'E1' },
      }),
    ).toEqual({
      type: 'query',
      id: 3,
      query: { type: 'suggestVehicles', incidentId: 'E1' },
    });
    expect(parseClientMessage({ type: 'game/new', mode: 'tutorial' })).toEqual({
      type: 'game/new',
      mode: 'tutorial',
    });
    expect(parseClientMessage({ type: 'save/write', name: '  Schicht 1  ' })).toEqual({
      type: 'save/write',
      name: 'Schicht 1',
    });
  });

  it('lehnt ungültige Werte ab', () => {
    expect(parseClientMessage({ type: 'clock/setSpeed', speed: 3 })).toBeUndefined();
    expect(parseClientMessage({ type: 'game/new', mode: 'hard' })).toBeUndefined();
    expect(parseClientMessage({ type: 'save/write', name: '   ' })).toBeUndefined();
    expect(parseClientMessage({ type: 'save/load', id: -1 })).toBeUndefined();
    expect(parseClientMessage({ type: 'query', id: 1, query: { type: 'x' } })).toBeUndefined();
  });

  it('übersteht beliebige Eingaben ohne Ausnahme', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => parseClientMessage(input)).not.toThrow();
        expect(() => parseSimCommand(input)).not.toThrow();
      }),
    );
  });
});

describe('parseSimCommand', () => {
  it('kopiert nur bekannte Felder', () => {
    expect(
      parseSimCommand({
        type: 'incident/dispatch',
        incidentId: 'E1',
        vehicleIds: ['a', 'b'],
        hack: 1,
      }),
    ).toEqual({
      type: 'incident/dispatch',
      incidentId: 'E1',
      vehicleIds: ['a', 'b'],
    });
  });

  it('lehnt leere Alarmierungen und falsche Typen ab', () => {
    expect(
      parseSimCommand({ type: 'incident/dispatch', incidentId: 'E1', vehicleIds: [] }),
    ).toBeUndefined();
    expect(
      parseSimCommand({
        type: 'incident/create',
        callId: 'N1',
        addressId: '5',
        keywordId: 'base:rd1',
      }),
    ).toBeUndefined();
    expect(parseSimCommand({ type: 'vehicle/assignDestination', vehicleId: 'v' })).toBeUndefined();
  });
});
