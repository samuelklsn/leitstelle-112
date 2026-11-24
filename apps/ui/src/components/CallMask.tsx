import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CallView, StaticAddress } from '@ls112/protocol';
import { formatDuration } from '../format';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import css from './Dialog.module.css';

/**
 * Notrufmaske: Gesprächsverlauf mit den Angaben des Anrufers, Adresssuche und Stichwortwahl.
 * Der Anrufer kann sich irren – der Disponent entscheidet (ADR-0014, „wahre Lage").
 */
export function CallMask({ callId }: { callId: string }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const call = useSim((s) => s.host?.view.calls.find((c) => c.id === callId));
  const now = useSim((s) => s.host?.view.time ?? 0);
  const command = useSim((s) => s.command);
  const openDialog = useSim((s) => s.openDialog);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<StaticAddress | undefined>();
  const [keywordId, setKeywordId] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  const L = world ? lookup(world) : undefined;
  const results = useMemo(
    () => (L && query.length >= 2 ? L.searchAddresses(query) : []),
    [L, query],
  );

  useEffect(() => {
    useSim.setState({
      maskProgress: { address: chosen !== undefined, keyword: keywordId !== undefined },
    });
  }, [chosen, keywordId]);
  useEffect(
    () => () => {
      useSim.setState({ maskProgress: { address: false, keyword: false } });
    },
    [],
  );

  if (!call || !L || !world) return null;
  const r = call.report;

  const takeOver = () => {
    if (!r) return;
    const text =
      r.toTownId !== null
        ? `${L.streetName(r.streetId)} ${L.townName(r.townId)}`
        : `${L.streetName(r.streetId)} ${r.number} ${r.townId ? L.townName(r.townId) : ''}`;
    setQuery(text);
    setActive(0);
    input.current?.focus();
  };

  const create = () => {
    if (!chosen || !keywordId) return;
    useSim.setState({ expectDispatch: true });
    command({ type: 'incident/create', callId, addressId: chosen.id, keywordId });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      create();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[active];
      if (pick) setChosen(pick);
    }
  };

  return (
    <div
      className={`${css.side ?? ''} ${css.wide ?? ''}`}
      onKeyDown={onKey}
      role="dialog"
      aria-label={t('mask.title', { id: callId })}
      data-testid="call-mask"
    >
      <div className={css.dialog}>
        <div className={css.head}>
          <span className={css.title}>{t('mask.title', { id: callId })}</span>
          <span className={`${css.badge ?? ''} ${css.badgeAlarm ?? ''}`}>
            {t('calls.talking', {
              duration: formatDuration(now - (call.acceptedAt ?? call.receivedAt)),
            })}
          </span>
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
          <div className={css.split}>
            {r && <Transcript call={call} />}
            <div className={css.section}>
              <div className={css.section}>
                <span className={css.label}>{t('mask.address')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    ref={input}
                    autoFocus
                    className={css.input}
                    value={query}
                    placeholder={t('mask.addressPlaceholder')}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    data-testid="address-input"
                  />
                  <button
                    type="button"
                    className={css.btn}
                    onClick={takeOver}
                    data-testid="take-address"
                  >
                    {t('mask.takeAddress')}
                  </button>
                </div>
                {query.length >= 2 && (
                  <div className={css.results} data-testid="address-results">
                    {results.length === 0 && (
                      <div className={css.result}>{t('mask.noResults')}</div>
                    )}
                    {results.map((a, i) => (
                      <button
                        type="button"
                        key={a.id}
                        className={`${css.result ?? ''} ${i === active ? (css.resultActive ?? '') : ''} ${chosen?.id === a.id ? (css.resultChosen ?? '') : ''}`}
                        onClick={() => {
                          setChosen(a);
                          setActive(i);
                        }}
                      >
                        {L.addressLabel(a.id)}
                      </button>
                    ))}
                  </div>
                )}
                {chosen && <div className={css.ok}>✓ {L.addressLabel(chosen.id)}</div>}
              </div>

              <div className={css.section}>
                <span className={css.label}>{t('mask.keyword')}</span>
                <div className={css.keywords} role="radiogroup">
                  {world.keywords.map((k) => (
                    <button
                      type="button"
                      key={k.id}
                      role="radio"
                      aria-checked={keywordId === k.id}
                      className={`${css.keyword ?? ''} ${keywordId === k.id ? (css.keywordActive ?? '') : ''}`}
                      onClick={() => {
                        setKeywordId(k.id);
                      }}
                      data-testid={`keyword-${k.code.replace(' ', '')}`}
                    >
                      <strong>
                        {k.code} · {k.name}
                      </strong>
                      <small>{k.description}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className={css.foot}>
          <span className={css.hint}>{t('mask.hint')}</span>
          <button
            type="button"
            className={css.btn}
            onClick={() => {
              command({ type: 'call/close', callId });
              openDialog(null);
            }}
          >
            {t('mask.end')}
          </button>
          <button
            type="button"
            className={`${css.btn ?? ''} ${css.primary ?? ''}`}
            disabled={!chosen || !keywordId}
            onClick={create}
            data-testid="create-incident"
          >
            {t('mask.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Gesprächsverlauf aus den Angaben des Anrufers, zusammengesetzt aus Textbausteinen. */
export function Transcript({ call }: { call: CallView }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const r = call.report;
  if (!r || !world) return null;
  const L = lookup(world);
  const address =
    r.toTownId !== null
      ? t('caller.addressRoad', {
          road: L.streetName(r.streetId),
          a: L.townName(r.townId),
          b: L.townName(r.toTownId),
        })
      : r.townId
        ? t('caller.addressHouse', {
            street: L.streetName(r.streetId),
            number: r.number,
            town: L.townName(r.townId),
          })
        : t('caller.addressNoTown', { street: L.streetName(r.streetId), number: r.number });
  const patient =
    r.ageGuess < 14
      ? t('caller.child', { age: r.ageGuess })
      : t('caller.patient', { sex: t(`caller.sex.${r.sex}`), age: r.ageGuess });
  return (
    <div className={css.section}>
      <span className={css.label}>
        {t('mask.transcript')} · {t(`caller.kind.${r.kind}`)}
      </span>
      <div className={css.transcript} data-testid="transcript">
        <span className={`${css.a ?? ''} ${r.tone === 'panic' ? (css.panic ?? '') : ''}`}>
          {t(`caller.intro.${r.kind}`)} {r.tone !== 'normal' ? t(`caller.tone.${r.tone}`) : ''}
        </span>
        <span className={css.q}>{t('caller.where')}</span>
        <span className={css.a}>{address}</span>
        <span className={css.q}>{t('caller.what')}</span>
        <span className={css.a}>{t(`report.${r.reportKey}`)}</span>
        <span className={css.q}>{t('caller.who')}</span>
        <span className={css.a}>{patient}</span>
        <span className={css.q}>{t('caller.callbackQ')}</span>
        <span className={`${css.a ?? ''} ${css.mono ?? ''}`}>{r.callback}</span>
      </div>
    </div>
  );
}
