import type { ContentBundle } from '@ls112/content';
import {
  MS_PER_MINUTE,
  Simulation,
  buildView,
  buildWorldInfo,
  defaultConfig,
  type SimEvent,
  type WorldInfo,
} from '@ls112/sim';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type GameMode,
  type HostMessage,
  type HostState,
  type Query,
  type QueryResult,
} from '@ls112/protocol';
import { SimClock } from './clock';
import type { SaveStore } from './saves';

/** Abstraktion eines Fensters – in Electron ein MessagePortMain, im Test ein Fake. */
export interface ClientPort {
  postMessage(message: HostMessage): void;
  onMessage(listener: (data: unknown) => void): void;
  onClose(listener: () => void): void;
}

export interface HostLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface HostOptions {
  readonly content: ContentBundle;
  readonly log: HostLogger;
  readonly store?: SaveStore;
  /** Neuer Seed je Spiel (Host darf echten Zufall nutzen, der Kern nicht). */
  readonly newSeed: () => number;
  /** Spielbeginn für ein neues Spiel (Schichtbeginn heute). */
  readonly startTime: () => number;
  readonly callRateFactor?: number;
}

/** Wie oft der Zustand höchstens an die Fenster geht (ADR-0005: bis 10 Hz). */
export const STATE_BROADCAST_INTERVAL_MS = 100;
/** Automatisch speichern alle … Spielminuten. */
export const AUTOSAVE_INTERVAL_MS = 5 * MS_PER_MINUTE;

/**
 * Verbindet Simulationskern, Zeitgeber, Spielstände und Fenster. Enthält selbst keine
 * Spiellogik – nur Takt, Nachrichtenvalidierung, Verwaltung und Verteilung.
 */
export class SimHost {
  sim: Simulation;
  /** Startet pausiert – der Spieler wählt zuerst auf dem Startbildschirm. */
  readonly clock = new SimClock({ paused: true });
  mode: GameMode = 'free';
  gameId = 1;
  private readonly clients = new Set<ClientPort>();
  private readonly world: WorldInfo;
  private sinceBroadcastMs = Number.POSITIVE_INFINITY;
  private dirty = true;
  private lastAutosaveAt: number;

  constructor(private readonly options: HostOptions) {
    this.sim = this.createSim('free');
    this.world = buildWorldInfo(this.sim);
    this.lastAutosaveAt = this.sim.time;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  addClient(port: ClientPort): void {
    this.clients.add(port);
    port.onClose(() => this.clients.delete(port));
    port.onMessage((data) => {
      this.handleMessage(port, data);
    });
    port.postMessage({ type: 'welcome', protocol: PROTOCOL_VERSION, seed: this.sim.config.seed });
    port.postMessage({ type: 'world', world: this.world });
    port.postMessage({ type: 'state', state: this.state() });
  }

  newGame(mode: GameMode): void {
    this.sim = this.createSim(mode);
    this.mode = mode;
    this.gameId++;
    this.lastAutosaveAt = this.sim.time;
    this.clock.setPaused(false);
    this.clock.setSpeed(1);
    this.options.log.info({ mode, seed: this.sim.config.seed }, 'Neues Spiel');
    this.markDirty();
  }

  /** Lädt einen Spielstand; bei Fehlern bleibt das laufende Spiel unverändert. */
  loadGame(id: number): boolean {
    const stored = this.options.store?.read(id);
    if (!stored) return false;
    try {
      this.sim = Simulation.restore(stored.snapshot, this.options.content);
    } catch (error) {
      this.options.log.error({ err: error, id }, 'Spielstand nicht ladbar');
      return false;
    }
    this.mode = stored.mode;
    this.gameId++;
    this.lastAutosaveAt = this.sim.time;
    this.clock.setPaused(true);
    this.options.log.info({ id, name: stored.info.name }, 'Spielstand geladen');
    this.markDirty();
    return true;
  }

  save(kind: 'auto' | 'manual', name: string): boolean {
    const store = this.options.store;
    if (!store) return false;
    try {
      store.write({
        kind,
        name,
        snapshot: this.sim.snapshot(),
        commands: this.sim.commandLog(),
        region: this.options.content.region.name,
        shiftIndex: this.sim.raw.shift.index,
        mode: this.mode,
      });
      this.broadcast({ type: 'saved', name, kind });
      return true;
    } catch (error) {
      this.options.log.error({ err: error, kind }, 'Speichern fehlgeschlagen');
      return false;
    }
  }

  /** Vom Echtzeit-Takt aufgerufen; führt fällige Ticks aus und verteilt Ergebnisse. */
  update(realElapsedMs: number): void {
    const ticks = this.clock.advance(realElapsedMs);
    if (ticks > 0) {
      const events: SimEvent[] = [];
      for (let i = 0; i < ticks; i++) events.push(...this.sim.step());
      this.afterEvents(events);
      this.dirty = true;
      if (this.sim.time - this.lastAutosaveAt >= AUTOSAVE_INTERVAL_MS) {
        this.lastAutosaveAt = this.sim.time;
        this.save('auto', 'Automatisch');
      }
    }
    this.sinceBroadcastMs += realElapsedMs;
    if (this.dirty && this.sinceBroadcastMs >= STATE_BROADCAST_INTERVAL_MS) {
      this.broadcast({ type: 'state', state: this.state() });
      this.sinceBroadcastMs = 0;
      this.dirty = false;
    }
  }

  state(): HostState {
    return {
      view: buildView(this.sim),
      paused: this.clock.paused,
      speed: this.clock.speed,
      mode: this.mode,
      gameId: this.gameId,
    };
  }

  answer(query: Query): QueryResult {
    switch (query.type) {
      case 'suggestVehicles':
        return { type: 'suggestVehicles', items: this.sim.suggestVehicles(query.incidentId) };
      case 'suggestHospitals':
        return { type: 'suggestHospitals', items: this.sim.suggestHospitals(query.vehicleId) };
      case 'saves':
        return { type: 'saves', items: this.options.store?.list() ?? [] };
    }
  }

  private createSim(mode: GameMode): Simulation {
    return Simulation.create(
      defaultConfig({
        seed: this.options.newSeed() >>> 0,
        startTime: this.options.startTime(),
        callRateFactor: this.options.callRateFactor ?? 1,
        tutorial: mode === 'tutorial',
      }),
      this.options.content,
    );
  }

  private afterEvents(events: SimEvent[]): void {
    if (events.length === 0) return;
    this.broadcast({ type: 'events', events });
    for (const e of events) {
      if (e.type === 'shift/ended') {
        const shift = this.sim.raw.shiftHistory.at(-1);
        if (shift) this.broadcast({ type: 'shiftEnded', shift });
        // Schichtende: automatisch sichern und anhalten, damit die Auswertung gelesen wird.
        this.save('auto', `Schichtende ${e.index.toString()}`);
        this.clock.setPaused(true);
      }
    }
  }

  private handleMessage(port: ClientPort, data: unknown): void {
    const msg = parseClientMessage(data);
    if (!msg) {
      this.options.log.warn({ data: summarize(data) }, 'Ungültige Nachricht verworfen');
      port.postMessage({ type: 'error', code: 'badMessage' });
      return;
    }
    switch (msg.type) {
      case 'hello':
        if (msg.protocol !== PROTOCOL_VERSION)
          port.postMessage({ type: 'error', code: 'protocolMismatch' });
        this.options.log.info({ view: msg.view }, 'Fenster verbunden');
        return;
      case 'clock/setPaused':
      case 'clock/togglePause': {
        const paused = msg.type === 'clock/setPaused' ? msg.paused : !this.clock.paused;
        this.clock.setPaused(paused);
        this.markDirty();
        return;
      }
      case 'clock/setSpeed':
        this.clock.setSpeed(msg.speed);
        this.markDirty();
        return;
      case 'sim/command': {
        // Sofort anwenden – auch in der Pause (Disponenten arbeiten bei stehender Zeit weiter).
        this.sim.submit(msg.command);
        this.afterEvents(this.sim.flush());
        this.markDirty();
        return;
      }
      case 'query':
        port.postMessage({ type: 'reply', id: msg.id, result: this.answer(msg.query) });
        return;
      case 'game/new':
        this.newGame(msg.mode);
        return;
      case 'save/write':
        if (!this.save('manual', msg.name)) port.postMessage({ type: 'error', code: 'saveFailed' });
        return;
      case 'save/load':
        if (!this.loadGame(msg.id)) port.postMessage({ type: 'error', code: 'loadFailed' });
        return;
    }
  }

  private markDirty(): void {
    this.dirty = true;
    this.sinceBroadcastMs = Number.POSITIVE_INFINITY;
  }

  private broadcast(message: HostMessage): void {
    for (const client of this.clients) client.postMessage(message);
  }
}

function summarize(data: unknown): string {
  try {
    return JSON.stringify(data).slice(0, 200);
  } catch {
    return typeof data;
  }
}
