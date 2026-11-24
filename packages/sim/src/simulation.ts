import type { ContentBundle } from '@ls112/content';
import { DEFAULT_TRAVEL_MODEL, Router } from '@ls112/routing';
import { indexContent, type ContentIndex, type Ctx } from './context';
import { EventQueue } from './event-queue';
import { hashValue } from './hash';
import { Rng } from './rng';
import { MS_PER_HOUR, TICK_MS, toCalendar } from './time';
import {
  RNG_STREAMS,
  SNAPSHOT_VERSION,
  type LoggedCommand,
  type RejectReason,
  type RngStreamName,
  type ScheduledPayload,
  type ShiftStats,
  type SimCommand,
  type SimConfig,
  type SimEvent,
  type SimSnapshot,
  type SimState,
  type VehicleState,
} from './types';
import { abandonCall, acceptCall, closeCall, generateCalls } from './systems/calls';
import {
  assignDestination,
  createIncident,
  dispatch,
  findVehicle,
  onArrive,
  onAssessed,
  onCallbackDone,
  onDestinationTimeout,
  onHandoverDone,
  onSceneDone,
  onTurnoutDone,
  releaseCommand,
  suggestHospitals,
  suggestVehicles,
  type HospitalSuggestion,
  type VehicleSuggestion,
} from './systems/operations';
import { generateWorld } from './world/generator';
import type { World } from './world/types';

export function defaultConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 112, startTime: 0, callRateFactor: 1, tutorial: false, ...overrides };
}

function validateConfig(config: SimConfig): void {
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
    throw new RangeError('seed muss eine ganze Zahl zwischen 0 und 2^32-1 sein');
  }
  if (!Number.isInteger(config.startTime))
    throw new RangeError('startTime muss ganzzahlig sein (ms)');
  if (!(config.callRateFactor >= 0)) throw new RangeError('callRateFactor darf nicht negativ sein');
}

/** Welt nur einmal je Regionskonfiguration erzeugen (deterministisch, also cachebar). */
const worldCache = new WeakMap<object, World>();
function worldFor(content: ContentBundle): World {
  let world = worldCache.get(content.region);
  if (!world) {
    world = generateWorld(content.region);
    worldCache.set(content.region, world);
  }
  return world;
}

export function contentHash(content: ContentBundle): string {
  return hashValue(content);
}

function newShift(index: number, startedAt: number): ShiftStats {
  return {
    index,
    startedAt,
    callsReceived: 0,
    callsAccepted: 0,
    callsAbandoned: 0,
    totalAnswerMs: 0,
    incidents: 0,
    hilfsfristMeasured: 0,
    hilfsfristMet: 0,
    totalResponseMs: 0,
    outcomes: { gut: 0, beeintraechtigt: 0, verstorben: 0, keinPatient: 0 },
    errors: {},
    score: 0,
  };
}

/**
 * Der Simulationskern. Rein deterministisch: Der Verlauf hängt nur von Konfiguration,
 * Inhalten, Seed und der Folge der Befehle (mit Tick-Nummer) ab.
 *
 * Befehle werden zur *aktuellen* Spielzeit angewendet – über {@link Simulation.flush} sofort
 * (auch in der Pause) oder spätestens zu Beginn des nächsten {@link Simulation.step}.
 *
 * Ablauf eines Ticks: vorgemerkte Befehle → Zeit + {@link TICK_MS} → fällige Ereignisse
 * (Zeitpunkt, dann Sequenznummer) → Systeme (Notrufgenerator).
 */
export class Simulation {
  readonly world: World;
  readonly content: ContentIndex;
  readonly router: Router;
  readonly contentHash: string;
  private state: SimState;
  private readonly queue: EventQueue<ScheduledPayload>;
  private readonly rng: Record<RngStreamName, Rng>;
  private pending: SimCommand[];
  private readonly log: LoggedCommand[] = [];
  private events: SimEvent[] = [];
  private readonly ctx: Ctx;

  private constructor(
    readonly config: SimConfig,
    bundle: ContentBundle,
    state: SimState,
    queue: EventQueue<ScheduledPayload>,
    rng: Record<RngStreamName, Rng>,
    pending: SimCommand[],
    hash: string,
  ) {
    this.world = worldFor(bundle);
    this.content = indexContent(bundle, this.world);
    this.router = new Router(this.world.graph, DEFAULT_TRAVEL_MODEL);
    this.contentHash = hash;
    this.state = state;
    this.queue = queue;
    this.rng = rng;
    this.pending = pending;
    // Der Zustand wird bei Wiederherstellung ersetzt – deshalb Zugriff über eine Funktion.
    const currentState = () => this.state;
    this.ctx = {
      config,
      content: this.content,
      world: this.world,
      router: this.router,
      get state() {
        return currentState();
      },
      rng: this.rng,
      schedule: (at, payload) => {
        this.queue.schedule(at, payload);
      },
      emit: (event) => {
        this.events.push(event);
      },
      newId: (prefix) => {
        const id = `${prefix}${this.state.nextId.toString().padStart(6, '0')}`;
        this.state.nextId++;
        return id;
      },
    };
  }

  static create(config: SimConfig, content: ContentBundle): Simulation {
    validateConfig(config);
    const rng = {} as Record<RngStreamName, Rng>;
    for (const name of RNG_STREAMS) rng[name] = Rng.stream(config.seed, name);
    const state: SimState = {
      time: config.startTime,
      tick: 0,
      nextId: 1,
      calls: [],
      incidents: [],
      vehicles: [],
      shift: newShift(1, config.startTime),
      shiftHistory: [],
    };
    const sim = new Simulation(
      config,
      content,
      state,
      new EventQueue(),
      rng,
      [],
      contentHash(content),
    );
    sim.state.vehicles = sim.initialVehicles();
    sim.queue.schedule(sim.nextShiftEnd(config.startTime), { kind: 'shift/end' });
    return sim;
  }

  static restore(snapshot: SimSnapshot, content: ContentBundle): Simulation {
    // Snapshots kommen aus Dateien; der Typ garantiert die Version zur Laufzeit nicht.
    if ((snapshot.version as number) !== SNAPSHOT_VERSION) {
      throw new RangeError(`Snapshot-Version ${String(snapshot.version)} wird nicht unterstützt`);
    }
    const hash = contentHash(content);
    if (snapshot.contentHash !== hash) {
      throw new RangeError('Spielstand passt nicht zu den installierten Inhalten');
    }
    validateConfig(snapshot.config);
    const rng = {} as Record<RngStreamName, Rng>;
    for (const name of RNG_STREAMS) rng[name] = Rng.fromState(snapshot.rng[name]);
    return new Simulation(
      snapshot.config,
      content,
      cloneJson(snapshot.state),
      EventQueue.fromJSON(cloneJson(snapshot.queue)),
      rng,
      [...snapshot.pending],
      hash,
    );
  }

  get time(): number {
    return this.state.time;
  }

  get tick(): number {
    return this.state.tick;
  }

  /** Schreibgeschützter Blick auf den vollständigen Zustand (inkl. verborgener Wahrheit). */
  get raw(): Readonly<SimState> {
    return this.state;
  }

  submit(command: SimCommand): void {
    this.pending.push(command);
  }

  commandLog(): readonly LoggedCommand[] {
    return this.log;
  }

  /** Wendet vorgemerkte Befehle sofort zur aktuellen Spielzeit an, ohne Zeit zu verbrauchen. */
  flush(): SimEvent[] {
    this.applyPending();
    return this.takeEvents();
  }

  step(): SimEvent[] {
    this.applyPending();
    this.state.tick++;
    this.state.time += TICK_MS;
    for (
      let due = this.queue.popDue(this.state.time);
      due;
      due = this.queue.popDue(this.state.time)
    ) {
      this.handleScheduled(due.payload);
    }
    generateCalls(this.ctx);
    return this.takeEvents();
  }

  run(count: number): SimEvent[] {
    const all: SimEvent[] = [];
    for (let i = 0; i < count; i++) all.push(...this.step());
    return all;
  }

  snapshot(): SimSnapshot {
    const rng = {} as Record<RngStreamName, ReturnType<Rng['state']>>;
    for (const name of RNG_STREAMS) rng[name] = this.rng[name].state();
    return cloneJson({
      version: SNAPSHOT_VERSION,
      config: this.config,
      contentHash: this.contentHash,
      state: this.state,
      rng,
      queue: this.queue.toJSON(),
      pending: this.pending,
    });
  }

  hash(): string {
    const snap = this.snapshot();
    return hashValue({ ...snap, contentHash: '' });
  }

  suggestVehicles(incidentId: string): VehicleSuggestion[] {
    return suggestVehicles(this.ctx, incidentId);
  }

  suggestHospitals(vehicleId: string): HospitalSuggestion[] {
    return suggestHospitals(this.ctx, vehicleId);
  }

  private takeEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private applyPending(): void {
    const commands = this.pending;
    this.pending = [];
    for (const command of commands) {
      this.log.push({ tick: this.state.tick, command });
      const reason = this.apply(command);
      if (reason) {
        this.events.push({
          type: 'command/rejected',
          at: this.state.time,
          command: command.type,
          reason,
        });
      }
    }
  }

  private apply(command: SimCommand): RejectReason | undefined {
    const ctx = this.ctx;
    switch (command.type) {
      case 'call/accept':
        return acceptCall(ctx, command.callId);
      case 'call/close':
        return closeCall(ctx, command.callId);
      case 'incident/create':
        return createIncident(ctx, command.callId, command.addressId, command.keywordId);
      case 'incident/dispatch':
        return dispatch(ctx, command.incidentId, command.vehicleIds);
      case 'vehicle/assignDestination':
        return assignDestination(ctx, command.vehicleId, command.hospitalId);
      case 'vehicle/release':
        return releaseCommand(ctx, command.vehicleId);
    }
  }

  private handleScheduled(p: ScheduledPayload): void {
    const ctx = this.ctx;
    if (p.kind === 'call/abandon') {
      abandonCall(ctx, p.callId);
      return;
    }
    if (p.kind === 'incident/callbackDone') {
      onCallbackDone(ctx, p.incidentId);
      return;
    }
    if (p.kind === 'shift/end') {
      this.endShift();
      return;
    }
    const v = findVehicle(ctx, p.vehicleId);
    // Veraltete Ereignisse einer abgebrochenen Aufgabe ignorieren.
    if (v?.taskSeq !== p.seq) return;
    switch (p.kind) {
      case 'vehicle/turnoutDone':
        onTurnoutDone(ctx, v);
        return;
      case 'vehicle/arrive':
        onArrive(ctx, v);
        return;
      case 'vehicle/assessed':
        onAssessed(ctx, v);
        return;
      case 'vehicle/sceneDone':
        onSceneDone(ctx, v);
        return;
      case 'vehicle/destTimeout':
        onDestinationTimeout(ctx, v);
        return;
      case 'vehicle/handoverDone':
        onHandoverDone(ctx, v);
        return;
    }
  }

  private initialVehicles(): VehicleState[] {
    return this.content.bundle.stations.flatMap((station) => {
      const home = this.content.stationNode.get(station.id) ?? 0;
      return station.vehicles.map((v): VehicleState => ({
        id: v.id,
        typeId: v.type,
        stationId: station.id,
        homeNode: home,
        status: 2,
        task: 'idle',
        taskSeq: 0,
        incidentId: null,
        node: home,
        route: null,
        hospitalId: null,
        busyMs: 0,
      }));
    });
  }

  /** Nächster Schichtwechsel nach `time` laut Einstellungen. */
  private nextShiftEnd(time: number): number {
    const { startHour, hours } = this.content.bundle.settings.shift;
    const cal = toCalendar(time);
    const dayStart = time - (cal.hour * 3600 + cal.minute * 60 + cal.second) * 1000;
    let t = dayStart + startHour * MS_PER_HOUR;
    while (t <= time) t += hours * MS_PER_HOUR;
    return t;
  }

  private endShift(): void {
    const shift = this.state.shift;
    shift.endedAt = this.state.time;
    // Auslastung der Schicht festhalten, dann Zähler für die neue Schicht zurücksetzen.
    const busy: Record<string, number> = {};
    for (const v of this.state.vehicles) {
      if (v.busySince !== undefined) {
        v.busyMs += this.state.time - v.busySince;
        v.busySince = this.state.time;
      }
      busy[v.id] = v.busyMs;
      v.busyMs = 0;
    }
    shift.vehicleBusyMs = busy;
    this.state.shiftHistory = [...this.state.shiftHistory, shift].slice(-30);
    this.state.shift = newShift(shift.index + 1, this.state.time);
    this.events.push({ type: 'shift/ended', at: this.state.time, index: shift.index });
    this.queue.schedule(this.nextShiftEnd(this.state.time), { kind: 'shift/end' });
  }
}

/** Tiefe Kopie über JSON – der Zustand enthält per Definition nur JSON-Werte. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Spielt ein Befehlsprotokoll von Beginn an nach (Replays, Bugreports). */
export function replay(
  config: SimConfig,
  content: ContentBundle,
  log: readonly LoggedCommand[],
  ticks: number,
): Simulation {
  const sim = Simulation.create(config, content);
  let i = 0;
  for (let t = 0; t <= ticks; t++) {
    while (i < log.length && (log[i] as LoggedCommand).tick === t) {
      sim.submit((log[i] as LoggedCommand).command);
      i++;
    }
    sim.flush();
    if (t < ticks) sim.step();
  }
  return sim;
}
