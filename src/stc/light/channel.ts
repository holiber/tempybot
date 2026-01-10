export type ChannelId = string;
export type Unsubscribe = () => void;

export type ChannelMeta<M extends Record<string, unknown> = Record<string, unknown>> = M;

export type ChannelEvent<T = unknown, M extends ChannelMeta = ChannelMeta> =
  | { kind: "data"; data: T; meta?: M }
  | { kind: "system"; type: string; payload?: unknown; meta?: M };

export interface ChannelCapabilities {
  canRead: boolean;
  canWrite: boolean;
}

export interface ChannelCreateOptions<M extends ChannelMeta = ChannelMeta> {
  id?: ChannelId;
  caps?: Partial<ChannelCapabilities>;
  meta?: M;
  signal?: AbortSignal;
}

export interface ChannelSubscribeOptions {
  signal?: AbortSignal;
}

export interface IChannel<T = unknown, M extends ChannelMeta = ChannelMeta> {
  readonly id: ChannelId;
  readonly caps: ChannelCapabilities;
  readonly meta?: M;

  subscribe(handler: (event: ChannelEvent<T, M>) => void, options?: ChannelSubscribeOptions): Unsubscribe;
  send(data: T, meta?: M): Promise<void> | void;
  close(info?: { code?: string | number; reason?: string }): Promise<void> | void;
}

function createId(): ChannelId {
  return `ch_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export class InMemoryChannel<T = unknown, M extends ChannelMeta = ChannelMeta> implements IChannel<T, M> {
  public readonly id: ChannelId;
  public readonly caps: ChannelCapabilities;
  public readonly meta?: M;

  private state: "open" | "closed" = "open";
  private readonly subs = new Set<(event: ChannelEvent<T, M>) => void>();

  public constructor(options?: ChannelCreateOptions<M>) {
    this.id = options?.id ?? createId();
    this.caps = {
      canRead: options?.caps?.canRead ?? true,
      canWrite: options?.caps?.canWrite ?? true
    };
    this.meta = options?.meta;

    if (options?.signal) {
      if (options.signal.aborted) {
        this.close({ code: "aborted", reason: "Channel creation aborted" });
      } else {
        options.signal.addEventListener(
          "abort",
          () => this.close({ code: "aborted", reason: "Channel aborted" }),
          { once: true }
        );
      }
    }
  }

  public subscribe(handler: (event: ChannelEvent<T, M>) => void, options?: ChannelSubscribeOptions): Unsubscribe {
    if (this.state !== "open") return () => {};
    if (!this.caps.canRead) {
      throw new Error("Channel is not readable (canRead=false)");
    }

    this.subs.add(handler);

    if (options?.signal) {
      if (options.signal.aborted) {
        this.subs.delete(handler);
        return () => {};
      }
      options.signal.addEventListener("abort", () => this.subs.delete(handler), { once: true });
    }

    return () => {
      this.subs.delete(handler);
    };
  }

  public send(data: T, meta?: M): void {
    if (this.state !== "open") return;
    if (!this.caps.canWrite) {
      throw new Error("Channel is not writable (canWrite=false)");
    }
    this.dispatch({ kind: "data", data, meta: meta ?? this.meta });
  }

  public close(info?: { code?: string | number; reason?: string }): void {
    if (this.state === "closed") return;
    this.state = "closed";

    // Notify before cleanup (best-effort).
    this.dispatch({ kind: "system", type: "channel.closed", payload: info, meta: this.meta });

    // Tier1 requirement: cleanup subscriptions on close.
    this.subs.clear();
  }

  private dispatch(evt: ChannelEvent<T, M>): void {
    // Snapshot to avoid surprises if handlers unsubscribe during dispatch.
    const handlers = Array.from(this.subs);
    for (const h of handlers) {
      try {
        h(evt);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Channel subscriber threw", err);
      }
    }
  }
}

export class ChannelFactory {
  public create<T = unknown, M extends ChannelMeta = ChannelMeta>(options?: ChannelCreateOptions<M>): InMemoryChannel<T, M> {
    return new InMemoryChannel<T, M>(options);
  }
}

