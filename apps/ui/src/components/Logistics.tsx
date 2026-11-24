/**
 * Logistik-Ansichten (ADR-0015): Transportaufträge mit Termin und die Aufnahmebereitschaft der
 * Kliniken. Reine Anzeige – Entscheidungen trifft der Disponent über Befehle.
 */
import { useTranslation } from 'react-i18next';
import type { IncidentView } from '@ls112/protocol';
import { formatDuration, formatTimeOfDay } from '../format';
import { lookup, type Lookup } from '../lookup';
import { useSim } from '../sim-store';
import { FmsChip } from './FmsChip';
import { needsUnits } from './Panels';
import css from './Panels.module.css';

const EMPTY: readonly never[] = [];
/** Ab dieser Restzeit bis zum Termin wird ein noch nicht disponierter Auftrag auffällig. */
const ORDER_WARN_MS = 30 * 60_000;

function placeLabel(i: IncidentView, L: Lookup, side: 'from' | 'to'): string {
  const o = i.order;
  if (!o) return '';
  if (side === 'from')
    return o.fromHospitalId ? L.hospitalName(o.fromHospitalId) : L.addressLabel(i.addressId);
  if (o.toHospitalId) return L.hospitalName(o.toHospitalId);
  return o.toAddressId !== undefined ? L.addressLabel(o.toAddressId) : '–';
}

export function OrderList() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const incidents = useSim((s) => s.host?.view.incidents ?? EMPTY);
  const vehicles = useSim((s) => s.host?.view.vehicles ?? EMPTY);
  const now = useSim((s) => s.host?.view.time ?? 0);
  const selected = useSim((s) => s.selectedIncidentId);
  const select = useSim((s) => s.selectIncident);
  const openDialog = useSim((s) => s.openDialog);
  if (!world) return null;
  const L = lookup(world);
  const orders = incidents
    .filter((i) => i.order)
    .sort(
      (a, b) =>
        Number(a.status === 'closed') - Number(b.status === 'closed') ||
        (a.order?.dueAt ?? 0) - (b.order?.dueAt ?? 0),
    );
  return (
    <div className={css.body}>
      {orders.length === 0 && <div className={css.empty}>{t('orders.empty')}</div>}
      <table className={css.table} data-testid="order-list">
        <tbody>
          {orders.map((i) => {
            const o = i.order;
            if (!o) return null;
            const left = o.dueAt - now;
            const open = needsUnits(i, L);
            const overdue = open && left < 0;
            const soon = open && !overdue && left < ORDER_WARN_MS;
            return (
              <tr
                key={i.id}
                className={`${i.id === selected ? (css.rowSelected ?? '') : ''} ${i.status === 'closed' ? (css.rowClosed ?? '') : ''}`}
                onClick={() => {
                  select(i.id);
                }}
                onDoubleClick={() => {
                  if (open) openDialog({ kind: 'dispatch', incidentId: i.id });
                }}
                data-testid="order-row"
              >
                <td className={css.mono}>{i.id}</td>
                <td>
                  <span className={css.kw}>{L.keywordCode(i.keywordId)}</span>
                </td>
                <td className={css.mono}>
                  <strong>{formatTimeOfDay(o.dueAt)}</strong>
                  {overdue && <span className={css.flagAlarm}>{t('orders.overdue')}</span>}
                  {soon && <span className={css.flag}>{t('orders.soon')}</span>}
                </td>
                <td className={css.report}>
                  <div>{L.orderName(o.templateId)}</div>
                  <div className={css.meta}>
                    {placeLabel(i, L, 'from')} → {placeLabel(i, L, 'to')}
                  </div>
                  {o.infectious && <span className={css.flagAlarm}>{t('orders.infectious')}</span>}
                  {i.outcome && (
                    <span className={css.flag}>
                      {i.outcome === 'gut' ? t('orders.onTime') : t('orders.late')}
                    </span>
                  )}
                </td>
                <td>
                  <span className={css.units}>
                    {i.vehicleIds.map((id) => {
                      const v = vehicles.find((x) => x.id === id);
                      return (
                        <span key={id} className={css.unit}>
                          {v && <FmsChip status={v.status} />} {L.vehicle(id)?.type}
                        </span>
                      );
                    })}
                  </span>
                </td>
                <td className={css.mono}>
                  {i.status === 'closed'
                    ? t('incidents.status.closed')
                    : o.pickedUpAt !== undefined
                      ? t('orders.transporting')
                      : left >= 0
                        ? t('orders.in', { duration: formatDuration(left) })
                        : t('orders.since', { duration: formatDuration(-left) })}
                </td>
                <td>
                  {open && (
                    <button
                      type="button"
                      className={`${css.smallBtn ?? ''} ${overdue ? (css.smallAlarm ?? '') : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDialog({ kind: 'dispatch', incidentId: i.id });
                      }}
                    >
                      {t('incidents.dispatch')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Aufnahmebereitschaft je Klinik und Fachabteilung – wie ein Behandlungskapazitätennachweis. */
export function HospitalPanel() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const hospitals = useSim((s) => s.host?.view.hospitals ?? EMPTY);
  if (!world) return null;
  return (
    <div className={css.body}>
      <div className={css.hospitalGrid} data-testid="hospital-panel">
        {hospitals.map((h) => {
          const info = world.hospitals.find((x) => x.id === h.id);
          return (
            <div key={h.id} className={css.hospitalCard}>
              <div className={css.groupTitle}>
                {info?.name} <span className={css.meta}>· {t(`level.${info?.level ?? ''}`)}</span>
              </div>
              <div className={css.departments}>
                {h.departments.map((d) => (
                  <span
                    key={d.department}
                    className={`${css.department ?? ''} ${d.open ? '' : (css.departmentClosed ?? '')}`}
                    title={
                      d.closedUntil !== undefined
                        ? t('hospitals.closedUntil', { time: formatTimeOfDay(d.closedUntil) })
                        : d.open
                          ? t('hospitals.open')
                          : t('hospitals.full')
                    }
                  >
                    {t(`department.${d.department}`)}{' '}
                    <span className={css.mono}>
                      {d.free !== undefined && d.capacity !== undefined
                        ? `${d.free.toString()}/${d.capacity.toString()}`
                        : '✓'}
                    </span>
                    {!d.open && (
                      <strong>
                        {' '}
                        {d.closedUntil !== undefined
                          ? t('hospitals.closedShort', { time: formatTimeOfDay(d.closedUntil) })
                          : t('hospitals.fullShort')}
                      </strong>
                    )}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
