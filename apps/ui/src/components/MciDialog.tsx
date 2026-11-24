/**
 * MANV-Übersicht (ADR-0017): Lagemeldung, Sichtungsergebnis, Verbleib jedes Patienten und die
 * Entscheidungen der Leitstelle – Patientenverteilung und Bereitstellungsraum.
 */
import { useTranslation } from 'react-i18next';
import type { IncidentView } from '@ls112/protocol';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import { Modal } from './Overlays';
import css from './Dialog.module.css';

const COLORS: Record<number, string> = {
  1: '#e53935',
  2: '#f5b335',
  3: '#43a047',
  4: '#5c6b7a',
};

export function triageCounts(mci: NonNullable<IncidentView['mci']>): Record<1 | 2 | 3 | 4, number> {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const p of mci.patients) counts[p.triage]++;
  return counts;
}

/** Kurzfassung für Listen: „3 rot · 5 gelb · 8 grün · 6 in Kliniken“. */
export function MciSummary({ mci }: { mci: NonNullable<IncidentView['mci']> }) {
  const { t } = useTranslation();
  if (!mci.triaged) return <span>{t('mci.estimated', { count: mci.estimated ?? 0 })}</span>;
  const c = triageCounts(mci);
  const delivered = mci.patients.filter((p) => p.state === 'delivered').length;
  return (
    <span>
      {([1, 2, 3] as const).map((k) => (
        <span key={k} style={{ color: COLORS[k], fontWeight: 700 }}>
          {c[k]} {t(`mci.triage.${k.toString()}`)}{' '}
        </span>
      ))}
      · {t('mci.delivered', { count: delivered })}
    </span>
  );
}

export function MciDialog({ incidentId }: { incidentId: string }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const incident = useSim((s) => s.host?.view.incidents.find((i) => i.id === incidentId));
  const command = useSim((s) => s.command);
  const openDialog = useSim((s) => s.openDialog);
  if (!world || !incident?.mci) return null;
  const L = lookup(world);
  const mci = incident.mci;
  const name = world.mciScenarios.find((s) => s.id === mci.scenarioId)?.name ?? '';
  const byHospital = new Map<string, number>();
  for (const p of mci.patients)
    if (p.hospitalId) byHospital.set(p.hospitalId, (byHospital.get(p.hospitalId) ?? 0) + 1);
  return (
    <Modal
      title={`${t('mci.title')} – ${incident.id}`}
      onClose={() => {
        openDialog(null);
      }}
      testId="mci-dialog"
    >
      <div className={css.section}>
        <span className={css.label}>{t('mci.situation')}</span>
        <div>
          <strong>{name}</strong> · {L.addressLabel(incident.addressId)}
        </div>
        <div>
          <MciSummary mci={mci} />
        </div>
        {!mci.triaged && <div className={css.hint}>{t('mci.triagePending')}</div>}
      </div>
      <div className={css.section}>
        <span className={css.label}>{t('mci.decisions')}</span>
        <label className={css.row}>
          <input
            type="checkbox"
            checked={mci.autoDistribute}
            onChange={(e) => {
              command({ type: 'mci/autoDistribute', incidentId, on: e.target.checked });
            }}
            data-testid="mci-auto"
          />
          {t('mci.autoDistribute')}
        </label>
        <label className={css.row}>
          <input
            type="checkbox"
            checked={mci.staging}
            onChange={(e) => {
              command({ type: 'mci/staging', incidentId, on: e.target.checked });
            }}
            data-testid="mci-staging"
          />
          {t('mci.staging')}
        </label>
        <span className={css.hint}>{t('mci.decisionHint')}</span>
      </div>
      {byHospital.size > 0 && (
        <div className={css.section}>
          <span className={css.label}>{t('mci.distribution')}</span>
          <div>
            {[...byHospital].map(([h, n]) => (
              <span key={h} style={{ marginRight: 12 }}>
                {L.hospitalName(h)}: <strong>{n}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
      {mci.triaged && (
        <table className={css.table} data-testid="mci-patients">
          <thead>
            <tr>
              <th>{t('mci.patient')}</th>
              <th>{t('mci.category')}</th>
              <th>{t('mci.injury')}</th>
              <th>{t('mci.status')}</th>
            </tr>
          </thead>
          <tbody>
            {[...mci.patients]
              .sort((a, b) => a.triage - b.triage || Number(a.id) - Number(b.id))
              .map((p) => (
                <tr key={p.id}>
                  <td className={css.mono}>{p.id}</td>
                  <td>
                    <span
                      style={{
                        background: COLORS[p.triage],
                        color: '#fff',
                        padding: '0 6px',
                        borderRadius: 3,
                      }}
                    >
                      {t(`mci.triageLong.${p.triage.toString()}`)}
                    </span>
                  </td>
                  <td>{L.diagnosisName(p.diagnosisId)}</td>
                  <td>
                    {t(`mci.state.${p.state}`)}
                    {p.vehicleId && (
                      <span className={css.hint}>
                        {' '}
                        · {L.vehicle(p.vehicleId)?.type} {L.vehicle(p.vehicleId)?.short}
                      </span>
                    )}
                    {p.hospitalId && (
                      <span className={css.hint}> → {L.hospitalName(p.hospitalId)}</span>
                    )}
                    {!p.needsTransport && p.state === 'waiting' && (
                      <span className={css.hint}> · {t('mci.onSiteCare')}</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
