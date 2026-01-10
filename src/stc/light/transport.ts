import { ChannelFactory, type ChannelMeta, type IChannel } from "./channel.js";

export type TransportName = string;
export type TransportCarrier = "http" | "ws" | "stdio" | "sse" | "poll";
export type TransportProtocol = "rest";

export interface TransportEndpoint {
  url: string;
}

export type TransportAuthConfig =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "headers"; headers: Record<string, string> }
  | { kind: "apiKey"; key: string; header?: string; queryParam?: string };

export type TransportMeta<M extends Record<string, unknown> = Record<string, unknown>> = M;

export interface TransportOptions<M extends TransportMeta = TransportMeta> {
  name?: TransportName;
  carrier: TransportCarrier;
  protocol: TransportProtocol;
  endpoint: TransportEndpoint;
  auth?: TransportAuthConfig;
  mode?: "dev" | "prod";
  meta?: M;
  diagnostics?: {
    emit: (event: { level: "error" | "warn" | "info" | "log" | "debug"; message: string; tsMs: number }) =>
      | Promise<void>
      | void;
  };
}

export interface TransportCallRequest {
  requestId: string;
  method: string;
  input: unknown;
  channel: IChannel<unknown>;
}

export type TransportCallResult<T = unknown> =
  | { status: "ok"; value: T }
  | { status: "error"; error: { message: string; code?: string | number; stack?: string; origin?: "client" | "server" | "transport" } }
  | { status: "canceled" | "timeout"; error?: { message: string } };

export interface ITransportClient<M extends TransportMeta = TransportMeta> {
  readonly options: Readonly<TransportOptions<M>>;
  call(request: TransportCallRequest): Promise<TransportCallResult>;
  openChannel(request: TransportCallRequest): Promise<IChannel<unknown, M>>;
  dispose(): Promise<void>;
}

export interface TransportFactory {
  createClient<M extends TransportMeta = TransportMeta>(
    options: TransportOptions<M>,
    impl?: {
      call?: (request: TransportCallRequest) => Promise<TransportCallResult>;
    }
  ): ITransportClient<M>;
}

export class LocalTransportClient<M extends TransportMeta = TransportMeta> implements ITransportClient<M> {
  public readonly options: Readonly<TransportOptions<M>>;

  private readonly channels: ChannelFactory;
  private readonly callImpl?: (request: TransportCallRequest) => Promise<TransportCallResult>;
  private disposed = false;

  public constructor(init: {
    options: TransportOptions<M>;
    channels?: ChannelFactory;
    call?: (request: TransportCallRequest) => Promise<TransportCallResult>;
  }) {
    this.options = init.options;
    this.channels = init.channels ?? new ChannelFactory();
    this.callImpl = init.call;
  }

  public async call(request: TransportCallRequest): Promise<TransportCallResult> {
    if (this.disposed) {
      return { status: "error", error: { message: "Transport client is disposed", origin: "client" } };
    }
    try {
      if (!this.callImpl) {
        return { status: "error", error: { message: "No call implementation configured", origin: "client" } };
      }
      return await this.callImpl(request);
    } catch (err) {
      const e = err as any;
      return {
        status: "error",
        error: {
          message: e?.message ?? String(err),
          code: e?.code,
          stack: e?.stack,
          origin: "transport"
        }
      };
    }
  }

  public async openChannel(_request: TransportCallRequest): Promise<IChannel<unknown, M>> {
    if (this.disposed) {
      return this.channels.create({
        caps: { canRead: false, canWrite: false },
        meta: this.options.meta as ChannelMeta as any
      });
    }
    return this.channels.create({
      caps: { canRead: true, canWrite: true },
      meta: this.options.meta as ChannelMeta as any
    });
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
  }
}

export class DefaultTransportFactory implements TransportFactory {
  public createClient<M extends TransportMeta = TransportMeta>(
    options: TransportOptions<M>,
    impl?: { call?: (request: TransportCallRequest) => Promise<TransportCallResult> }
  ): ITransportClient<M> {
    return new LocalTransportClient<M>({ options, call: impl?.call });
  }
}

