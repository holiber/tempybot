import type { STC } from "../../types/light/stc.js";
import { ChannelFactory, type ChannelMeta } from "./channel.js";

export type TransportName = STC.Transport.Name;
export type TransportCarrier = STC.Transport.Carrier;
export type TransportProtocol = STC.Transport.Protocol;
export type TransportEndpoint = STC.Transport.Endpoint;
export type TransportAuthConfig = STC.Transport.AuthConfig;
export type TransportMeta<M extends Record<string, unknown> = Record<string, unknown>> = STC.Transport.Meta<M>;
export type TransportOptions<M extends TransportMeta = TransportMeta> = STC.Transport.Options<M>;

export type TransportCallRequest = STC.ApiClient.CallRequest;
export type TransportCallResult = STC.ApiClient.CallResult;
export type ITransportClient<M extends TransportMeta = TransportMeta> = STC.Transport.Client<M>;
export type TransportFactory = STC.Transport.Factory;

export class LocalTransportClient<M extends TransportMeta = TransportMeta> implements STC.Transport.Client<M> {
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
      return {
        status: "error",
        error: { message: "Transport client is disposed", origin: "client" }
      } as TransportCallResult;
    }
    try {
      if (!this.callImpl) {
        return {
          status: "error",
          error: { message: "No call implementation configured", origin: "client" }
        } as TransportCallResult;
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
      } as TransportCallResult;
    }
  }

  public async openChannel(_request: TransportCallRequest): Promise<STC.Channel.Channel<unknown, M>> {
    if (this.disposed) {
      return this.channels.create({
        caps: { canRead: false, canWrite: false },
        meta: this.options.meta as ChannelMeta as any
      }) as STC.Channel.Channel<unknown, M>;
    }
    return this.channels.create({
      caps: { canRead: true, canWrite: true },
      meta: this.options.meta as ChannelMeta as any
    }) as STC.Channel.Channel<unknown, M>;
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
  ): STC.Transport.Client<M> {
    return new LocalTransportClient<M>({ options, call: impl?.call }) as STC.Transport.Client<M>;
  }
}

