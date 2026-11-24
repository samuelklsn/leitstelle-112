import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DEFAULT_KEYMAP,
  actionFor,
  bindingFromEvent,
  formatBinding,
  isPlainKey,
  parseKeymap,
  rebind,
  sameBinding,
} from './keymap';

describe('Tastenbelegung', () => {
  it('Vorgabe ist eindeutig: keine zwei Aktionen auf einer Taste', () => {
    for (const a of ACTIONS)
      for (const b of ACTIONS)
        if (a !== b) expect(sameBinding(DEFAULT_KEYMAP[a], DEFAULT_KEYMAP[b])).toBe(false);
  });

  it('findet die Aktion zu einem Tastendruck', () => {
    const e = { code: 'F3', ctrlKey: false, altKey: false, shiftKey: false };
    expect(actionFor(DEFAULT_KEYMAP, bindingFromEvent(e))).toBe('dispatch');
    const ctrl2 = { code: 'Digit2', ctrlKey: true, altKey: false, shiftKey: false };
    expect(actionFor(DEFAULT_KEYMAP, bindingFromEvent(ctrl2))).toBe('tabOrders');
    expect(actionFor(DEFAULT_KEYMAP, { code: 'KeyQ' })).toBeUndefined();
  });

  it('tauscht bei Konflikten statt doppelt zu belegen', () => {
    const map = rebind(DEFAULT_KEYMAP, 'dispatch', { code: 'F2' });
    expect(map.dispatch).toEqual({ code: 'F2' });
    expect(map.acceptCall).toEqual({ code: 'F3' });
  });

  it('liest gespeicherte Belegungen robust', () => {
    expect(parseKeymap(null)).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap('{kaputt')).toBe(DEFAULT_KEYMAP);
    const map = parseKeymap(JSON.stringify({ pause: { code: 'KeyP' }, unbekannt: { code: 'F5' } }));
    expect(map.pause).toEqual({ code: 'KeyP' });
    expect(map.dispatch).toEqual({ code: 'F3' });
  });

  it('zeigt Tasten deutsch an', () => {
    expect(formatBinding({ code: 'Digit2', ctrl: true })).toBe('Strg+2');
    expect(formatBinding({ code: 'Space' })).toBe('Leertaste');
    expect(formatBinding({ code: 'KeyP', alt: true, shift: true })).toBe('Alt+Umschalt+P');
    expect(isPlainKey({ code: 'Digit1' })).toBe(true);
    expect(isPlainKey({ code: 'F3' })).toBe(false);
  });
});
