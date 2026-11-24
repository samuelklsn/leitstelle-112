/**
 * Tastenbelegung (#30, ADR-0011): Jede globale Aktion ist per Tastatur erreichbar, die Belegung
 * lässt sich ändern und wird lokal gespeichert. Dialoge (Notrufmaske, Disposition) behalten ihre
 * eigenen, festen Tasten (Enter, Alt+Ziffer).
 */

export const ACTIONS = [
  'acceptCall',
  'dispatch',
  'destination',
  'pause',
  'speed1',
  'speed2',
  'speed3',
  'speed4',
  'closeDialog',
  'help',
  'evaluation',
  'tabIncidents',
  'tabOrders',
  'tabHospitals',
  'tabRadio',
  'windows',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Taste nach `KeyboardEvent.code` (layoutunabhängig) plus Umschalttasten. */
export interface KeyBinding {
  readonly code: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

export type Keymap = Readonly<Record<Action, KeyBinding>>;

export const DEFAULT_KEYMAP: Keymap = {
  acceptCall: { code: 'F2' },
  dispatch: { code: 'F3' },
  destination: { code: 'F4' },
  pause: { code: 'Space' },
  speed1: { code: 'Digit1' },
  speed2: { code: 'Digit2' },
  speed3: { code: 'Digit3' },
  speed4: { code: 'Digit4' },
  closeDialog: { code: 'Escape' },
  help: { code: 'F1' },
  evaluation: { code: 'F9' },
  tabIncidents: { code: 'Digit1', ctrl: true },
  tabOrders: { code: 'Digit2', ctrl: true },
  tabHospitals: { code: 'Digit3', ctrl: true },
  tabRadio: { code: 'Digit4', ctrl: true },
  windows: { code: 'F8' },
};

/** Tasten, die beim Tippen in Eingabefeldern nicht als Kürzel gelten. */
export function isPlainKey(b: KeyBinding): boolean {
  return !b.ctrl && !b.alt && !/^F\d{1,2}$/.test(b.code) && b.code !== 'Escape';
}

export function sameBinding(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.code === b.code &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift)
  );
}

export function bindingFromEvent(e: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): KeyBinding {
  return {
    code: e.code,
    ...(e.ctrlKey ? { ctrl: true } : {}),
    ...(e.altKey ? { alt: true } : {}),
    ...(e.shiftKey ? { shift: true } : {}),
  };
}

/** Welche Aktion löst dieser Tastendruck aus? */
export function actionFor(map: Keymap, binding: KeyBinding): Action | undefined {
  return ACTIONS.find((a) => sameBinding(map[a], binding));
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Leertaste',
  Escape: 'Esc',
  Enter: 'Enter',
  Pause: 'Pause',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Anzeige wie „Strg+2“ oder „F3“. */
export function formatBinding(b: KeyBinding): string {
  const key =
    KEY_NAMES[b.code] ??
    b.code
      .replace(/^Digit/, '')
      .replace(/^Key/, '')
      .replace(/^Numpad/, 'Num ');
  return [b.ctrl ? 'Strg' : '', b.alt ? 'Alt' : '', b.shift ? 'Umschalt' : '', key]
    .filter(Boolean)
    .join('+');
}

/**
 * Neue Belegung setzen. Hatte eine andere Aktion schon diese Taste, bekommt sie die bisherige
 * Taste der geänderten Aktion – so entstehen nie zwei Aktionen auf einer Taste.
 */
export function rebind(map: Keymap, action: Action, binding: KeyBinding): Keymap {
  const previous = map[action];
  const clash = ACTIONS.find((a) => a !== action && sameBinding(map[a], binding));
  return {
    ...map,
    [action]: binding,
    ...(clash ? { [clash]: previous } : {}),
  };
}

/** Gespeicherte Belegung lesen; Unbekanntes fällt auf die Vorgabe zurück. */
export function parseKeymap(text: string | null): Keymap {
  if (!text) return DEFAULT_KEYMAP;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_KEYMAP;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_KEYMAP;
  let map: Keymap = DEFAULT_KEYMAP;
  for (const action of ACTIONS) {
    const b = (raw as Record<string, unknown>)[action];
    if (typeof b !== 'object' || b === null) continue;
    const o = b as Record<string, unknown>;
    if (typeof o.code !== 'string' || o.code.length === 0 || o.code.length > 32) continue;
    map = rebind(map, action, {
      code: o.code,
      ...(o.ctrl === true ? { ctrl: true } : {}),
      ...(o.alt === true ? { alt: true } : {}),
      ...(o.shift === true ? { shift: true } : {}),
    });
  }
  return map;
}

const STORAGE_KEY = 'ls112.keymap';

export function loadKeymap(): Keymap {
  try {
    return parseKeymap(globalThis.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_KEYMAP;
  }
}

export function saveKeymap(map: Keymap): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Speicher nicht verfügbar (z. B. Testumgebung) – Belegung gilt dann nur für diese Sitzung.
  }
}
