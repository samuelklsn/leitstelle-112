import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { IncidentView, VehicleView } from '@ls112/protocol';
import { formatDuration, formatTimeOfDay } from '../format';
import { lookup, type Lookup } from '../lookup';
import { useSim, type LogEntry } from '../sim-store';
import { FmsChip } from './FmsChip';
import { HospitalPanel, OrderList } from './Logistics';
import css from './Panels.module.css';

/** Notrufe sollen schnell angenommen werden; ab diesen Wartezeiten wird die Zeile auffällig. */
const CALL_WARN_MS = 10_000;
const CALL_ALARM_MS = 30_000;

/** Stabile leere Liste: Zustand-Selektoren müssen bei gleichem Zustand dasselbe Objekt liefern. */
const EMPTY: readonly never[] = [];

export function CallsPanel() {
  const { t } = useTranslation();
  const calls = useSim((s) => s.host?.view.calls ?? EMPTY);
  const now = useSim((s) => s.host?.view.time ?? 0);
  const command = useSim((s) => s.command);
  const openDialog = useSim((s) => s.openDialog);
  const lineBusy = calls.some((c) => c.status === 'talking');
  const anyAlarm = calls.some((c) => c.status === 'waiting' && now - c.receivedAt >= CALL_ALARM_MS);
  return (
    <section className={`${css.panel ?? ''} ${css.calls ?? ''}`} aria-label={t('panel.calls')}>
      <header className={css.header}>
        {t('panel.calls')}
        <span
          className={`${css.count ?? ''} ${anyAlarm ? (css.countAlarm ?? '') : ''}`}
          data-testid="calls-count"
        >
          {calls.length}
        </span>
      </header>
      <div className={css.body}>
        {calls.length === 0 && <div className={css.empty}>{t('calls.empty')}</div>}
        {calls.map((call, index) => {
          const waited = now - call.receivedAt;
          const talking = call.status === 'talking';
          const level = talking
            ? css.callTalking
            : waited >= CALL_ALARM_MS
              ? css.callAlarm
              : waited >= CALL_WARN_MS
                ? css.callWarn
                : '';
          return (
            <div
              key={call.id}
              className={`${css.callRow ?? ''} ${level ?? ''}`}
              data-testid="call-row"
            >
              <span className={css.callStripe} aria-hidden="true" />
              <div>
                <div className={css.callTitle}>112 · {t('calls.line', { n: index + 1 })}</div>
                <div className={css.meta}>
                  {call.id} ·{' '}
                  {talking
                    ? t('calls.talking', {
                        duration: formatDuration(now - (call.acceptedAt ?? now)),
                      })
                    : t('calls.waiting', { duration: formatDuration(waited) })}
                </div>
              </div>
              <button
                type="button"
                className={talking ? css.openBtn : css.acceptBtn}
                disabled={!talking && lineBusy}
                title={!talking && lineBusy ? t('reason.lineBusy') : undefined}
                onClick={() => {
                  if (!talking) command({ type: 'call/accept', callId: call.id });
                  openDialog({ kind: 'call', callId: call.id });
                }}
              >
                {talking ? t('calls.open') : t('calls.accept')}
                {!talking && index === 0 && <span className={css.kbd}>F2</span>}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Braucht der Einsatz (noch) Kräfte? Reine Anzeige-Hilfe – die Simulation entscheidet selbst. */
/** Braucht der Einsatz (noch) Kräfte? Offen, Notarzt nachgefordert oder Nachforderung laut Lage. */
export function needsUnits(i: IncidentView, L: Lookup): boolean {
  return (
    i.status === 'open' ||
    i.unitsMissing ||
    (i.doctorRequested &&
      i.hospitalId === undefined &&
      !i.vehicleIds.some((v) => L.vehicle(v)?.doctor))
  );
}

export function IncidentList() {
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
  const sorted = incidents
    .filter((i) => !i.order)
    .sort(
      (a, b) =>
        Number(a.status === 'closed') - Number(b.status === 'closed') ||
        b.receivedAt - a.receivedAt,
    );
  return (
    <div className={css.body}>
      {sorted.length === 0 && <div className={css.empty}>{t('incidents.empty')}</div>}
      <table className={css.table} data-testid="incident-list">
        <tbody>
          {sorted.map((i) => (
            <tr
              key={i.id}
              className={`${i.id === selected ? (css.rowSelected ?? '') : ''} ${i.status === 'closed' ? (css.rowClosed ?? '') : ''}`}
              onClick={() => {
                select(i.id);
              }}
              onDoubleClick={() => {
                if (needsUnits(i, L)) openDialog({ kind: 'dispatch', incidentId: i.id });
              }}
            >
              <td className={css.mono}>{i.id}</td>
              <td>
                <span className={css.kw}>{L.keywordCode(i.keywordId)}</span>
              </td>
              <td className={css.location}>{L.addressLabel(i.addressId)}</td>
              <td className={css.report}>
                {i.finding ? (
                  <span className={css.finding}>▶ {describeFinding(i.finding, L)}</span>
                ) : (
                  <span className={css.meta}>{t(`report.${i.report.reportKey}`)}</span>
                )}
                {i.locating && <span className={css.flagAlarm}>{t('incidents.locating')}</span>}
                {i.unitsMissing && (
                  <span className={css.flagAlarm}>{t('incidents.unitsMissing')}</span>
                )}
                {i.doctorRequested && needsUnits(i, L) && (
                  <span className={css.flagAlarm}>{t('incidents.doctorRequested')}</span>
                )}
                {i.outcome && <span className={css.flag}>{t(`outcome.${i.outcome}`)}</span>}
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
                  : formatDuration(now - i.receivedAt)}
              </td>
              <td>
                {needsUnits(i, L) && (
                  <button
                    type="button"
                    className={css.smallBtn}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

function describeFinding(f: NonNullable<IncidentView['finding']>, L: Lookup): string {
  const parts: string[] = [];
  if (f.fireScenarioId) parts.push(L.fireScenarioName(f.fireScenarioId) + (f.fireDone ? ' ✓' : ''));
  if (f.patient) parts.push(`${L.diagnosisName(f.diagnosisId)} · NACA ${f.naca.toString()}`);
  if (parts.length === 0) parts.push('kein Patient');
  return parts.join(' · ');
}

export function VehiclePanel() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const vehicles = useSim((s) => s.host?.view.vehicles ?? EMPTY);
  const now = useSim((s) => s.host?.view.time ?? 0);
  const openDialog = useSim((s) => s.openDialog);
  const command = useSim((s) => s.command);
  const select = useSim((s) => s.selectIncident);
  if (!world) return null;
  const L = lookup(world);
  const byStation = world.stations.map((s) => ({
    station: s,
    list: vehicles.filter((v) => L.vehicle(v.id)?.stationId === s.id),
  }));
  const free = vehicles.filter((v) => v.status === 1 || v.status === 2).length;
  return (
    <section
      className={`${css.panel ?? ''} ${css.vehicles ?? ''}`}
      aria-label={t('panel.vehicles')}
    >
      <header className={css.header}>
        {t('panel.vehicles')}
        <span className={css.count}>
          {free}/{vehicles.length}
        </span>
      </header>
      <div className={css.body} data-testid="vehicle-panel">
        {byStation.map(({ station, list }) => (
          <div key={station.id} className={css.group}>
            <div className={css.groupTitle}>{station.name}</div>
            {list.map((v) => (
              <VehicleRow
                key={v.id}
                v={v}
                L={L}
                now={now}
                t={t}
                onDestination={() => {
                  openDialog({ kind: 'destination', vehicleId: v.id });
                }}
                onRelease={() => {
                  command({ type: 'vehicle/release', vehicleId: v.id });
                }}
                onBreak={() => {
                  command({ type: 'vehicle/break', vehicleId: v.id });
                }}
                onResume={() => {
                  command({ type: 'vehicle/resume', vehicleId: v.id });
                }}
                onSelect={() => {
                  if (v.incidentId) select(v.incidentId);
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function VehicleRow(props: {
  v: VehicleView;
  L: Lookup;
  now: number;
  t: TFunction;
  onDestination: () => void;
  onRelease: () => void;
  onBreak: () => void;
  onResume: () => void;
  onSelect: () => void;
}) {
  const { v, L, now, t } = props;
  const info = L.vehicle(v.id);
  const releasable = v.incidentId !== null && ['turnout', 'toScene', 'onScene'].includes(v.task);
  return (
    <div
      className={`${css.vehicleRow ?? ''} ${v.status === 5 ? (css.vehicleRequest ?? '') : ''} ${v.status === 6 ? (css.vehicleOff ?? '') : ''}`}
      onClick={props.onSelect}
      data-testid="vehicle-row"
    >
      <FmsChip status={v.status} />
      <div className={css.vehicleName}>
        <strong>{info?.type}</strong> <span className={css.mono}>{info?.short}</span>
      </div>
      <div className={css.vehicleTask}>
        {v.service ? t(`service.${v.service.reason}`) : t(`task.${v.task}`)}
        {v.service?.until !== undefined && (
          <span className={css.meta}>
            {' '}
            · {t('vehicles.until', { time: formatTimeOfDay(v.service.until) })}
          </span>
        )}
        {v.service?.reason === 'offDuty' && info?.service && (
          <span className={css.meta}>
            {' '}
            · {t('vehicles.serviceHours', { from: info.service.from, to: info.service.to })}
          </span>
        )}
        {v.incidentId && <span className={css.meta}> · {v.incidentId}</span>}
        {v.hospitalId && <span className={css.meta}> → {L.hospitalName(v.hospitalId)}</span>}
        {v.moving && v.etaAt !== undefined && (
          <span className={css.eta}> {formatDuration(v.etaAt - now)}</span>
        )}
      </div>
      {v.status === 5 && (
        <button
          type="button"
          className={`${css.smallBtn ?? ''} ${css.smallAlarm ?? ''}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onDestination();
          }}
          data-testid="destination-btn"
        >
          {t('vehicles.destination')}
        </button>
      )}
      {v.breakRequested && !v.service && (
        <button
          type="button"
          className={`${css.smallBtn ?? ''} ${css.smallWarn ?? ''}`}
          title={t('vehicles.breakHint')}
          onClick={(e) => {
            e.stopPropagation();
            props.onBreak();
          }}
          data-testid="break-btn"
        >
          {t('vehicles.grantBreak')}
        </button>
      )}
      {v.service?.reason === 'break' && (
        <button
          type="button"
          className={css.smallBtn}
          onClick={(e) => {
            e.stopPropagation();
            props.onResume();
          }}
        >
          {t('vehicles.endBreak')}
        </button>
      )}
      {releasable && (
        <button
          type="button"
          className={css.smallBtn}
          title={t('vehicles.release')}
          onClick={(e) => {
            e.stopPropagation();
            props.onRelease();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function RadioLog() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const events = useSim((s) => s.events);
  if (!world) return null;
  const L = lookup(world);
  return (
    <div className={css.body}>
      <ul className={css.log} data-testid="event-log">
        {events
          .filter((e) => e.type !== 'call/answer')
          .map((e) => (
            <li key={e.key} className={`${css.logRow ?? ''} ${logClass(e) ?? ''}`}>
              <span className={css.logTime}>{formatTimeOfDay(e.at)}</span>
              <span>{describe(e, L, t)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function logClass(e: LogEntry): string | undefined {
  if (e.type === 'radio') {
    if (
      [
        'requestDoctor',
        'requestDestination',
        'wrongLocation',
        'requestTransport',
        'defect',
      ].includes(e.message)
    )
      return css.logAlarm;
    if (['requestBreak', 'disinfection', 'refuel', 'offDuty'].includes(e.message))
      return css.logWarn;
    return css.logRadio;
  }
  if (e.type === 'hospital/status') return e.open ? css.logOk : css.logWarn;
  if (e.type === 'call/abandoned' || e.type === 'command/rejected') return css.logAlarm;
  if (e.type === 'call/incoming') return css.logWarn;
  if (e.type === 'incident/closed' || e.type === 'call/accepted') return css.logOk;
  return undefined;
}

function describe(e: LogEntry, L: Lookup, t: TFunction): string {
  switch (e.type) {
    case 'radio': {
      const who = L.vehicle(e.vehicleId);
      const text =
        e.message === 'status'
          ? t('radio.status', { status: e.status, text: t(`fms.${e.status.toString()}`) })
          : t(`radio.${e.message}`);
      return `${who?.type ?? ''} ${who?.short ?? e.vehicleId}${e.incidentId ? ` (${e.incidentId})` : ''}: ${text}`;
    }
    case 'call/accepted':
      return t('events.call/accepted', { id: e.callId, waited: formatDuration(e.waitedMs) });
    case 'call/incoming':
    case 'call/abandoned':
    case 'call/closed':
      return t(`events.${e.type}`, { id: e.callId });
    case 'incident/created':
      return t('events.incident/created', { id: e.incidentId });
    case 'incident/closed':
      return t('events.incident/closed', { id: e.incidentId, outcome: t(`outcome.${e.outcome}`) });
    case 'command/rejected':
      return t('events.command/rejected', { reason: t(`reason.${e.reason}`) });
    case 'shift/ended':
      return t('events.shift/ended', { index: e.index });
    case 'call/answer':
      return t('events.call/answer', { id: e.callId, question: t(`question.${e.question}`) });
    case 'call/linked':
      return t('events.call/linked', { id: e.callId, incident: e.incidentId });
    case 'hospital/status':
      return t(`events.hospital/${e.open ? 'open' : e.reason}`, {
        hospital: L.hospitalName(e.hospitalId),
        department: t(`department.${e.department}`),
      });
  }
}

const TABS = ['incidents', 'orders', 'hospitals', 'radio'] as const;
type Tab = (typeof TABS)[number];

export function BottomTabs() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('incidents');
  const open = useSim(
    (s) =>
      (s.host?.view.incidents ?? EMPTY).filter((i) => !i.order && i.status !== 'closed').length,
  );
  const orders = useSim(
    (s) => (s.host?.view.incidents ?? EMPTY).filter((i) => i.order && i.status === 'open').length,
  );
  const closedDepts = useSim((s) =>
    (s.host?.view.hospitals ?? EMPTY).reduce(
      (n, h) => n + h.departments.filter((d) => !d.open).length,
      0,
    ),
  );
  const counts: Partial<Record<Tab, number>> = {
    incidents: open,
    orders,
    hospitals: closedDepts,
  };
  return (
    <section className={`${css.panel ?? ''} ${css.bottom ?? ''}`}>
      <header className={css.tabs} role="tablist">
        {TABS.map((k) => (
          <button
            type="button"
            role="tab"
            key={k}
            aria-selected={tab === k}
            className={`${css.tab ?? ''} ${tab === k ? (css.tabActive ?? '') : ''}`}
            onClick={() => {
              setTab(k);
            }}
            data-testid={`tab-${k}`}
          >
            {t(`panel.${k}`)}
            {counts[k] !== undefined && (
              <span
                className={`${css.count ?? ''} ${k === 'hospitals' && closedDepts > 0 ? (css.countWarn ?? '') : ''}`}
              >
                {counts[k]}
              </span>
            )}
          </button>
        ))}
      </header>
      {tab === 'incidents' && <IncidentList />}
      {tab === 'orders' && <OrderList />}
      {tab === 'hospitals' && <HospitalPanel />}
      {tab === 'radio' && <RadioLog />}
    </section>
  );
}
