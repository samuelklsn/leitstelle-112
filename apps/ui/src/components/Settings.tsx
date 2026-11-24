/**
 * Arbeitsplatz-Einstellungen: Fenster und Layouts für mehrere Bildschirme (#50) und die
 * Tastenbelegung (#30). Reine Oberfläche – die Fenster verwaltet der Main-Prozess.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACTIONS,
  DEFAULT_KEYMAP,
  bindingFromEvent,
  formatBinding,
  rebind,
  type Action,
} from '../keymap';
import { useSim } from '../sim-store';
import { Modal } from './Overlays';
import css from './Dialog.module.css';

type LayoutList = Awaited<ReturnType<NonNullable<Window['ls112']>['listLayouts']>>;

const VIEWS = ['map', 'lists', 'vehicles'] as const;

export function WindowsDialog() {
  const { t } = useTranslation();
  const openDialog = useSim((s) => s.openDialog);
  const notify = useSim((s) => s.notify);
  const bridge = window.ls112;
  const [list, setList] = useState<LayoutList | null>(null);
  const [name, setName] = useState('');
  const refresh = () => {
    void bridge?.listLayouts().then(setList);
  };
  useEffect(refresh, [bridge]);
  return (
    <Modal
      title={t('windows.title')}
      onClose={() => {
        openDialog(null);
      }}
      testId="windows-dialog"
    >
      {!bridge && <p className={css.hint}>{t('windows.browserOnly')}</p>}
      <div className={css.section}>
        <span className={css.label}>{t('windows.open')}</span>
        <div className={css.row}>
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={css.btn}
              disabled={!bridge}
              onClick={() => {
                void bridge?.openWindow(v);
              }}
              data-testid={`open-window-${v}`}
            >
              {t(`windows.view.${v}`)}
            </button>
          ))}
        </div>
        <span className={css.hint}>{t('windows.openHint')}</span>
      </div>
      <div className={css.section}>
        <span className={css.label}>
          {t('windows.layouts')}
          {list ? ` · ${t('windows.displays', { count: list.displays })}` : ''}
        </span>
        <table className={css.table}>
          <tbody>
            {list?.layouts.map((l) => (
              <tr key={l.name} className={l.name === list.last ? css.rowRecommended : ''}>
                <td>
                  <strong>{l.name}</strong>
                  <div className={css.hint}>
                    {l.builtIn ? t('windows.builtIn') : t('windows.own')} ·{' '}
                    {t('windows.windowCount', { count: l.windows })}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className={`${css.btn ?? ''} ${css.primary ?? ''}`}
                    onClick={() => {
                      void bridge?.applyLayout(l.name).then(refresh);
                    }}
                  >
                    {t('windows.apply')}
                  </button>{' '}
                  {!l.builtIn && (
                    <button
                      type="button"
                      className={css.btn}
                      onClick={() => {
                        void bridge?.deleteLayout(l.name).then(refresh);
                      }}
                    >
                      {t('windows.delete')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={css.row}>
          <input
            className={css.input}
            value={name}
            maxLength={60}
            placeholder={t('windows.namePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <button
            type="button"
            className={css.btn}
            disabled={!bridge || name.trim().length === 0}
            onClick={() => {
              void bridge?.saveLayout(name).then((ok) => {
                if (ok) notify(t('windows.saved', { name: name.trim() }));
                setName('');
                refresh();
              });
            }}
          >
            {t('windows.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function KeysDialog() {
  const { t } = useTranslation();
  const openDialog = useSim((s) => s.openDialog);
  const keymap = useSim((s) => s.keymap);
  const setKeymap = useSim((s) => s.setKeymap);
  const setCapturing = useSim((s) => s.setCapturingKey);
  const [capturing, setCapturingLocal] = useState<Action | null>(null);
  useEffect(() => {
    if (!capturing) return;
    setCapturing(true);
    const onKey = (e: KeyboardEvent) => {
      // Reine Umschalttasten abwarten, bis die eigentliche Taste kommt.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape' || capturing === 'closeDialog')
        setKeymap(rebind(keymap, capturing, bindingFromEvent(e)));
      setCapturingLocal(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setCapturing(false);
    };
  }, [capturing, keymap, setKeymap, setCapturing]);
  return (
    <Modal
      title={t('keys.title')}
      onClose={() => {
        openDialog(null);
      }}
      testId="keys-dialog"
      footer={
        <button
          type="button"
          className={css.btn}
          onClick={() => {
            setKeymap(DEFAULT_KEYMAP);
          }}
        >
          {t('keys.reset')}
        </button>
      }
    >
      <p className={css.hint}>{t('keys.hint')}</p>
      <table className={css.table}>
        <tbody>
          {ACTIONS.map((a) => (
            <tr key={a}>
              <td>{t(`keys.action.${a}`)}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  className={`${css.btn ?? ''} ${capturing === a ? (css.primary ?? '') : ''}`}
                  onClick={() => {
                    setCapturingLocal(a);
                  }}
                  data-testid={`key-${a}`}
                >
                  {capturing === a ? t('keys.press') : formatBinding(keymap[a])}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.hint}>{t('keys.fixed')}</p>
    </Modal>
  );
}

/** Logs und Absturzberichte als ZIP für einen Fehlerbericht (#34). */
export function DiagnosticsButton() {
  const { t } = useTranslation();
  const notify = useSim((s) => s.notify);
  const bridge = window.ls112;
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={css.btn}
      disabled={!bridge || busy}
      onClick={() => {
        setBusy(true);
        void bridge
          ?.createDiagnostics()
          .then((file) => {
            if (file) notify(t('diagnostics.saved'));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
      data-testid="create-diagnostics"
    >
      {t('diagnostics.create')}
    </button>
  );
}
