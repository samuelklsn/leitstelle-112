import { useEffect } from 'react';
import { SPEEDS } from '@ls112/protocol';
import { useSim } from './sim-store';
import { lookup } from './lookup';
import { needsUnits } from './components/Panels';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * Globale Tastenkürzel wie im Einsatzleitrechner (ADR-0011). Dialoge behandeln Enter selbst.
 * F2 Notruf, F3 Disposition, F4 Sprechwunsch, Leertaste Pause, 1–4 Zeitraffer, Esc schließen.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const sim = useSim.getState();
      const view = sim.host?.view;
      if (event.key === 'Escape') {
        if (sim.dialog && sim.dialog.kind !== 'start') {
          event.preventDefault();
          sim.openDialog(null);
        }
        return;
      }
      if (sim.dialog?.kind === 'start') return;
      if (event.key === 'F2') {
        event.preventDefault();
        const call =
          view?.calls.find((c) => c.status === 'waiting') ??
          view?.calls.find((c) => c.status === 'talking');
        if (call) {
          if (call.status === 'waiting') sim.command({ type: 'call/accept', callId: call.id });
          sim.openDialog({ kind: 'call', callId: call.id });
        }
        return;
      }
      if (event.key === 'F3') {
        event.preventDefault();
        const world = sim.world;
        const incident = world
          ? view?.incidents.find((i) => needsUnits(i, lookup(world)))
          : undefined;
        if (incident) {
          sim.selectIncident(incident.id);
          sim.openDialog({ kind: 'dispatch', incidentId: incident.id });
        }
        return;
      }
      if (event.key === 'F4') {
        event.preventDefault();
        const v = [...(view?.vehicles ?? [])]
          .filter((x) => x.task === 'awaitDestination')
          .sort((a, b) => (a.requestSince ?? 0) - (b.requestSince ?? 0))[0];
        if (v) sim.openDialog({ kind: 'destination', vehicleId: v.id });
        return;
      }
      if (isTyping(event.target)) return;
      if (event.code === 'Pause' || (event.code === 'Space' && !event.repeat)) {
        event.preventDefault();
        sim.togglePause();
        return;
      }
      const digit = Number(event.key);
      if (!event.ctrlKey && !event.altKey && digit >= 1 && digit <= SPEEDS.length) {
        const speed = SPEEDS[digit - 1];
        if (speed !== undefined) sim.setSpeed(speed);
      }
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
