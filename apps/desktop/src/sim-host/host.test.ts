import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContentFromDirs } from '@ls112/content/node';
import { simTimeFrom } from '@ls112/sim';
import type { HostMessage } from '@ls112/protocol';
import { SimHost, type ClientPort } from './host';
import { AUTOSAVE_KEEP, SqliteSaveStore } from './saves';

const content = loadContentFromDirs(
  join(import.meta.dirname, '..', '..', '..', '..', 'content', 'base'),
);

class FakePort implements ClientPort {
  readonly received: HostMessage[] = [];
  private messageListener: ((data: unknown) => void) | undefined;
  private closeListener: (() => void) | undefined;
  postMessage(message: HostMessage): void {
    this.received.push(message);
  }
  onMessage(listener: (data: unknown) => void): void {
    this.messageListener = listener;
  }
  onClose(listener: () => void): void {
    this.closeListener = listener;
  }
  send(data: unknown): void {
    this.messageListener?.(data);
  }
  close(): void {
    this.closeListener?.();
  }
  last<T extends HostMessage['type']>(type: T): Extract<HostMessage, { type: T }> | undefined {
    return this.received.filter((m) => m.type === type).at(-1) as
      Extract<HostMessage, { type: T }> | undefined;
  }
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function makeHost(store?: SqliteSaveStore): SimHost {
  let seed = 100;
  const host = new SimHost({
    content,
    log: silent,
    ...(store ? { store } : {}),
    newSeed: () => seed++,
    startTime: () => simTimeFrom(2026, 11, 24, 7),
    callRateFactor: 20,
  });
  host.clock.setPaused(false);
  return host;
}

describe('SimHost', () => {
  it('begrüßt neue Fenster mit Protokoll, Welt und Zustand', () => {
    const host = makeHost();
    const port = new FakePort();
    host.addClient(port);
    expect(port.received.map((m) => m.type)).toEqual(['welcome', 'world', 'state']);
    const world = port.last('world')?.world;
    expect(world?.addresses.length).toBeGreaterThan(1000);
    expect(world?.map.roads.features.length).toBeGreaterThan(1000);
  });

  it('läuft im Takt, setzt Pause und Zeitraffer', () => {
    const host = makeHost();
    const port = new FakePort();
    host.addClient(port);
    port.send({ type: 'clock/setSpeed', speed: 10 });
    host.update(1000);
    expect(host.sim.tick).toBe(10);
    port.send({ type: 'clock/togglePause' });
    port.send({ type: 'clock/togglePause' });
    port.send({ type: 'clock/togglePause' });
    host.update(5000);
    expect(host.sim.tick).toBe(10);
    expect(port.last('state')?.state.paused).toBe(true);
  });

  it('wendet Befehle auch in der Pause sofort an und beantwortet Vorschlagsanfragen', () => {
    const host = makeHost();
    const port = new FakePort();
    host.addClient(port);
    port.send({ type: 'clock/setSpeed', speed: 10 });
    while (host.sim.raw.calls.length === 0) host.update(1000);
    port.send({ type: 'clock/setPaused', paused: true });
    const call = host.sim.raw.calls[0]!;
    port.send({ type: 'sim/command', command: { type: 'call/accept', callId: call.id } });
    port.send({
      type: 'sim/command',
      command: {
        type: 'incident/create',
        callId: call.id,
        addressId: call.truth.addressId,
        keywordId: 'base:rd2',
      },
    });
    const incident = host.sim.raw.incidents[0]!;
    port.send({
      type: 'query',
      id: 7,
      query: { type: 'suggestVehicles', incidentId: incident.id },
    });
    const reply = port.last('reply');
    expect(reply?.id).toBe(7);
    expect(reply?.result.type).toBe('suggestVehicles');
    const recommended =
      reply?.result.type === 'suggestVehicles'
        ? reply.result.items.filter((i) => i.recommended)
        : [];
    expect(recommended.length).toBe(2);
    const events = port.received.flatMap((m) => (m.type === 'events' ? m.events : []));
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['call/accepted', 'incident/created']),
    );
  });

  it('speichert automatisch, rolliert Autosaves und lädt Spielstände', () => {
    const store = new SqliteSaveStore(':memory:');
    const host = makeHost(store);
    const port = new FakePort();
    host.addClient(port);
    port.send({ type: 'clock/setSpeed', speed: 10 });
    for (let i = 0; i < 25 * 60; i++) host.update(100); // 25 Spielminuten
    const autos = store.list().filter((s) => s.kind === 'auto');
    expect(autos.length).toBe(AUTOSAVE_KEEP);
    port.send({ type: 'save/write', name: 'Mein Stand' });
    const manual = store.list().find((s) => s.kind === 'manual');
    expect(manual?.name).toBe('Mein Stand');
    const hashAtSave = host.sim.hash();
    host.update(10_000);
    expect(host.sim.hash()).not.toBe(hashAtSave);
    port.send({ type: 'save/load', id: manual?.id });
    expect(host.sim.hash()).toBe(hashAtSave);
    port.send({ type: 'query', id: 1, query: { type: 'saves' } });
    const saves = port.last('reply')?.result;
    expect(saves?.type === 'saves' && saves.items.length).toBe(AUTOSAVE_KEEP + 1);
  });

  it('startet neue Spiele (frei und Tutorial) mit neuem Seed', () => {
    const host = makeHost();
    const seed = host.sim.config.seed;
    host.newGame('tutorial');
    expect(host.mode).toBe('tutorial');
    expect(host.sim.config.tutorial).toBe(true);
    expect(host.sim.config.seed).not.toBe(seed);
  });

  it('weist ungültige Nachrichten zurück und vergisst geschlossene Fenster', () => {
    const host = makeHost();
    const port = new FakePort();
    host.addClient(port);
    port.send({ type: 'sim/command', command: { type: 'reboot' } });
    expect(port.last('error')?.code).toBe('badMessage');
    port.send({ type: 'save/load', id: 99 });
    expect(port.last('error')?.code).toBe('loadFailed');
    port.close();
    expect(host.clientCount).toBe(0);
  });
});
