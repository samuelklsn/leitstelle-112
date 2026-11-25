import { describe, expect, it } from 'vitest';
import { loadWithModLayers } from '@ls112/content';
import { AUTOSAVE_KEEP, SimHost, type ClientPort } from '@ls112/host';
import { simTimeFrom } from '@ls112/sim';
import { CachedSaveStore, type SavePersistence, type SaveRecord } from './cached-save-store';
import { BASE_LAYER, modLayers } from './content';

const content = loadWithModLayers(BASE_LAYER, []).bundle;
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** IndexedDB-Ersatz: merkt sich, was dauerhaft gespeichert wäre. */
class FakePersistence implements SavePersistence {
  readonly stored = new Map<number, SaveRecord>();
  put(record: SaveRecord): Promise<void> {
    this.stored.set(record.info.id, record);
    return Promise.resolve();
  }
  delete(id: number): Promise<void> {
    this.stored.delete(id);
    return Promise.resolve();
  }
}

function makeHost(store: CachedSaveStore): SimHost {
  return new SimHost({
    content,
    log: silent,
    store,
    newSeed: () => 42,
    startTime: () => simTimeFrom(2026, 11, 25, 7),
  });
}

const nullPort: ClientPort = {
  postMessage: () => undefined,
  onMessage: () => undefined,
  onClose: () => undefined,
};

describe('Basisinhalte im Android-Bündel', () => {
  it('enthält alle YAML-Dateien aus content/base und ist gültig', () => {
    expect(BASE_LAYER.files.length).toBeGreaterThanOrEqual(10);
    expect(BASE_LAYER.files.every((f) => !f.path.includes('/'))).toBe(true);
    expect(content.region.name.length).toBeGreaterThan(0);
  });

  it('bündelt Mod-Dateien je Mod in einer Schicht, nach Ordner sortiert', () => {
    const layers = modLayers([
      { modId: 'zz-zweiter', fileName: 'mod', text: '{}' },
      { modId: 'eigene', fileName: 'wache-a', text: '{}' },
      { modId: 'eigene', fileName: 'mod', text: '{}' },
    ]);
    expect(layers.map((l) => l.id)).toEqual(['eigene', 'zz-zweiter']);
    expect(layers[0]?.files.map((f) => f.path)).toEqual(['mod.json', 'wache-a.json']);
  });

  it('überspringt einen kaputten Mod und meldet ihn', () => {
    const result = loadWithModLayers(
      BASE_LAYER,
      modLayers([{ modId: 'kaputt', fileName: 'x', text: '{ "unbekannt": 1 }' }]),
    );
    expect(result.mods).toHaveLength(1);
    expect(result.mods[0]?.ok).toBe(false);
  });
});

describe('CachedSaveStore', () => {
  it('speichert, listet und lädt einen Spielstand verlustfrei', async () => {
    const persistence = new FakePersistence();
    const store = new CachedSaveStore(persistence);
    const host = makeHost(store);
    host.addClient(nullPort);
    host.newGame('free');
    host.update(5000);
    const before = host.sim.snapshot();
    expect(host.save('manual', 'Test')).toBe(true);
    await store.flush();

    expect(store.list().map((s) => s.name)).toEqual(['Test']);
    expect(persistence.stored.size).toBe(1);

    // Neu starten wie nach einem Kaltstart der App: Cache aus der Ablage aufbauen.
    const reopened = new CachedSaveStore(persistence, [...persistence.stored.values()]);
    const host2 = makeHost(reopened);
    const id = reopened.list()[0]?.id;
    expect(id).toBeDefined();
    expect(host2.loadGame(id ?? -1)).toBe(true);
    expect(host2.sim.snapshot()).toEqual(before);
  });

  it(`behält höchstens ${AUTOSAVE_KEEP.toString()} automatische Stände, manuelle bleiben`, async () => {
    const persistence = new FakePersistence();
    const store = new CachedSaveStore(persistence);
    const host = makeHost(store);
    host.save('manual', 'Bleibt');
    for (let i = 0; i < AUTOSAVE_KEEP + 2; i++) host.save('auto', `Auto ${i.toString()}`);
    await store.flush();
    const autos = store.list().filter((s) => s.kind === 'auto');
    expect(autos).toHaveLength(AUTOSAVE_KEEP);
    expect(autos[0]?.name).toBe(`Auto ${(AUTOSAVE_KEEP + 1).toString()}`);
    expect(store.list().some((s) => s.name === 'Bleibt')).toBe(true);
    expect(persistence.stored.size).toBe(AUTOSAVE_KEEP + 1);
    expect(store.latestAuto()).toBe(autos[0]?.id);
  });

  it('vergibt nach einem Neustart fortlaufende IDs', async () => {
    const persistence = new FakePersistence();
    const first = new CachedSaveStore(persistence);
    makeHost(first).save('manual', 'A');
    await first.flush();
    const second = new CachedSaveStore(persistence, [...persistence.stored.values()]);
    makeHost(second).save('manual', 'B');
    const ids = second.list().map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBeGreaterThan(ids[1] ?? Infinity);
  });

  it('meldet Schreibfehler, ohne den Host anzuhalten', async () => {
    const errors: unknown[] = [];
    const failing: SavePersistence = {
      put: () => Promise.reject(new Error('Speicher voll')),
      delete: () => Promise.resolve(),
    };
    const store = new CachedSaveStore(failing, [], (e) => errors.push(e));
    expect(makeHost(store).save('manual', 'X')).toBe(true);
    await store.flush();
    expect(errors).toHaveLength(1);
  });
});

describe('SimHost.suspend (App im Hintergrund)', () => {
  it('sichert automatisch und hält die Zeit an', () => {
    const store = new CachedSaveStore(new FakePersistence());
    const host = makeHost(store);
    host.newGame('free');
    expect(host.clock.paused).toBe(false);
    expect(host.suspend('App im Hintergrund')).toBe(true);
    expect(host.clock.paused).toBe(true);
    expect(store.list()[0]).toMatchObject({ kind: 'auto', name: 'App im Hintergrund' });
  });
});
