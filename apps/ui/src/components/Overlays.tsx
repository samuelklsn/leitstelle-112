import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SaveInfo, ShiftStats } from '@ls112/protocol';
import { formatDuration } from '../format';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import css from './Dialog.module.css';
import ov from './Overlays.module.css';

function Modal(props: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className={css.backdrop} role="dialog" aria-label={props.title} data-testid={props.testId}>
      <div className={css.dialog}>
        <div className={css.head}>
          <span className={css.title}>{props.title}</span>
          {props.onClose && (
            <button
              type="button"
              className={css.close}
              onClick={props.onClose}
              aria-label="Schließen"
            >
              ✕
            </button>
          )}
        </div>
        <div className={css.body}>{props.children}</div>
        {props.footer && <div className={css.foot}>{props.footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ Start

export function StartScreen() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const newGame = useSim((s) => s.newGame);
  const openDialog = useSim((s) => s.openDialog);
  return (
    <div className={ov.start} data-testid="start-screen">
      <div className={ov.startInner}>
        <div className={ov.logo}>
          <span className={ov.logoMark}>112</span>
          <div>
            <h1 className={ov.startTitle}>Leitstelle 112</h1>
            <p className={ov.startSub}>{t('start.subtitle')}</p>
          </div>
        </div>
        <p className={ov.region}>
          {world?.centerName} · {world?.regionName}
        </p>
        <div className={ov.cards}>
          <button
            type="button"
            className={ov.card}
            onClick={() => {
              newGame('free');
            }}
            data-testid="start-free"
            autoFocus
          >
            <strong>{t('start.free')}</strong>
            <span>{t('start.freeText')}</span>
          </button>
          <button
            type="button"
            className={ov.card}
            onClick={() => {
              newGame('tutorial');
            }}
            data-testid="start-tutorial"
          >
            <strong>{t('start.tutorial')}</strong>
            <span>{t('start.tutorialText')}</span>
          </button>
          <button
            type="button"
            className={ov.card}
            onClick={() => {
              openDialog({ kind: 'saves' });
            }}
          >
            <strong>{t('start.load')}</strong>
            <span>{t('start.loadText')}</span>
          </button>
        </div>
        <p className={ov.disclaimer}>{t('start.disclaimer')}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ Auswertung

export function EvaluationDialog({ shift }: { shift: ShiftStats | undefined }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const current = useSim((s) => s.host?.view.shift);
  const openDialog = useSim((s) => s.openDialog);
  const s = shift ?? current;
  if (!s || !world) return null;
  const L = lookup(world);
  const quota =
    s.hilfsfristMeasured > 0 ? Math.round((100 * s.hilfsfristMet) / s.hilfsfristMeasured) : 100;
  const target = Math.round(world.hilfsfrist.targetQuota * 100);
  const errors = Object.entries(s.errors).filter(([, n]) => n > 0);
  const rating =
    quota >= target && errors.length <= 2 ? 'excellent' : quota >= target - 15 ? 'good' : 'poor';
  const duration = (s.endedAt ?? useSim.getState().host?.view.time ?? s.startedAt) - s.startedAt;
  return (
    <Modal
      title={`${t('evaluation.title')} – ${s.endedAt !== undefined ? t('evaluation.finished', { n: s.index }) : t('evaluation.current', { n: s.index })}`}
      onClose={() => {
        openDialog(null);
      }}
      testId="evaluation"
      footer={
        <button
          type="button"
          className={`${css.btn ?? ''} ${css.primary ?? ''}`}
          onClick={() => {
            openDialog(null);
          }}
          autoFocus
        >
          {t('evaluation.continue')}
        </button>
      }
    >
      <div className={ov.rating}>{t(`evaluation.rating.${rating}`)}</div>
      <div className={css.kpis}>
        <div className={css.kpi}>
          <span>{t('evaluation.score')}</span>
          <strong>{s.score}</strong>
        </div>
        <div className={css.kpi}>
          <span>{t('evaluation.hilfsfrist')}</span>
          <strong className={quota >= target ? css.ok : css.bad}>{quota} %</strong>
        </div>
        <div className={css.kpi}>
          <span>{t('evaluation.response')}</span>
          <strong>
            {formatDuration(s.hilfsfristMeasured ? s.totalResponseMs / s.hilfsfristMeasured : 0)}
          </strong>
        </div>
        <div className={css.kpi}>
          <span>{t('evaluation.answer')}</span>
          <strong>{formatDuration(s.callsAccepted ? s.totalAnswerMs / s.callsAccepted : 0)}</strong>
        </div>
      </div>
      <div className={css.section}>
        <span className={css.label}>{t('evaluation.hilfsfrist')}</span>
        <div>
          {t('evaluation.hilfsfristValue', {
            met: s.hilfsfristMet,
            total: s.hilfsfristMeasured,
            quota,
          })}{' '}
          ·{' '}
          <span className={css.hint}>
            {t('evaluation.target', { label: world.hilfsfrist.label })}
          </span>
        </div>
        <div className={css.bar}>
          <div
            style={{
              width: `${quota.toString()}%`,
              background: quota >= target ? 'var(--ok)' : 'var(--warn)',
            }}
          />
        </div>
      </div>
      <div className={ov.columns}>
        <div className={css.section}>
          <span className={css.label}>
            {t('evaluation.calls')} / {t('evaluation.incidents')}
          </span>
          <div>
            {s.callsReceived} {t('evaluation.calls')} · {s.incidents} {t('evaluation.incidents')} ·{' '}
            {formatDuration(duration)} h
          </div>
          <span className={css.label}>{t('evaluation.outcomes')}</span>
          {(['gut', 'beeintraechtigt', 'verstorben', 'keinPatient'] as const).map((o) => (
            <div key={o}>
              {t(`outcome.${o}`)}: <strong className={css.mono}>{s.outcomes[o]}</strong>
            </div>
          ))}
        </div>
        <div className={css.section}>
          <span className={css.label}>{t('evaluation.errors')}</span>
          {errors.length === 0 && <div className={css.ok}>{t('evaluation.noErrors')}</div>}
          {errors.map(([code, n]) => (
            <div key={code} className={css.warn}>
              {n}× {t(`error.${code}`)}
            </div>
          ))}
          {s.vehicleBusyMs && (
            <>
              <span className={css.label}>{t('evaluation.utilization')}</span>
              {Object.entries(s.vehicleBusyMs).map(([id, ms]) => {
                const pct = duration > 0 ? Math.round((100 * ms) / duration) : 0;
                return (
                  <div
                    key={id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px 1fr 40px',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <span className={css.mono}>
                      {L.vehicle(id)?.type} {L.vehicle(id)?.short}
                    </span>
                    <div className={css.bar}>
                      <div style={{ width: `${pct.toString()}%` }} />
                    </div>
                    <span className={css.mono}>{pct}%</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------ Spielstände

export function SavesDialog() {
  const { t } = useTranslation();
  const query = useSim((s) => s.query);
  const send = useSim((s) => s.send);
  const host = useSim((s) => s.host);
  const openDialog = useSim((s) => s.openDialog);
  const [items, setItems] = useState<readonly SaveInfo[]>([]);
  const [name, setName] = useState('');
  const refresh = () => {
    void query({ type: 'saves' }).then((r) => {
      if (r.type === 'saves') setItems(r.items);
    });
  };
  useEffect(refresh, [query]);
  return (
    <Modal
      title={t('saves.title')}
      onClose={() => {
        openDialog(host ? null : { kind: 'start' });
      }}
      testId="saves"
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className={css.input}
          value={name}
          placeholder={t('saves.name')}
          onChange={(e) => {
            setName(e.target.value);
          }}
          maxLength={60}
        />
        <button
          type="button"
          className={`${css.btn ?? ''} ${css.primary ?? ''}`}
          disabled={name.trim().length === 0}
          onClick={() => {
            send({ type: 'save/write', name });
            setName('');
            setTimeout(refresh, 200);
          }}
        >
          {t('saves.save')}
        </button>
      </div>
      {items.length === 0 && <div className={css.hint}>{t('saves.empty')}</div>}
      <table className={css.table}>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                <div className={css.hint}>
                  {s.kind === 'auto' ? t('saves.auto') : t('saves.manual')} ·{' '}
                  {new Date(s.createdAt).toLocaleString('de-DE')}
                </div>
              </td>
              <td className={css.mono}>Schicht {s.shiftIndex}</td>
              <td>
                <button
                  type="button"
                  className={css.btn}
                  onClick={() => {
                    send({ type: 'save/load', id: s.id });
                    openDialog(null);
                  }}
                >
                  {t('saves.load')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ------------------------------------------------------------------------------ Hilfe

export function HelpDialog() {
  const { t } = useTranslation();
  const openDialog = useSim((s) => s.openDialog);
  const keys: [string, string][] = [
    ['Leertaste', 'space'],
    ['1 – 4', 'speed'],
    ['F2', 'f2'],
    ['F3', 'f3'],
    ['F4', 'f4'],
    ['Enter', 'enter'],
    ['Strg+Enter', 'ctrlEnter'],
    ['Esc', 'esc'],
  ];
  return (
    <Modal
      title={t('help.title')}
      onClose={() => {
        openDialog(null);
      }}
    >
      <p>{t('help.flow')}</p>
      <table className={css.table}>
        <tbody>
          {keys.map(([k, id]) => (
            <tr key={id}>
              <td className={css.mono} style={{ width: 140 }}>
                {k}
              </td>
              <td>{t(`help.keys.${id}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ------------------------------------------------------------------------------ Tutorial

/** Leitet durch den ersten Einsatz, abgeleitet aus dem sichtbaren Spielzustand. */
export function TutorialCoach() {
  const { t } = useTranslation();
  const host = useSim((s) => s.host);
  const dialog = useSim((s) => s.dialog);
  const progress = useSim((s) => s.maskProgress);
  const [dismissed, setDismissed] = useState(false);
  if (!host || host.mode !== 'tutorial' || dismissed) return null;
  const v = host.view;
  let step = 1;
  const anyStatus = (st: number[]) =>
    v.vehicles.some((x) => x.incidentId !== null && st.includes(x.status));
  if (
    v.incidents.some((i) => i.status === 'closed') ||
    v.vehicles.some((x) => x.task === 'toHospital' || x.task === 'handover')
  )
    step = 9;
  else if (v.vehicles.some((x) => x.task === 'awaitDestination')) step = 8;
  else if (anyStatus([4])) step = 7;
  else if (v.incidents.some((i) => i.vehicleIds.length > 0)) step = 6;
  else if (v.incidents.length > 0) step = 5;
  else if (dialog?.kind === 'call') step = progress.address ? (progress.keyword ? 4 : 3) : 2;
  else if (v.calls.some((c) => c.status === 'talking')) step = 2;
  return (
    <div className={ov.coach} data-testid="tutorial-coach">
      <div className={ov.coachHead}>
        <span>
          {t('tutorial.title')} · {step}/9
        </span>
        <button
          type="button"
          className={css.close}
          onClick={() => {
            setDismissed(true);
          }}
          aria-label={t('tutorial.close')}
        >
          ✕
        </button>
      </div>
      <p>{t(`tutorial.s${step.toString()}`)}</p>
    </div>
  );
}
