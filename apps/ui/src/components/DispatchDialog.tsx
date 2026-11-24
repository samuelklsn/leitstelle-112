import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HospitalSuggestion, VehicleSuggestion } from '@ls112/protocol';
import { formatDuration } from '../format';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import { FmsChip } from './FmsChip';
import css from './Dialog.module.css';

/** Disposition: Vorschlag nach AAO und echter Fahrzeit, Auswahl übersteuerbar, Enter alarmiert. */
export function DispatchDialog({ incidentId }: { incidentId: string }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const incident = useSim((s) => s.host?.view.incidents.find((i) => i.id === incidentId));
  const vehicles = useSim((s) => s.host?.view.vehicles);
  const query = useSim((s) => s.query);
  const command = useSim((s) => s.command);
  const openDialog = useSim((s) => s.openDialog);
  const [items, setItems] = useState<readonly VehicleSuggestion[]>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void query({ type: 'suggestVehicles', incidentId }).then((r) => {
      if (!alive || r.type !== 'suggestVehicles') return;
      setItems(r.items);
      setPicked(new Set(r.items.filter((i) => i.recommended).map((i) => i.vehicleId)));
    });
    return () => {
      alive = false;
    };
  }, [incidentId, query]);

  if (!world || !incident) return null;
  const L = lookup(world);
  const alarm = () => {
    if (picked.size === 0) return;
    command({ type: 'incident/dispatch', incidentId, vehicleIds: [...picked] });
    openDialog(null);
  };

  return (
    <div
      className={css.side}
      role="dialog"
      aria-label={t('dispatch.title', { id: incidentId })}
      data-testid="dispatch-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          alarm();
        }
      }}
    >
      <div className={css.dialog}>
        <div className={css.head}>
          <span className={css.title}>{t('dispatch.title', { id: incidentId })}</span>
          <span className={css.badge}>{L.keywordCode(incident.keywordId)}</span>
          {incident.doctorRequested && (
            <span className={`${css.badge ?? ''} ${css.badgeAlarm ?? ''}`}>
              {t('dispatch.doctorRequested')}
            </span>
          )}
          <button
            type="button"
            className={css.close}
            onClick={() => {
              openDialog(null);
            }}
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <div className={css.body}>
          <div className={css.section}>
            <span className={css.label}>{t('incidents.location')}</span>
            <div>{L.addressLabel(incident.addressId)}</div>
            <div className={css.hint}>{t(`report.${incident.report.reportKey}`)}</div>
          </div>
          <div className={css.section}>
            <span className={css.label}>{t('dispatch.suggestion')}</span>
            <table className={css.table}>
              <thead>
                <tr>
                  <th />
                  <th>FMS</th>
                  <th>Fahrzeug</th>
                  <th>Wache</th>
                  <th>{t('dispatch.eta')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const v = L.vehicle(s.vehicleId);
                  const state = vehicles?.find((x) => x.id === s.vehicleId);
                  const station = world.stations.find((st) => st.id === v?.stationId);
                  const checked = picked.has(s.vehicleId);
                  return (
                    <tr
                      key={s.vehicleId}
                      className={`${s.recommended ? (css.rowRecommended ?? '') : ''} ${s.available ? '' : (css.rowDisabled ?? '')}`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          disabled={!s.available}
                          checked={checked}
                          aria-label={v?.callsign}
                          onChange={() => {
                            const next = new Set(picked);
                            if (checked) next.delete(s.vehicleId);
                            else next.add(s.vehicleId);
                            setPicked(next);
                          }}
                        />
                      </td>
                      <td>{state && <FmsChip status={state.status} />}</td>
                      <td>
                        <strong>{v?.type}</strong> {v?.short}
                      </td>
                      <td>
                        {station?.name
                          .replace('Rettungswache ', 'RW ')
                          .replace('Notarztstandort ', 'NA ')}
                      </td>
                      <td className={css.mono}>
                        {s.etaMs !== undefined
                          ? formatDuration(s.etaMs)
                          : t('dispatch.unavailable')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className={css.foot}>
          <span className={css.hint}>Enter = {t('dispatch.alarm')} · Esc</span>
          <button
            type="button"
            className={`${css.btn ?? ''} ${css.danger ?? ''}`}
            disabled={picked.size === 0}
            onClick={alarm}
            autoFocus
            data-testid="alarm"
          >
            {t('dispatch.alarm')} ({picked.size})
          </button>
        </div>
      </div>
    </div>
  );
}

/** Zielklinik zuweisen – Sprechwunsch eines Fahrzeugs in Status 5. */
export function DestinationDialog({ vehicleId }: { vehicleId: string }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const vehicle = useSim((s) => s.host?.view.vehicles.find((v) => v.id === vehicleId));
  const incident = useSim((s) => s.host?.view.incidents.find((i) => i.id === vehicle?.incidentId));
  const now = useSim((s) => s.host?.view.time ?? 0);
  const query = useSim((s) => s.query);
  const command = useSim((s) => s.command);
  const openDialog = useSim((s) => s.openDialog);
  const [items, setItems] = useState<readonly HospitalSuggestion[]>([]);

  useEffect(() => {
    let alive = true;
    void query({ type: 'suggestHospitals', vehicleId }).then((r) => {
      if (alive && r.type === 'suggestHospitals') setItems(r.items);
    });
    return () => {
      alive = false;
    };
  }, [vehicleId, query]);

  if (!world || !vehicle) return null;
  const L = lookup(world);
  const assign = (hospitalId: string) => {
    command({ type: 'vehicle/assignDestination', vehicleId, hospitalId });
    openDialog(null);
  };
  const finding = incident?.finding;
  return (
    <div
      className={css.side}
      role="dialog"
      data-testid="destination-dialog"
      onKeyDown={(e) => {
        const first = items[0];
        if (e.key === 'Enter' && first) {
          e.preventDefault();
          assign(first.hospitalId);
        }
      }}
    >
      <div className={css.dialog}>
        <div className={css.head}>
          <span className={css.title}>
            {t('destination.title', { vehicle: L.vehicle(vehicleId)?.callsign ?? vehicleId })}
          </span>
          {vehicle.requestSince !== undefined && (
            <span className={`${css.badge ?? ''} ${css.badgeAlarm ?? ''}`}>
              {t('destination.waiting', { duration: formatDuration(now - vehicle.requestSince) })}
            </span>
          )}
          <button
            type="button"
            className={css.close}
            onClick={() => {
              openDialog(null);
            }}
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <div className={css.body}>
          {finding && (
            <div className={css.section}>
              <span className={css.label}>{t('destination.finding')}</span>
              <div>
                <strong>{L.diagnosisName(finding.diagnosisId)}</strong> · NACA {finding.naca}
                {finding.needsDoctor ? ' · Notarzt' : ''}
              </div>
            </div>
          )}
          <table className={css.table}>
            <thead>
              <tr>
                <th>Krankenhaus</th>
                <th>Versorgung</th>
                <th>Fahrzeit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((h, i) => {
                const hospital = world.hospitals.find((x) => x.id === h.hospitalId);
                return (
                  <tr key={h.hospitalId} className={h.recommended ? css.rowRecommended : ''}>
                    <td>
                      <strong>{hospital?.name}</strong>
                      <div className={css.hint}>{hospital?.departments.join(', ')}</div>
                    </td>
                    <td className={h.suitable ? css.ok : css.bad}>
                      {h.suitable ? t('destination.suitable') : t('destination.unsuitable')}
                    </td>
                    <td className={css.mono}>{formatDuration(h.etaMs)}</td>
                    <td>
                      <button
                        type="button"
                        className={`${css.btn ?? ''} ${i === 0 ? (css.primary ?? '') : ''}`}
                        onClick={() => {
                          assign(h.hospitalId);
                        }}
                        autoFocus={i === 0}
                        data-testid={i === 0 ? 'assign-destination' : undefined}
                      >
                        {t('destination.assign')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
