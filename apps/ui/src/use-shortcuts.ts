import { useEffect } from 'react';
import { SPEEDS } from '@ls112/protocol';
import { actionFor, bindingFromEvent, isPlainKey, type Action } from './keymap';
import { useSim } from './sim-store';
import { lookup } from './lookup';
import { needsUnits } from './components/Panels';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Führt eine globale Aktion aus. Rückgabe: wurde etwas getan? */
function run(action: Action): boolean {
  const sim = useSim.getState();
  const view = sim.host?.view;
  switch (action) {
    case 'closeDialog':
      if (sim.dialog && sim.dialog.kind !== 'start') {
        sim.openDialog(null);
        return true;
      }
      return false;
    case 'acceptCall': {
      // Erst das laufende Gespräch – ein Disponent telefoniert nie doppelt.
      const call =
        view?.calls.find((c) => c.status === 'talking') ??
        view?.calls.find((c) => c.status === 'waiting');
      if (!call) return false;
      if (call.status === 'waiting') sim.command({ type: 'call/accept', callId: call.id });
      sim.openDialog({ kind: 'call', callId: call.id });
      return true;
    }
    case 'dispatch': {
      const world = sim.world;
      // Notfälle zuerst; Transportaufträge nach Termin.
      const open = world ? (view?.incidents ?? []).filter((i) => needsUnits(i, lookup(world))) : [];
      const incident =
        open.find((i) => !i.order) ??
        [...open].sort((a, b) => (a.order?.dueAt ?? 0) - (b.order?.dueAt ?? 0))[0];
      if (!incident) return false;
      sim.selectIncident(incident.id);
      sim.openDialog({ kind: 'dispatch', incidentId: incident.id });
      return true;
    }
    case 'destination': {
      const v = [...(view?.vehicles ?? [])]
        .filter((x) => x.task === 'awaitDestination')
        .sort((a, b) => (a.requestSince ?? 0) - (b.requestSince ?? 0))[0];
      if (!v) return false;
      sim.openDialog({ kind: 'destination', vehicleId: v.id });
      return true;
    }
    case 'pause':
      sim.togglePause();
      return true;
    case 'speed1':
    case 'speed2':
    case 'speed3':
    case 'speed4': {
      const speed = SPEEDS[Number(action.slice(-1)) - 1];
      if (speed !== undefined) sim.setSpeed(speed);
      return true;
    }
    case 'help':
      sim.openDialog({ kind: 'help' });
      return true;
    case 'evaluation':
      sim.openDialog({ kind: 'evaluation' });
      return true;
    case 'windows':
      sim.openDialog({ kind: 'windows' });
      return true;
    case 'tabIncidents':
      sim.setBottomTab('incidents');
      return true;
    case 'tabOrders':
      sim.setBottomTab('orders');
      return true;
    case 'tabHospitals':
      sim.setBottomTab('hospitals');
      return true;
    case 'tabRadio':
      sim.setBottomTab('radio');
      return true;
  }
}

/**
 * Globale Tastenkürzel nach der einstellbaren Belegung (#30). Dialoge behandeln Enter und
 * Alt+Ziffer selbst. Während eine Taste neu belegt wird, ist die Belegung ausgesetzt.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const sim = useSim.getState();
      if (sim.capturingKey || event.repeat) return;
      const binding = bindingFromEvent(event);
      const action = actionFor(sim.keymap, binding);
      if (!action) return;
      // Auf dem Startbildschirm gilt nur Esc nicht; dort gibt es noch kein Spiel.
      if (sim.dialog?.kind === 'start') return;
      if (isPlainKey(binding) && isTyping(event.target)) return;
      if (run(action)) event.preventDefault();
    };
    // Leertaste ist global „Pause" – ein fokussierter Button darf sie nicht zusätzlich auslösen.
    const swallowSpace = (event: KeyboardEvent) => {
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement)
        event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', swallowSpace);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', swallowSpace);
    };
  }, []);
}
