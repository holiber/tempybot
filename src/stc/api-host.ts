import { InMemoryChannel, type IChannel } from "./channel.js";
import type { ApiCallResult, ApiLogLevel } from "./api-client.js";
import { DefaultDiagnosticsContext, type DiagnosticsContext, type DiagnosticsSink } from "./diagnostics.js";
import type { IRuntime } from "./runtime.js";
import type { TransportCarrier, TransportClient } from "./transport.js";

export type ApiHostId = string;
export type ApiHostState = "created" | "listening" | "closing" | "closed";

export interface ApiHostCallContext {
  requestId: string;
  channel: IChannel<unknown>;
  runtime: IRuntime;
  diagnostics: DiagnosticsContext;
  signal: AbortSignal;
  transport?: {
    name?: string;
    carrier?: TransportCarrier;
    remoteAddress?: string;
    headers?: Record<string, string>;
  };
}

export type ApiHostMethodHandler = (input: unknown, ctx: ApiHostCallContext) => Promise<unknown>;

export interface ApiHostMethodDescriptor {
  method: string;
  handler: ApiHostMethodHandler;
  capabilities?: { streaming?: boolean; progress?: boolean; logs?: boolean };
  meta?: Record<string, unknown>;
}

export interface ApiHostOptions {
  id?: ApiHostId;
  runtime: IRuntime;
  diagnostics?: DiagnosticsSink;
  transports: TransportClient[];
  defaults?: {
    timeoutMs?: number;
    logLevel?: ApiLogLevel;
  };
}

export interface IApiHost {
  readonly id: ApiHostId;
  readonly state: ApiHostState;
  start(): Promise<void>;
  stop(): Promise<void>;
  register(method: ApiHostMethodDescriptor): void;
  registerAll(methods: ApiHostMethodDescriptor[]): void;
  getMethods(): ApiHostMethodDescriptor[];
}

function createHostId(): ApiHostId {
  return `host_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function createAbortSignal(timeoutMs?: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    }
  };
}

export class ApiHost implements IApiHost {
  public readonly id: ApiHostId;
  public get state(): ApiHostState {
    return this._state;
  }
  private _state: ApiHostState = "created";

  private readonly runtime: IRuntime;
  private readonly diagnosticsSink?: DiagnosticsSink;
  private readonly transports: TransportClient[];
  private readonly defaults?: ApiHostOptions["defaults"];

  private readonly methods = new Map<string, ApiHostMethodDescriptor>();

  public constructor(options: ApiHostOptions) {
    this.id = options.id ?? createHostId();
    this.runtime = options.runtime;
    this.diagnosticsSink = options.diagnostics;
    this.transports = options.transports;
    this.defaults = options.defaults;
  }

  public async start(): Promise<void> {
    if (this._state !== "created") return;
    this._state = "listening";
  }

  public async stop(): Promise<void> {
    if (this._state === "closed") return;
    if (this._state === "closing") return;
    this._state = "closing";
    // Best-effort: dispose configured transport clients.
    await Promise.allSettled(this.transports.map((t) => t.dispose()));
    this._state = "closed";
  }

  public register(method: ApiHostMethodDescriptor): void {
    this.methods.set(method.method, method);
  }

  public registerAll(methods: ApiHostMethodDescriptor[]): void {
    for (const m of methods) this.register(m);
  }

  public getMethods(): ApiHostMethodDescriptor[] {
    return Array.from(this.methods.values());
  }

  /**
   * Non-spec helper: route a call request to a registered handler.
   * Used by in-memory transports / direct invocation.
   */
  public async handleCall(request: {
    requestId: string;
    method: string;
    input: unknown;
    channel?: IChannel<unknown>;
    timeoutMs?: number;
    transport?: ApiHostCallContext["transport"];
  }): Promise<ApiCallResult> {
    const desc = this.methods.get(request.method);
    if (!desc) {
      return {
        status: "error",
        error: { message: `Unknown method: ${request.method}`, origin: "server", code: "method_not_found" }
      };
    }

    const channel =
      request.channel ??
      this.runtime.createChannel?.({ id: `call:${request.requestId}` }) ??
      new InMemoryChannel<unknown>({ id: `call:${request.requestId}` });

    const abort = createAbortSignal(request.timeoutMs ?? this.defaults?.timeoutMs);

    const makeNoopContext = (): DiagnosticsContext => {
      const ctx: DiagnosticsContext = {
        emit: async () => {},
        error: async () => {},
        warn: async () => {},
        info: async () => {},
        log: async () => {},
        debug: async () => {},
        with: () => ctx
      };
      return ctx;
    };

    const diagnosticsCtx: DiagnosticsContext = this.diagnosticsSink
      ? new DefaultDiagnosticsContext(this.diagnosticsSink, {
          source: "api-host",
          correlationId: request.requestId
        })
      : makeNoopContext();

    const ctx: ApiHostCallContext = {
      requestId: request.requestId,
      channel,
      runtime: this.runtime,
      diagnostics: diagnosticsCtx,
      signal: abort.signal,
      transport: request.transport
    };

    try {
      const value = await desc.handler(request.input, ctx);
      return { status: "ok", value };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "Handler failed");
      return { status: "error", error: { message, origin: "server" } };
    } finally {
      abort.cancel();
      try {
        await channel.close({ code: "done" });
      } catch {
        // ignore
      }
    }
  }
}

