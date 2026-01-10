import type { STC } from "../types/stc.js";
import { CollectionFactory, type ICollection } from "./collection.js";
import { ChannelFactory, type IChannel } from "./channel.js";

export type DiagnosticsLevel = STC.Diagnostics.Level;
export type DiagnosticsCode = STC.Diagnostics.Code;
export type DiagnosticsSource = STC.Diagnostics.Source;
export type DiagnosticsErrorInfo = STC.Diagnostics.ErrorInfo;
export type DiagnosticsEvent = STC.Diagnostics.Event;
export type DiagnosticsSink = STC.Diagnostics.Sink;
export type DiagnosticsCreateSinkOptions = STC.Diagnostics.CreateSinkOptions;
export type DiagnosticsContext = STC.Diagnostics.Context;

function createId(): string {
  return `diag_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
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
        if (!merged.id) (merged as any).id = createId();
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
          keyField: "id"
        })
      : undefined;

    return new InMemoryDiagnosticsSink({ channel, history, defaults: options?.defaults });
  }

  public createContext(sink: DiagnosticsSink, defaults?: DiagnosticsCreateSinkOptions["defaults"]): DiagnosticsContext {
    return new DefaultDiagnosticsContext(sink, defaults);
  }
}

