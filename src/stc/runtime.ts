import { ChannelFactory, type ChannelCreateOptions, type IChannel } from "./channel.js";
import { CollectionFactory } from "./collection.js";
import { DiagnosticsFactory, type DiagnosticsCreateSinkOptions, type DiagnosticsSink } from "./diagnostics.js";
import type { STC } from "../types/stc.js";

export type RuntimeMode = STC.Runtime.Mode;
export type RuntimeConfig = STC.Runtime.Config;
export type IRuntime = STC.Runtime.Runtime;

export function defaultRuntimeConfig(mode: RuntimeMode): RuntimeConfig {
  return {
    mode,
    channel: {
      bufferMs: 100,
      warnAtRatio: 0.8,
      maxSubscriptionsDev: 100,
      maxSubscriptionsProd: 10_000
    },
    diagnostics: {
      historyEnabled: false,
      maxEventsDev: 10_000,
      maxEventsProd: 100_000
    },
    collection: {
      defaultLimit: 10_000,
      warnAtRatio: 0.9
    },
    fs: {},
    features: {}
  };
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (!obj || typeof obj !== "object") return obj as Readonly<T>;
  Object.freeze(obj);
  for (const v of Object.values(obj as any)) {
    if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
  }
  return obj as Readonly<T>;
}

export class Runtime implements IRuntime {
  public readonly mode: RuntimeMode;
  public readonly config: Readonly<RuntimeConfig>;

  private readonly channels: ChannelFactory;
  private readonly collections: CollectionFactory;
  private readonly diagnostics: DiagnosticsFactory;

  public constructor(init?: { config?: Partial<RuntimeConfig>; mode?: RuntimeMode }) {
    const mode = init?.mode ?? init?.config?.mode ?? "dev";
    this.mode = mode;

    const merged: RuntimeConfig = {
      ...defaultRuntimeConfig(mode),
      ...(init?.config ?? {}),
      mode
    };
    // Ensure nested objects also merge sensibly.
    merged.channel = { ...defaultRuntimeConfig(mode).channel, ...(init?.config?.channel ?? {}) };
    merged.diagnostics = { ...defaultRuntimeConfig(mode).diagnostics, ...(init?.config?.diagnostics ?? {}) };
    merged.collection = { ...defaultRuntimeConfig(mode).collection, ...(init?.config?.collection ?? {}) };
    merged.fs = { ...(defaultRuntimeConfig(mode).fs ?? {}), ...(init?.config?.fs ?? {}) };
    merged.features = { ...(defaultRuntimeConfig(mode).features ?? {}), ...(init?.config?.features ?? {}) };

    this.config = deepFreeze(merged);

    const maxSubscriptions =
      this.mode === "dev" ? this.config.channel.maxSubscriptionsDev : this.config.channel.maxSubscriptionsProd;

    this.channels = new ChannelFactory({
      bufferMs: this.config.channel.bufferMs,
      warnAtRatio: this.config.channel.warnAtRatio,
      maxSubscriptions
    });
    this.collections = new CollectionFactory();
    this.diagnostics = new DiagnosticsFactory({ channels: this.channels, collections: this.collections });
  }

  public nowMs(): number {
    return Date.now();
  }

  public createChannel<T>(options?: ChannelCreateOptions): IChannel<T> {
    const maxSubscriptions =
      this.mode === "dev" ? this.config.channel.maxSubscriptionsDev : this.config.channel.maxSubscriptionsProd;

    return this.channels.create<T>({
      bufferMs: options?.bufferMs ?? this.config.channel.bufferMs,
      warnAtRatio: options?.warnAtRatio ?? this.config.channel.warnAtRatio,
      maxSubscriptions: options?.maxSubscriptions ?? maxSubscriptions,
      ...options
    });
  }

  public createDiagnosticsSink(options?: DiagnosticsCreateSinkOptions): DiagnosticsSink {
    return this.diagnostics.createSink({
      mode: this.mode,
      history: {
        enabled: options?.history?.enabled ?? this.config.diagnostics.historyEnabled,
        maxEvents:
          options?.history?.maxEvents ??
          (this.mode === "dev" ? this.config.diagnostics.maxEventsDev : this.config.diagnostics.maxEventsProd)
      },
      defaults: options?.defaults
    });
  }
}

