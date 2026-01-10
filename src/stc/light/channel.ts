import type { STC } from "../../types/light/stc.js";

function createId(): ChannelId {
  return `ch_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export type ChannelId = STC.Channel.Id;
export type Unsubscribe = STC.Channel.Unsubscribe;
export type ChannelMeta<M extends Record<string, unknown> = Record<string, unknown>> = STC.Channel.Meta<M>;
export type ChannelEvent<T = unknown, M extends ChannelMeta = ChannelMeta> = STC.Channel.Event<T, M>;
export type ChannelCapabilities = STC.Channel.Capabilities;
export type ChannelCreateOptions<M extends ChannelMeta = ChannelMeta> = STC.Channel.CreateOptions<M>;
export type ChannelSubscribeOptions = STC.Channel.SubscribeOptions;
export type IChannel<T = unknown, M extends ChannelMeta = ChannelMeta> = STC.Channel.Channel<T, M>;

export class InMemoryChannel<T = unknown, M extends ChannelMeta = ChannelMeta>
  implements STC.Channel.Channel<T, M>
{
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
  public create<T = unknown, M extends ChannelMeta = ChannelMeta>(
    options?: ChannelCreateOptions<M>
  ): STC.Channel.Channel<T, M> {
    return new InMemoryChannel<T, M>(options);
  }
}

