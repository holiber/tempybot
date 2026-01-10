import { InMemoryChannel, type IChannel } from "./channel.js";
import type { ApiCallResult } from "./api-client.js";
import type { DiagnosticsSink } from "./diagnostics.js";

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

export interface TransportOptions {
  name?: TransportName;
  carrier: TransportCarrier;
  protocol: TransportProtocol;
  endpoint: TransportEndpoint;
  auth?: TransportAuthConfig;
  mode?: "dev" | "prod";
  diagnostics?: DiagnosticsSink;
}

export interface TransportCallRequest extends Record<string, unknown> {
  requestId: string;
  method: string;
  input: unknown;
  channel: IChannel<unknown>;
  startedAtMs?: number;
}

export interface TransportClient {
  readonly options: Readonly<TransportOptions>;
  call(request: TransportCallRequest): Promise<ApiCallResult>;
  openChannel(request: TransportCallRequest): Promise<IChannel<unknown>>;
  dispose(): Promise<void>;
}

export interface TransportFactory {
  createClient(options: TransportOptions): TransportClient;
}

/**
 * Simple in-memory transport that delegates to provided handlers.
 * Useful for reference implementations and tests.
 */
export class InMemoryTransportClient implements TransportClient {
  public readonly options: Readonly<TransportOptions>;

  public constructor(
    options: TransportOptions,
    private readonly handlers: {
      call: (req: TransportCallRequest) => Promise<ApiCallResult> | ApiCallResult;
      openChannel?: (req: TransportCallRequest) => Promise<IChannel<unknown>> | IChannel<unknown>;
      dispose?: () => Promise<void> | void;
    }
  ) {
    this.options = Object.freeze({ ...options });
  }

  public async call(request: TransportCallRequest): Promise<ApiCallResult> {
    try {
      return await this.handlers.call(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "Transport call failed");
      return { status: "error", error: { message, origin: "transport" } };
    }
  }

  public async openChannel(request: TransportCallRequest): Promise<IChannel<unknown>> {
    if (this.handlers.openChannel) return await this.handlers.openChannel(request);
    return new InMemoryChannel<unknown>({ id: `transport:${request.requestId}` });
  }

  public async dispose(): Promise<void> {
    await this.handlers.dispose?.();
  }
}

export class DefaultTransportFactory implements TransportFactory {
  public createClient(options: TransportOptions): TransportClient {
    // Tier1: only in-memory transport is provided here.
    // Real HTTP/WS/stdio implementations can be added later behind this factory.
    return new InMemoryTransportClient(options, {
      call: async () => ({
        status: "error",
        error: { message: `No transport implementation for carrier=${options.carrier}`, origin: "transport" }
      })
    });
  }
}

