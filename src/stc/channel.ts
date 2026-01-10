export type ChannelId = string;
export type Unsubscribe = () => void;

export type ChannelLevel = "error" | "warn" | "info" | "log" | "debug";
export type ChannelState = "open" | "closing" | "closed";

export type ChannelSystemEventType =
  | "channel.opened"
  | "channel.params"
  | "channel.progress"
  | "channel.closed";

export type ChannelCloseCode = number | string;

export interface ChannelDataEvent<T> {
  kind: "data";
  data: T;
  seq?: number;
  tsMs?: number;
}

export interface ChannelSystemEvent {
  kind: "system";
  type: ChannelSystemEventType;
  seq?: number;
  tsMs?: number;
  payload?: unknown;
}

export type ChannelEvent<T> = ChannelDataEvent<T> | ChannelSystemEvent;

export interface ChannelProgressPayload {
  status?: "queued" | "processing" | "done" | "failed" | "canceled";
  progress?: number;
  stageCode?: string;
  stageTitle?: string;
  subStageCode?: string;
  subStageTitle?: string;
  metrics?: {
    cpu?: number;
    memBytes?: number;
    ioBytes?: number;
    netBytes?: number;
    processes?: number;
  };
}

export interface ChannelParams {
  id: ChannelId;
  state: ChannelState;
  canRead: boolean;
  canWrite: boolean;
  encoding: "json" | "bson" | "binary";
  ttlMs?: number;
  bufferMs: number;
  caps: {
    maxSubscriptions: number;
    warnAtRatio: number;
  };
}

export interface ChannelCreateOptions {
  id?: ChannelId;
  canRead?: boolean;
  canWrite?: boolean;
  encoding?: "json" | "bson" | "binary";
  ttlMs?: number;
  bufferMs?: number;
  maxSubscriptions?: number;
  warnAtRatio?: number;
  signal?: AbortSignal;
}

export interface ChannelSubscribeOptions {
  includeSystem?: boolean;
  signal?: AbortSignal;
}

export interface IChannel<T> {
  getParams(): ChannelParams;
  subscribe(handler: (event: ChannelEvent<T>) => void, options?: ChannelSubscribeOptions): Unsubscribe;
  send(data: T): Promise<void>;
  progress(payload: ChannelProgressPayload): Promise<void>;
  close(info?: { code?: ChannelCloseCode; reason?: string }): Promise<void>;
}

function createId(): ChannelId {
  // Good enough for in-memory reference impl.
  return `ch_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function nowMs(): number {
  return Date.now();
}

export class InMemoryChannel<T> implements IChannel<T> {
  private params: ChannelParams;
  private readonly subs = new Set<{
    handler: (event: ChannelEvent<T>) => void;
    includeSystem: boolean;
  }>();

  private seq = 0;
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly buffered: Array<ChannelEvent<T>> = [];
  private ttlTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(options?: ChannelCreateOptions) {
    const maxSubscriptions = options?.maxSubscriptions ?? 10_000;
    const warnAtRatio = options?.warnAtRatio ?? 0.8;
    const bufferMs = options?.bufferMs ?? 100;

    this.params = {
      id: options?.id ?? createId(),
      state: "open",
      canRead: options?.canRead ?? true,
      canWrite: options?.canWrite ?? true,
      encoding: options?.encoding ?? "json",
      ttlMs: options?.ttlMs,
      bufferMs,
      caps: { maxSubscriptions, warnAtRatio }
    };

    this.emitSystem("channel.opened", { id: this.params.id });
    this.emitSystem("channel.params", { params: this.getParams() });

    if (this.params.ttlMs !== undefined) {
      this.ttlTimer = setTimeout(() => {
        void this.close({ code: "ttl", reason: "Channel TTL exceeded" });
      }, this.params.ttlMs);
    }

    if (options?.signal) {
      if (options.signal.aborted) {
        void this.close({ code: "aborted", reason: "Channel creation aborted" });
      } else {
        options.signal.addEventListener(
          "abort",
          () => void this.close({ code: "aborted", reason: "Channel aborted" }),
          { once: true }
        );
      }
    }
  }

  public getParams(): ChannelParams {
    return { ...this.params, caps: { ...this.params.caps } };
  }

  public subscribe(
    handler: (event: ChannelEvent<T>) => void,
    options?: ChannelSubscribeOptions
  ): Unsubscribe {
    if (this.params.state !== "open") {
      throw new Error(`Cannot subscribe to a ${this.params.state} channel`);
    }
    if (!this.params.canRead) {
      throw new Error("Channel is not readable (canRead=false)");
    }

    const includeSystem = options?.includeSystem ?? true;

    const max = this.params.caps.maxSubscriptions;
    const warnAt = this.params.caps.warnAtRatio;
    const nextCount = this.subs.size + 1;
    if (nextCount > max) {
      throw new Error(`Channel subscription cap exceeded (${nextCount}/${max})`);
    }
    if (nextCount >= Math.ceil(max * warnAt)) {
      // Dev-friendly warning; real diagnostics can hook here later.
      // eslint-disable-next-line no-console
      console.warn(
        `Channel subscription count high (${nextCount}/${max}) for ${this.params.id}`
      );
    }

    const sub = { handler, includeSystem };
    this.subs.add(sub);

    if (options?.signal) {
      if (options.signal.aborted) {
        this.subs.delete(sub);
        return () => {};
      }
      options.signal.addEventListener(
        "abort",
        () => {
          this.subs.delete(sub);
        },
        { once: true }
      );
    }

    return () => {
      this.subs.delete(sub);
    };
  }

  public async send(data: T): Promise<void> {
    if (this.params.state !== "open") return;
    if (!this.params.canWrite) {
      throw new Error("Channel is not writable (canWrite=false)");
    }
    this.enqueue({ kind: "data", data, tsMs: nowMs(), seq: this.nextSeq() });
  }

  public async progress(payload: ChannelProgressPayload): Promise<void> {
    if (this.params.state !== "open") return;
    this.enqueue({
      kind: "system",
      type: "channel.progress",
      tsMs: nowMs(),
      seq: this.nextSeq(),
      payload
    });
  }

  public async close(info?: { code?: ChannelCloseCode; reason?: string }): Promise<void> {
    if (this.params.state === "closed") return;
    if (this.params.state === "closing") return;
    this.params = { ...this.params, state: "closing" };
    this.emitSystem("channel.params", { params: this.getParams() });

    if (this.ttlTimer) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = null;
    }

    // Flush buffered events immediately, then close.
    this.flushNow();

    this.params = { ...this.params, state: "closed" };
    this.emitSystem("channel.closed", { info });
    this.emitSystem("channel.params", { params: this.getParams() });

    // Tier1 requirement: auto-cleanup all subscriptions on close.
    this.subs.clear();

    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
    this.buffered.length = 0;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private emitSystem(type: ChannelSystemEventType, payload?: unknown): void {
    const evt: ChannelSystemEvent = {
      kind: "system",
      type,
      tsMs: nowMs(),
      seq: this.nextSeq(),
      payload
    };
    this.dispatch(evt as ChannelEvent<T>);
  }

  private enqueue(evt: ChannelEvent<T>): void {
    if (this.params.bufferMs <= 0) {
      this.dispatch(evt);
      return;
    }

    this.buffered.push(evt);
    if (this.bufferTimer) return;

    this.bufferTimer = setTimeout(() => {
      this.bufferTimer = null;
      this.flushNow();
    }, this.params.bufferMs);
  }

  private flushNow(): void {
    if (this.buffered.length === 0) return;
    const batch = this.buffered.splice(0, this.buffered.length);
    for (const evt of batch) this.dispatch(evt);
  }

  private dispatch(evt: ChannelEvent<T>): void {
    for (const sub of this.subs) {
      if (evt.kind === "system" && !sub.includeSystem) continue;
      try {
        sub.handler(evt);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Channel subscriber threw", err);
      }
    }
  }
}

export class ChannelFactory {
  private readonly defaults: Pick<ChannelParams, "bufferMs" | "caps">;

  public constructor(options?: {
    bufferMs?: number;
    warnAtRatio?: number;
    maxSubscriptions?: number;
  }) {
    this.defaults = {
      bufferMs: options?.bufferMs ?? 100,
      caps: {
        warnAtRatio: options?.warnAtRatio ?? 0.8,
        maxSubscriptions: options?.maxSubscriptions ?? 10_000
      }
    };
  }

  public create<T>(options?: ChannelCreateOptions): InMemoryChannel<T> {
    return new InMemoryChannel<T>({
      bufferMs: options?.bufferMs ?? this.defaults.bufferMs,
      warnAtRatio: options?.warnAtRatio ?? this.defaults.caps.warnAtRatio,
      maxSubscriptions: options?.maxSubscriptions ?? this.defaults.caps.maxSubscriptions,
      ...options
    });
  }
}

