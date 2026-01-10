/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Cerebellum Spec (Tier 1) (minified)
 *
 * Cerebellum = event loop + hook chain.
 *
 * Everything is an Event.
 * Hooks are plain functions that may:
 * - pass/transform an event
 * - swallow it (return null)
 * - emit more events
 * - call tools
 *
 * Wake/autoresponder = just dispatch({type:"wake"}).
 */

export declare namespace STC {
  export namespace Cerebellum {
    export type Meta<M extends Record<string, unknown> = Record<string, unknown>> = M;

    export type ActorRole = "user" | "agent" | "system";

    export interface Actor<M extends Meta = Meta> {
      role: ActorRole;
      id?: string;
      name?: string;
      meta?: M;
    }

    /** Intention required for agent tool calls (policy-enforced by hooks). */
    export interface Intention<M extends Meta = Meta> {
      tool: string;
      action?: string;
      args?: unknown;
      meta?: M;
    }

    /** Tool invocation request. */
    export interface ToolRequest<M extends Meta = Meta> {
      actor: Actor<M>;
      intention?: Intention<M>;
      input?: unknown;
      command?: string;
      meta?: M;
    }

    /** Tool final result. */
    export interface ToolResult<M extends Meta = Meta> {
      ok: boolean;
      output?: unknown;
      logs?: string;
      error?: { message: string; code?: string | number; meta?: M };
      meta?: M;
    }

    /** Tool execution handle (may stream). */
    export interface ToolExecution<M extends Meta = Meta> {
      result: Promise<ToolResult<M>>;
      channel?: STC.Channel.Channel<{ type: string; payload?: unknown; meta?: M }, M>;
    }

    /**
     * Universal cerebellum event.
     * Keep open-ended by design: `type` is a string.
     */
    export interface Event<M extends Meta = Meta> {
      type: string;
      actor?: Actor<M>;
      payload?: unknown;
      meta?: M;
    }

    /**
     * Hook function.
     * - return Event: continue with (possibly modified) event
     * - return null: swallow (stop propagation)
     * - return void: no change (continue)
     */
    export type Hook<M extends Meta = Meta> =
      (event: Event<M>, ctx: Context<M>) =>
        | Event<M>
        | null
        | void
        | Promise<Event<M> | null | void>;

    /**
     * Hook context = minimal "OS" API.
     */
    export interface Context<M extends Meta = Meta> {
      /** Emit a new event into cerebellum (async fire-and-forget). */
      emit(event: Event<M>): void;

      /** Access cheap world snapshot. */
      getWorld(): Promise<STC.World>;

      /** Call a tool (may stream). */
      callTool(req: ToolRequest<M>): ToolExecution<M>;

      /** Log helper (just emits {type:"log"}). */
      log(message: string, meta?: M): void;
    }

    /** Permission/capabilities (minimal). */
    export interface Capabilities {
      /** Can register hooks dynamically (vs only at startup). */
      hooks: "none" | "template-only" | "dynamic";

      /** Hooks are allowed to call tools. */
      hookMayCallTools: boolean;
    }

    export interface Cerebellum<M extends Meta = Meta> {
      readonly caps: Capabilities;

      /** Unified event stream of what cerebellum does/observes. */
      readonly channel: STC.Channel.Channel<Event<M>, M>;

      /** Register a hook (order is registration order). */
      use(hook: Hook<M>): void;

      /** Snapshot of visible world (cheap). */
      getWorld(): Promise<STC.World>;

      /**
       * Dispatch an event through hooks chain.
       * Returns final event (or null if swallowed).
       */
      dispatch(event: Event<M>): Promise<Event<M> | null>;

      /**
       * Convenience: tool calls go through hooks too.
       * Typically dispatches {type:"tool.request"} and then performs tool.
       */
      executeTool(req: ToolRequest<M>): ToolExecution<M>;
    }
  }
}
