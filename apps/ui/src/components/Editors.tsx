/**
 * Mods und Editoren (ADR-0019): Übersicht der geladenen Mods, Szenario-Editor und Wachen-Editor.
 * Die Editoren speichern ihre Ergebnisse als Mod-Dateien; der Sim-Host prüft und lädt sie neu.
 * Neue Inhalte gelten für das nächste Spiel.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lookup } from '../lookup';
import { useSim } from '../sim-store';
import { Modal } from './Overlays';
import css from './Dialog.module.css';

const OWN_MOD = 'eigene-inhalte';

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replaceAll('ä', 'ae')
      .replaceAll('ö', 'oe')
      .replaceAll('ü', 'ue')
      .replaceAll('ß', 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'neu'
  );
}

export function ModsDialog() {
  const { t } = useTranslation();
  const mods = useSim((s) => s.mods);
  const openDialog = useSim((s) => s.openDialog);
  const bridge = window.ls112;
  return (
    <Modal
      title={t('mods.title')}
      onClose={() => {
        openDialog(null);
      }}
      testId="mods-dialog"
    >
      <p className={css.hint}>{t('mods.hint')}</p>
      {mods.length === 0 && <p>{t('mods.none')}</p>}
      <table className={css.table}>
        <tbody>
          {mods.map((m) => (
            <tr key={m.folder}>
              <td>
                <strong>{m.name ?? m.folder}</strong>{' '}
                <span className={css.hint}>
                  {m.version ? `v${m.version}` : ''} · {m.folder}
                </span>
                {m.problems?.map((p) => (
                  <div key={p} className={css.bad}>
                    {p}
                  </div>
                ))}
              </td>
              <td className={m.ok ? css.ok : css.bad}>{m.ok ? t('mods.ok') : t('mods.failed')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={css.row}>
        <button
          type="button"
          className={css.btn}
          disabled={!bridge}
          onClick={() => {
            void bridge?.openModsFolder();
          }}
        >
          {t('mods.openFolder')}
        </button>
        <button
          type="button"
          className={css.btn}
          onClick={() => {
            openDialog({ kind: 'scenarioEditor' });
          }}
          data-testid="open-scenario-editor"
        >
          {t('mods.scenarioEditor')}
        </button>
        <button
          type="button"
          className={css.btn}
          onClick={() => {
            openDialog({ kind: 'stationEditor' });
          }}
          data-testid="open-station-editor"
        >
          {t('mods.stationEditor')}
        </button>
      </div>
    </Modal>
  );
}

interface DraftCall {
  atMinutes: number;
  kind: 'diagnosis' | 'fire' | 'mci';
  id: string;
  town: string;
}

/** Trainingsszenario zusammenstellen und als Mod speichern (#56). */
export function ScenarioEditor() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const openDialog = useSim((s) => s.openDialog);
  const notify = useSim((s) => s.notify);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startHour, setStartHour] = useState(8);
  const [weather, setWeather] = useState('');
  const [rate, setRate] = useState(0.5);
  const [quota, setQuota] = useState(90);
  const [calls, setCalls] = useState<DraftCall[]>([]);
  if (!world) return null;
  const options = {
    diagnosis: world.diagnoses.map((d) => ({ id: d.id, name: d.name })),
    fire: world.fireScenarios.map((s) => ({ id: s.id, name: s.name })),
    mci: world.mciScenarios.map((s) => ({ id: s.id, name: s.name })),
  };
  const update = (i: number, patch: Partial<DraftCall>) => {
    setCalls(calls.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  };
  const save = () => {
    const id = `${OWN_MOD}:${slug(name)}`;
    const scenario = {
      id,
      name: name.trim(),
      description: description.trim(),
      startHour,
      ...(weather ? { weather } : {}),
      callRateFactor: rate,
      durationHours: 2,
      calls: calls.map((c) => ({
        atMinutes: c.atMinutes,
        [c.kind]: c.id,
        ...(c.town ? { town: c.town } : {}),
      })),
      goals: { hilfsfristQuota: quota / 100 },
    };
    void window.ls112
      ?.saveModFile(OWN_MOD, `szenario-${slug(name)}`, { scenarios: [scenario] })
      .then((ok) => {
        notify(ok ? t('editor.saved') : t('editor.failed'));
        if (ok) openDialog({ kind: 'mods' });
      });
  };
  return (
    <Modal
      title={t('editor.scenarioTitle')}
      onClose={() => {
        openDialog(null);
      }}
      testId="scenario-editor"
      footer={
        <button
          type="button"
          className={`${css.btn ?? ''} ${css.primary ?? ''}`}
          disabled={!window.ls112 || name.trim().length === 0 || calls.length === 0}
          onClick={save}
          data-testid="save-scenario"
        >
          {t('editor.save')}
        </button>
      }
    >
      <div className={css.section}>
        <span className={css.label}>{t('editor.name')}</span>
        <input
          className={css.input}
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
          }}
          data-testid="scenario-name"
        />
        <span className={css.label}>{t('editor.description')}</span>
        <input
          className={css.input}
          value={description}
          maxLength={500}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
      </div>
      <div className={css.row}>
        <label>
          {t('editor.startHour')}{' '}
          <input
            type="number"
            min={0}
            max={23}
            value={startHour}
            onChange={(e) => {
              setStartHour(Math.max(0, Math.min(23, Number(e.target.value))));
            }}
          />
        </label>
        <label>
          {t('editor.weather')}{' '}
          <select
            value={weather}
            onChange={(e) => {
              setWeather(e.target.value);
            }}
          >
            <option value="">{t('editor.weatherRandom')}</option>
            {world.weather.map((w) => (
              <option key={w.id} value={w.id}>
                {w.symbol} {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('editor.rate')}{' '}
          <select
            value={rate}
            onChange={(e) => {
              setRate(Number(e.target.value));
            }}
          >
            {[0, 0.5, 1, 1.5].map((r) => (
              <option key={r} value={r}>
                {t('editor.rateValue', { percent: Math.round(r * 100) })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('editor.goal')}{' '}
          <input
            type="number"
            min={50}
            max={100}
            value={quota}
            onChange={(e) => {
              setQuota(Math.max(50, Math.min(100, Number(e.target.value))));
            }}
          />{' '}
          %
        </label>
      </div>
      <div className={css.section}>
        <span className={css.label}>{t('editor.calls')}</span>
        <table className={css.table}>
          <tbody>
            {calls.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={c.atMinutes}
                    style={{ width: 60 }}
                    onChange={(e) => {
                      update(i, { atMinutes: Math.max(0, Number(e.target.value)) });
                    }}
                  />{' '}
                  {t('editor.minutes')}
                </td>
                <td>
                  <select
                    value={c.kind}
                    onChange={(e) => {
                      const kind = e.target.value as DraftCall['kind'];
                      update(i, { kind, id: options[kind][0]?.id ?? '' });
                    }}
                  >
                    <option value="diagnosis">{t('editor.kind.diagnosis')}</option>
                    <option value="fire">{t('editor.kind.fire')}</option>
                    <option value="mci">{t('editor.kind.mci')}</option>
                  </select>
                </td>
                <td>
                  <select
                    value={c.id}
                    onChange={(e) => {
                      update(i, { id: e.target.value });
                    }}
                  >
                    {options[c.kind].map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={c.town}
                    onChange={(e) => {
                      update(i, { town: e.target.value });
                    }}
                  >
                    <option value="">{t('editor.anyTown')}</option>
                    {world.towns.map((town) => (
                      <option key={town.id} value={town.id}>
                        {town.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className={css.btn}
                    onClick={() => {
                      setCalls(calls.filter((_, k) => k !== i));
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className={css.btn}
          onClick={() => {
            const last = calls.at(-1)?.atMinutes ?? -5;
            setCalls([
              ...calls,
              {
                atMinutes: last + 5,
                kind: 'diagnosis',
                id: options.diagnosis[0]?.id ?? '',
                town: '',
              },
            ]);
          }}
          data-testid="add-call"
        >
          {t('editor.addCall')}
        </button>
      </div>
      <p className={css.hint}>{t('editor.scenarioHint')}</p>
    </Modal>
  );
}

/** Wachen verschieben und Fahrzeuge ergänzen (#55, Regionen-Editor für die Vorhaltung). */
export function StationEditor() {
  const { t } = useTranslation();
  const world = useSim((s) => s.world);
  const openDialog = useSim((s) => s.openDialog);
  const setMapPick = useSim((s) => s.setMapPick);
  const notify = useSim((s) => s.notify);
  const [stationId, setStationId] = useState('');
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  if (!world) return null;
  const L = lookup(world);
  const stations = world.stations;
  const station = stations.find((s) => s.id === (stationId || stations[0]?.id));
  if (!station) return null;
  const pos = position ?? station.position;
  const types = world.vehicleTypes.filter((v) => !v.air);
  const save = () => {
    const vehicles = [
      ...station.vehicles.map((v) => ({
        id: v.id,
        callsign: v.callsign,
        type: v.type,
        ...(v.service ? { service: v.service } : {}),
      })),
      ...added.map((type, i) => {
        const short = world.vehicleTypes.find((x) => x.id === type)?.short ?? 'FZ';
        return {
          id: `${OWN_MOD}:${slug(station.id)}-${slug(short)}-${(i + 1).toString()}`,
          callsign: `${station.name.split(' ').at(-1) ?? 'Wache'} ${short} ${(90 + i).toString()}`,
          type,
        };
      }),
    ];
    const replaced = {
      id: station.id,
      name: station.name,
      kind: station.kind,
      position: [Math.round(pos[0]), Math.round(pos[1])],
      ...(station.turnout ? { turnout: station.turnout } : {}),
      reserve: station.reserve,
      vehicles,
    };
    void window.ls112
      ?.saveModFile(OWN_MOD, `wache-${slug(station.id)}`, { stations: [replaced] })
      .then((ok) => {
        notify(ok ? t('editor.saved') : t('editor.failed'));
        if (ok) openDialog({ kind: 'mods' });
      });
  };
  return (
    <Modal
      title={t('editor.stationTitle')}
      onClose={() => {
        setMapPick(null);
        openDialog(null);
      }}
      testId="station-editor"
      footer={
        <button
          type="button"
          className={`${css.btn ?? ''} ${css.primary ?? ''}`}
          disabled={!window.ls112}
          onClick={save}
          data-testid="save-station"
        >
          {t('editor.save')}
        </button>
      }
    >
      <div className={css.row}>
        <select
          value={station.id}
          onChange={(e) => {
            setStationId(e.target.value);
            setPosition(null);
            setAdded([]);
          }}
          data-testid="station-select"
        >
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className={css.section}>
        <span className={css.label}>{t('editor.position')}</span>
        <div>
          {Math.round(pos[0])} / {Math.round(pos[1])} m{' '}
          <button
            type="button"
            className={`${css.btn ?? ''} ${picking ? (css.primary ?? '') : ''}`}
            onClick={() => {
              setPicking(true);
              setMapPick((x, y) => {
                setPosition([x, y]);
                setPicking(false);
                setMapPick(null);
              });
            }}
          >
            {picking ? t('editor.pickNow') : t('editor.pick')}
          </button>
        </div>
      </div>
      <div className={css.section}>
        <span className={css.label}>{t('editor.vehicles')}</span>
        <div>
          {station.vehicles
            .map((v) => `${L.vehicle(v.id)?.type ?? ''} ${L.vehicle(v.id)?.short ?? ''}`)
            .join(' · ')}
        </div>
        {added.map((type, i) => (
          <div key={i} className={css.ok}>
            + {world.vehicleTypes.find((x) => x.id === type)?.name}{' '}
            <button
              type="button"
              className={css.btn}
              onClick={() => {
                setAdded(added.filter((_, k) => k !== i));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div className={css.row}>
          {types.map((type) => (
            <button
              key={type.id}
              type="button"
              className={css.btn}
              onClick={() => {
                setAdded([...added, type.id]);
              }}
            >
              + {type.short}
            </button>
          ))}
        </div>
      </div>
      <p className={css.hint}>{t('editor.stationHint')}</p>
    </Modal>
  );
}
