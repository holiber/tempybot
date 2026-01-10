/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Chat Spec (Tier 1)
 *
 * Tier 1:
 * - Chat = descriptor + message access + live channel
 * - Channel is the only streaming primitive
 * - canRead / canWrite enforced via Channel.caps
 * - No adapters in core
 *
 * Proposal:
 * - streaming drafts
 * - editable messages
 * - stateful chats
 * - integrations/adapters
 */

export declare namespace STC {
  export namespace Chat {
    /** Generic meta container (required convention). */
    export type Meta<M extends Record<string, unknown> = Record<string, unknown>> = M;

    /** Author role (LLM-oriented). */
    export type Role = "system" | "user" | "agent" | "tool";

    /** Informational chat kinds (Tier1). */
    export type ChatType =
      | "issue"
      | "pr"
      | "comments"
      | "task"
      | "job"
      | "log"
      | "other";

    /** Tier1 limits (intentionally minimal). */
    export interface Limits {
      /** Max number of messages returned/retained (best-effort). */
      maxMessages?: number;
    }

    /**
     * Lightweight chat descriptor.
     * Cheap enough to be returned by getWorld().
     */
    export interface Descriptor<M extends Meta = Meta> {
      id: string;

      chatType?: ChatType;
      title?: string;

      /** Provider/source reference (URL, file, job id, etc.). */
      source?: string;

      limits?: Limits;

      meta?: M;
    }

    /**
     * Immutable chat message snapshot.
     */
    export interface Message<M extends Meta = Meta> {
      id: string;

      /** Monotonic ordering inside chat (Tier1 requirement). */
      seq: number;

      role: Role;
      body: string;

      /** ISO timestamp. */
      ts: string;

      meta?: M;
    }

    /** Opaque pagination cursor. */
    export interface Cursor {
      cursor: string;
    }

    export interface FetchOptions {
      /** Latest messages first by default. */
      limit?: number;

      /** Fetch messages older than this cursor. */
      before?: Cursor;
    }

    export interface FetchResult<M extends Meta = Meta> {
      messages: Array<Message<M>>;

      page?: {
        hasMore?: boolean;
        next?: Cursor;
      };

      meta?: M;
    }

    export interface AppendInput<M extends Meta = Meta> {
      role: Role;
      body: string;
      meta?: M;
    }

    /**
     * Chat object (Tier 1).
     * No local message storage implied.
     */
    export interface Chat<M extends Meta = Meta> {
      /** Descriptor snapshot (cheap). */
      getDescriptor(): Promise<Descriptor<M>>;

      /**
       * Live updates channel.
       * Used for:
       * - streaming agent output
       * - progress / status
       * - tool events
       *
       * Writing is controlled by channel.caps.canWrite.
       */
      readonly channel: STC.Channel.Channel<{
        type: string;
        payload?: unknown;
        meta?: M;
      }, M>;

      /** Fetch latest / older messages. */
      fetchMessages(options?: FetchOptions): Promise<FetchResult<M>>;

      /** Append a message (if allowed). */
      append(input: AppendInput<M>): Promise<Message<M>>;

      updateMyMessage(
          messageId: string,
          patch: { body?: string; meta?: M }
        ): Promise<Message<M>>;
    }

    // ----------------------------
    // Proposal (Tier2+)
    // ----------------------------
    export namespace Proposal {
      /** Streaming drafts (Cursor-style). */
      export interface Streaming<M extends Meta = Meta> {
        beginMessage(input: { role: Role; initialBody?: string; meta?: M }): Promise<{ messageId: string }>;
        appendChunk(messageId: string, chunk: string): Promise<void>;
        finalize(messageId: string): Promise<Message<M>>;
      }

      /** Editable messages. */
      export interface Editable<M extends Meta = Meta> {
        updateMyMessage(
          messageId: string,
          patch: { body?: string; meta?: M }
        ): Promise<Message<M>>;
      }

      /** Stateful chat with local collection + sync. */
      export interface Stateful<M extends Meta = Meta> extends Chat<M> {
        readonly messages: STC.Collection.Collection<Message<M>>;
        sync(): Promise<{ added: number; updated: number; removed: number }>;
      }
    }
  }
}
