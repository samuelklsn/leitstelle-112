/**
 * Welche Dialoge wo erscheinen – gemeinsam für Desktop- und Telefon-Layout (ADR-0021).
 */
import { useSim } from '../sim-store';
import { CallMask } from './CallMask';
import { DestinationDialog, DispatchDialog } from './DispatchDialog';
import { ModsDialog, ScenarioEditor, StationEditor } from './Editors';
import { MciDialog } from './MciDialog';
import { EvaluationDialog, HelpDialog, SavesDialog, StartScreen } from './Overlays';
import { KeysDialog, WindowsDialog } from './Settings';

/** Notrufmaske, Disposition und Zielwahl – am Rand der Karte, damit die Lage sichtbar bleibt. */
export function SideDialogs() {
  const dialog = useSim((s) => s.dialog);
  return (
    <>
      {dialog?.kind === 'call' && <CallMask key={dialog.callId} callId={dialog.callId} />}
      {dialog?.kind === 'dispatch' && (
        <DispatchDialog key={dialog.incidentId} incidentId={dialog.incidentId} />
      )}
      {dialog?.kind === 'destination' && (
        <DestinationDialog key={dialog.vehicleId} vehicleId={dialog.vehicleId} />
      )}
    </>
  );
}

/** Dialoge über der ganzen Arbeitsfläche. */
export function GlobalDialogs() {
  const dialog = useSim((s) => s.dialog);
  return (
    <>
      {dialog?.kind === 'start' && <StartScreen />}
      {dialog?.kind === 'evaluation' && <EvaluationDialog shift={dialog.shift} />}
      {dialog?.kind === 'saves' && <SavesDialog />}
      {dialog?.kind === 'help' && <HelpDialog />}
      {dialog?.kind === 'windows' && <WindowsDialog />}
      {dialog?.kind === 'keys' && <KeysDialog />}
      {dialog?.kind === 'mci' && <MciDialog incidentId={dialog.incidentId} />}
      {dialog?.kind === 'mods' && <ModsDialog />}
      {dialog?.kind === 'scenarioEditor' && <ScenarioEditor />}
      {dialog?.kind === 'stationEditor' && <StationEditor />}
    </>
  );
}
