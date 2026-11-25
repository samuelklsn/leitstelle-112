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
  type ModStatusView,
  type StartPreset,
  type HostMessage,
  type HostState,
  type Query,
  type QueryResult,
} from '@ls112/protocol';
import { SimClock } from './clock';
import type { SaveStore } from './save-store';

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
  /** Tages-Herausforderung: Seed und Datum aus dem heutigen Tag – überall gleich, offline. */
  readonly dailySeed?: () => { seed: number; date: string };
  /** Spielbeginn für ein neues Spiel (Schichtbeginn heute). */
  readonly startTime: (preset?: StartPreset) => number;
  readonly callRateFactor?: number;
  /** Status der Mods beim Start (ADR-0019). */
  readonly mods?: readonly ModStatusView[];
  /** Inhalte samt Mods neu laden (nach dem Speichern im Editor). */
  readonly reloadContent?: () => { content: ContentBundle; mods: readonly ModStatusView[] };
  /** Startzeit eines Trainingsszenarios: Stunde und optional Monat (ADR-0019). */
  readonly scenarioStart?: (hour: number, month?: number) => number;
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
  private world: WorldInfo;
  /** Tages-Herausforderung: Datum, aus dem der Seed stammt (ADR-0018). */
  challenge: string | undefined;
  private sinceBroadcastMs = Number.POSITIVE_INFINITY;
  private dirty = true;
  private lastAutosaveAt: number;

  /** Aktuelle Inhalte; nach einem Neuladen gelten sie für neue Spiele. */
  private content: ContentBundle;
  private mods: readonly ModStatusView[];

  constructor(private readonly options: HostOptions) {
    this.content = options.content;
    this.mods = options.mods ?? [];
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
    port.postMessage({ type: 'mods', mods: this.mods });
    port.postMessage(this.catalog());
    port.postMessage({ type: 'state', state: this.state() });
  }

  private catalog(): HostMessage {
    return {
      type: 'catalog',
      scenarios: this.content.scenarios,
      hilfsfristPresets: this.content.hilfsfristPresets,
    };
  }

  /** Inhalte samt Mods neu laden; das laufende Spiel bleibt unverändert. */
  reloadContent(): void {
    if (!this.options.reloadContent) return;
    try {
      const next = this.options.reloadContent();
      this.replaceContent(next.content, next.mods);
    } catch (error) {
      this.options.log.error({ err: error }, 'Inhalte konnten nicht neu geladen werden');
    }
  }

  /**
   * Neue Inhalte übernehmen (gelten für neue Spiele). Für Plattformen, die Inhalte asynchron
   * laden – Android liest Mods aus IndexedDB (ADR-0021).
   */
  replaceContent(content: ContentBundle, mods: readonly ModStatusView[]): void {
    this.content = content;
    this.mods = mods;
    this.broadcast({ type: 'mods', mods: this.mods });
    this.broadcast(this.catalog());
    this.options.log.info({ mods: this.mods.length }, 'Inhalte neu geladen');
  }

  newGame(
    mode: GameMode,
    start?: StartPreset,
    extra: { scenario?: string; hilfsfrist?: string } = {},
  ): void {
    this.sim = this.createSim(mode, start, extra);
    this.challenge =
      mode === 'free' && start === 'daily' ? this.options.dailySeed?.().date : undefined;
    this.refreshWorld();
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
      this.sim = Simulation.restore(stored.snapshot, this.content);
    } catch (error) {
      this.options.log.error({ err: error, id }, 'Spielstand nicht ladbar');
      return false;
    }
    this.mode = stored.mode;
    this.challenge = undefined;
    this.refreshWorld();
    this.gameId++;
    this.lastAutosaveAt = this.sim.time;
    this.clock.setPaused(true);
    this.options.log.info({ id, name: stored.info.name }, 'Spielstand geladen');
    this.markDirty();
    return true;
  }

  /**
   * App geht in den Hintergrund oder wird beendet: Stand sichern und anhalten. Auf Android kann
   * das System eine Hintergrund-App jederzeit beenden (ADR-0021).
   */
  suspend(name: string): boolean {
    const saved = this.save('auto', name);
    this.clock.setPaused(true);
    this.markDirty();
    return saved;
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
        region: this.content.region.name,
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

  /** Weltdaten neu senden – z. B. nachdem die Bedarfsplanung ein Fahrzeug bewilligt hat. */
  private refreshWorld(): void {
    this.world = buildWorldInfo(this.sim);
    this.broadcast({ type: 'world', world: this.world });
  }

  state(): HostState {
    return {
      view: buildView(this.sim),
      paused: this.clock.paused,
      speed: this.clock.speed,
      mode: this.mode,
      gameId: this.gameId,
      ...(this.challenge !== undefined ? { challenge: this.challenge } : {}),
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

  private createSim(
    mode: GameMode,
    start?: StartPreset,
    extra: { scenario?: string; hilfsfrist?: string } = {},
  ): Simulation {
    const scenario =
      mode === 'free' && extra.scenario !== undefined
        ? this.content.scenarios.find((s) => s.id === extra.scenario)
        : undefined;
    const preset =
      extra.hilfsfrist !== undefined &&
      this.content.hilfsfristPresets.some((p) => p.id === extra.hilfsfrist)
        ? extra.hilfsfrist
        : undefined;
    if (scenario) {
      return Simulation.create(
        defaultConfig({
          seed: this.options.newSeed() >>> 0,
          startTime:
            this.options.scenarioStart?.(scenario.startHour, scenario.month) ??
            this.options.startTime('today'),
          callRateFactor: (this.options.callRateFactor ?? 1) * scenario.callRateFactor,
          tutorial: false,
          scenarioId: scenario.id,
          ...(preset !== undefined ? { hilfsfristPreset: preset } : {}),
        }),
        this.content,
      );
    }
    return Simulation.create(
      defaultConfig({
        seed:
          (mode === 'free' && start === 'daily' && this.options.dailySeed
            ? this.options.dailySeed().seed
            : this.options.newSeed()) >>> 0,
        // Das Training beginnt immer heute; sonst nach Wahl im Startbildschirm.
        startTime: this.options.startTime(mode === 'tutorial' ? 'today' : start),
        callRateFactor: this.options.callRateFactor ?? 1,
        tutorial: mode === 'tutorial',
        // MANV-Übung: Der erste Notruf meldet eine Großlage (ADR-0017).
        ...(mode === 'free' && start === 'drill' ? { drill: true } : {}),
        ...(preset !== undefined ? { hilfsfristPreset: preset } : {}),
      }),
      this.content,
    );
  }

  private afterEvents(events: SimEvent[]): void {
    if (events.length === 0) return;
    this.broadcast({ type: 'events', events });
    for (const e of events) {
      if (e.type === 'planning/approved') this.refreshWorld();
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
        this.newGame(msg.mode, msg.start, {
          ...(msg.scenario !== undefined ? { scenario: msg.scenario } : {}),
          ...(msg.hilfsfrist !== undefined ? { hilfsfrist: msg.hilfsfrist } : {}),
        });
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
