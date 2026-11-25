import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QUESTIONS, type CallView, type Question, type StaticAddress } from '@ls112/protocol';
import { formatDuration } from '../format';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import css from './Dialog.module.css';

/** Doppelmeldungen: Einsätze in diesem Umkreis um die genannte Adresse werden vorgeschlagen. */
const LINK_RADIUS_M = 600;

/**
 * Notrufmaske: strukturierte Abfrage (W-Fragen), Adresssuche, Stichwort – oder Zuordnung zu einem
 * bestehenden Einsatz bzw. Beenden ohne Einsatz. Der Anrufer antwortet mit Verzögerung und kann
 * sich irren (ADR-0014).
 */
export function CallMask({ callId }: { callId: string }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const call = useSim((s) => s.host?.view.calls.find((c) => c.id === callId));
  const incidents = useSim((s) => s.host?.view.incidents);
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
  const answeredOrAsked = (q: Question) => call.answered.includes(q) || call.asked.includes(q);
  const ask = (q: Question) => {
    if (!answeredOrAsked(q)) command({ type: 'call/ask', callId, question: q });
  };
  const askAll = () => {
    for (const q of QUESTIONS) ask(q);
  };

  const takeOver = () => {
    const a = r?.address;
    if (!a) return;
    const text =
      a.toTownId !== null
        ? `${L.streetName(a.streetId)} ${L.townName(a.townId)}`
        : `${L.streetName(a.streetId)} ${a.number} ${a.townId ? L.townName(a.townId) : ''}`;
    setQuery(text);
    setActive(0);
    input.current?.focus();
  };

  // Laufende Einsätze in der Nähe der genannten (oder gewählten) Adresse – mögliche Doppelmeldung.
  const stated = r?.address;
  const ref =
    chosen ??
    (stated
      ? L.searchAddresses(`${L.streetName(stated.streetId)} ${stated.number}`, 1)[0]
      : undefined);
  const nearby = (incidents ?? [])
    .filter((i) => i.status !== 'closed')
    .map((i) => {
      const a = L.address(i.addressId);
      const d = a && ref ? Math.hypot(a.x - ref.x, a.y - ref.y) : Infinity;
      return { i, d };
    })
    .filter((x) => x.d <= LINK_RADIUS_M)
    .sort((a, b) => a.d - b.d);

  const create = () => {
    if (!chosen || !keywordId) return;
    useSim.setState({ expectDispatch: true });
    command({ type: 'incident/create', callId, addressId: chosen.id, keywordId });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.altKey && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      const q = QUESTIONS[Number(e.key) - 1];
      if (q) ask(q);
    } else if (e.altKey && e.key === '0') {
      e.preventDefault();
      askAll();
    } else if (e.key === 'ArrowDown') {
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
          {call.source === '110' && <span className={css.badge}>{t('mask.police')}</span>}
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
            <div className={css.section}>
              <Transcript call={call} />
              <span className={css.label}>{t('mask.questions')}</span>
              <div className={css.questions}>
                {QUESTIONS.map((q, i) => {
                  const done = call.answered.includes(q);
                  const waiting = call.asked.includes(q);
                  return (
                    <button
                      type="button"
                      key={q}
                      className={`${css.question ?? ''} ${done ? (css.questionDone ?? '') : ''} ${waiting ? (css.questionWaiting ?? '') : ''}`}
                      disabled={done || waiting}
                      onClick={() => {
                        ask(q);
                      }}
                      data-testid={`ask-${q}`}
                    >
                      <span className={css.kbdSmall}>Alt+{i + 1}</span> {t(`question.${q}`)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={css.question}
                  onClick={askAll}
                  data-testid="ask-all"
                >
                  <span className={css.kbdSmall}>Alt+0</span> {t('mask.askAll')}
                </button>
              </div>
            </div>
            <div className={css.section}>
              <div className={css.section}>
                <span className={css.label}>{t('mask.address')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    ref={input}
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
                    disabled={!r?.address}
                    title={r?.address ? '' : t('mask.askWhereFirst')}
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

              {(call.known || r?.aggressive) && (
                <div className={css.section} data-testid="known-info">
                  <span className={css.label}>{t('known.title')}</span>
                  {r?.aggressive && <div className={css.bad}>⚠ {t('known.aggressive')}</div>}
                  {call.known && call.known.addressCount > 0 && (
                    <div>
                      {t('known.address', { count: call.known.addressCount })}
                      {call.known.lastKeywords.length > 0 &&
                        ` (${call.known.lastKeywords.map((k) => L.keywordCode(k)).join(', ')})`}
                    </div>
                  )}
                  {call.known?.addressFlags.includes('danger') && (
                    <div className={css.bad}>⚠ {t('known.danger')}</div>
                  )}
                  {call.known?.caller && (
                    <div className={css.warn}>
                      {t(`known.caller.${call.known.caller.kind}`, {
                        count: call.known.caller.calls,
                      })}
                    </div>
                  )}
                </div>
              )}

              {nearby.length > 0 && (
                <div className={css.section} data-testid="nearby-incidents">
                  <span className={css.label}>{t('mask.nearby')}</span>
                  {nearby.map(({ i, d }) => (
                    <div key={i.id} className={css.nearby}>
                      <span>
                        <strong>{i.id}</strong> {L.keywordCode(i.keywordId)} ·{' '}
                        {L.addressLabel(i.addressId)}
                        <span className={css.hint}> · {Math.round(d)} m</span>
                      </span>
                      <button
                        type="button"
                        className={css.btn}
                        onClick={() => {
                          command({ type: 'call/link', callId, incidentId: i.id });
                          openDialog(null);
                        }}
                        data-testid="link-incident"
                      >
                        {t('mask.link')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className={css.section}>
                <span className={css.label}>{t('mask.keyword')}</span>
                <div className={css.keywords} role="radiogroup">
                  {world.keywords
                    .filter((k) => !k.planned)
                    .map((k) => (
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
            data-testid="end-call"
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

/** Gesprächsverlauf: nur gestellte Fragen und bereits gegebene Antworten. */
export function Transcript({ call }: { call: CallView }) {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const r = call.report;
  if (!r || !world) return null;
  const L = lookup(world);
  const intro = r.silent
    ? t('caller.silence')
    : `${t(`caller.intro.${r.kind}`)} ${r.tone !== 'normal' ? t(`caller.tone.${r.tone}`) : ''}`;
  const answer = (q: Question): string => {
    if (r.silent) return t('caller.silenceAnswer');
    switch (q) {
      case 'where': {
        const a = r.address;
        if (!a) return '';
        if (a.toTownId !== null) {
          return t('caller.addressRoad', {
            road: L.streetName(a.streetId),
            a: L.townName(a.townId),
            b: L.townName(a.toTownId),
          });
        }
        return a.townId
          ? t('caller.addressHouse', {
              street: L.streetName(a.streetId),
              number: a.number,
              town: L.townName(a.townId),
            })
          : t('caller.addressNoTown', { street: L.streetName(a.streetId), number: a.number });
      }
      case 'what':
        return r.reportKey ? t(`report.${r.reportKey}`) : '';
      case 'who':
        if (!r.patient) return '';
        return r.patient.ageGuess < 14
          ? t('caller.child', { age: r.patient.ageGuess })
          : t('caller.patient', { sex: t(`caller.sex.${r.patient.sex}`), age: r.patient.ageGuess });
      case 'conscious':
        return r.conscious ? t(`caller.conscious.${r.conscious}`) : '';
      case 'breathing':
        return r.breathing ? t(`caller.breathing.${r.breathing}`) : '';
      case 'callback':
        return r.callback === '' ? t('caller.suppressed') : (r.callback ?? '');
    }
  };
  return (
    <div className={css.section}>
      <span className={css.label}>
        {t('mask.transcript')}
        {!r.silent && ` · ${t(`caller.kind.${r.kind}`)}`}
      </span>
      <div className={css.transcript} data-testid="transcript">
        <span className={`${css.a ?? ''} ${r.tone === 'panic' ? (css.panic ?? '') : ''}`}>
          {intro}
        </span>
        {r.giggling && <span className={css.stage}>{t('caller.giggling')}</span>}
        {call.answered.map((q) => (
          <span key={q} style={{ display: 'contents' }}>
            <span className={css.q}>{t(`questionLong.${q}`)}</span>
            <span className={css.a}>{answer(q)}</span>
          </span>
        ))}
        {call.asked.map((q, i) => (
          <span key={q} style={{ display: 'contents' }}>
            <span className={css.q}>{t(`questionLong.${q}`)}</span>
            {i === 0 && (
              <span className={css.typing} data-testid="typing">
                …
              </span>
            )}
          </span>
        ))}
        {call.answered.length === 0 && call.asked.length === 0 && (
          <span className={css.hint}>{t('mask.startAsking')}</span>
        )}
      </div>
    </div>
  );
}
