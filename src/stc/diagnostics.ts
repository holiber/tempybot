import { CollectionFactory, type AnyRecord, type ICollection } from "./collection.js";
import { ChannelFactory, type IChannel } from "./channel.js";

export type DiagnosticsLevel = "error" | "warn" | "info" | "log" | "debug";
export type DiagnosticsCode = string;
export type DiagnosticsSource = string;

export interface DiagnosticsErrorInfo {
  name?: string;
  message?: string;
  stack?: string;
  code?: string | number;
}

export interface DiagnosticsEvent extends AnyRecord {
  id?: string;
  level: DiagnosticsLevel;
  message: string;
  code?: DiagnosticsCode;
  source?: DiagnosticsSource;
  tsMs: number;
  correlationId?: string;
  details?: Record<string, unknown>;
  error?: DiagnosticsErrorInfo;
  tags?: string[];
}

export interface DiagnosticsSink {
  readonly channel: IChannel<DiagnosticsEvent>;
  readonly history?: ICollection<DiagnosticsEvent>;
  emit(event: DiagnosticsEvent): Promise<void>;
}

export interface DiagnosticsCreateSinkOptions {
  mode?: "dev" | "prod";
  history?: {
    enabled?: boolean;
    maxEvents?: number;
  };
  defaults?: {
    source?: DiagnosticsSource;
    correlationId?: string;
    tags?: string[];
  };
}

export interface DiagnosticsContext {
  emit(event: Omit<DiagnosticsEvent, "tsMs"> & Partial<Pick<DiagnosticsEvent, "tsMs">>): Promise<void>;
  error(message: string, init?: Partial<DiagnosticsEvent>): Promise<void>;
  warn(message: string, init?: Partial<DiagnosticsEvent>): Promise<void>;
  info(message: string, init?: Partial<DiagnosticsEvent>): Promise<void>;
  log(message: string, init?: Partial<DiagnosticsEvent>): Promise<void>;
  debug(message: string, init?: Partial<DiagnosticsEvent>): Promise<void>;
  with(defaults: DiagnosticsCreateSinkOptions["defaults"]): DiagnosticsContext;
}

export class InMemoryDiagnosticsSink implements DiagnosticsSink {
  public readonly channel: IChannel<DiagnosticsEvent>;
  public readonly history?: ICollection<DiagnosticsEvent>;

  private readonly defaults?: DiagnosticsCreateSinkOptions["defaults"];

  public constructor(init: {
    channel: IChannel<DiagnosticsEvent>;
    history?: ICollection<DiagnosticsEvent>;
    defaults?: DiagnosticsCreateSinkOptions["defaults"];
  }) {
    this.channel = init.channel;
    this.history = init.history;
    this.defaults = init.defaults;
  }

  public async emit(event: DiagnosticsEvent): Promise<void> {
    const tsMs = event.tsMs ?? Date.now();
    const merged: DiagnosticsEvent = {
      ...this.defaults,
      ...event,
      tsMs
    };

    if (this.history) {
      try {
        this.history.upsert(merged);
      } catch {
        // Best-effort history; if caps are exceeded, still emit to channel.
      }
    }
    await this.channel.send(merged);
  }
}

export class DefaultDiagnosticsContext implements DiagnosticsContext {
  private readonly sink: DiagnosticsSink;
  private readonly defaults?: DiagnosticsCreateSinkOptions["defaults"];

  public constructor(sink: DiagnosticsSink, defaults?: DiagnosticsCreateSinkOptions["defaults"]) {
    this.sink = sink;
    this.defaults = defaults;
  }

  public async emit(
    event: Omit<DiagnosticsEvent, "tsMs"> & Partial<Pick<DiagnosticsEvent, "tsMs">>
  ): Promise<void> {
    const tsMs = event.tsMs ?? Date.now();
    await this.sink.emit({
      ...(this.defaults ?? {}),
      ...(event as any),
      tsMs
    });
  }

  public async error(message: string, init?: Partial<DiagnosticsEvent>): Promise<void> {
    return this.emit({ ...(init ?? {}), level: "error", message } as any);
  }
  public async warn(message: string, init?: Partial<DiagnosticsEvent>): Promise<void> {
    return this.emit({ ...(init ?? {}), level: "warn", message } as any);
  }
  public async info(message: string, init?: Partial<DiagnosticsEvent>): Promise<void> {
    return this.emit({ ...(init ?? {}), level: "info", message } as any);
  }
  public async log(message: string, init?: Partial<DiagnosticsEvent>): Promise<void> {
    return this.emit({ ...(init ?? {}), level: "log", message } as any);
  }
  public async debug(message: string, init?: Partial<DiagnosticsEvent>): Promise<void> {
    return this.emit({ ...(init ?? {}), level: "debug", message } as any);
  }

  public with(defaults: DiagnosticsCreateSinkOptions["defaults"]): DiagnosticsContext {
    return new DefaultDiagnosticsContext(this.sink, { ...(this.defaults ?? {}), ...(defaults ?? {}) });
  }
}

export class DiagnosticsFactory {
  public constructor(
    private readonly deps?: {
      channels?: ChannelFactory;
      collections?: CollectionFactory;
    }
  ) {}

  public createSink(options?: DiagnosticsCreateSinkOptions): DiagnosticsSink {
    const channelFactory = this.deps?.channels ?? new ChannelFactory();
    const collectionFactory = this.deps?.collections ?? new CollectionFactory();

    const channel = channelFactory.create<DiagnosticsEvent>({ id: "diagnostics" });
    const historyEnabled = options?.history?.enabled ?? false;
    const history = historyEnabled
      ? collectionFactory.create<DiagnosticsEvent, string>({
          name: "diagnostics.history",
          keyField: "id",
          limit: options?.history?.maxEvents ?? (options?.mode === "dev" ? 10_000 : 100_000),
          autoKey: true
        })
      : undefined;

    return new InMemoryDiagnosticsSink({ channel, history, defaults: options?.defaults });
  }

  public createContext(sink: DiagnosticsSink, defaults?: DiagnosticsCreateSinkOptions["defaults"]): DiagnosticsContext {
    return new DefaultDiagnosticsContext(sink, defaults);
  }
}

