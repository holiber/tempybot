/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Chat Spec (Tier 1)
 *
 * Tier 1:
 * - Chat has descriptor + live channel + message operations via adapter
 * - fetchMessages returns latest N with pagination info
 * - streaming messages supported via begin/append/finalize
 * - ChatAdapter is constructed with auth/config (implementation-defined) and opens chats
 * - Reference adapter: InMemoryChatAdapter
 *
 * Proposal (Tier2):
 * - StatefulChat with local messages collection + sync
 */

export declare namespace STC {
  export namespace Chat {
    /** Message author role (LLM-oriented). */
    export type Role = "system" | "user" | "agent" | "tool";

    /** Tier 1 agreed chat types. */
    export type ChatType =
      | "issue"
      | "task"
      | "ticket"
      | "pr"
      | "messenger"
      | "comments"
      | "other";

    export interface Limits {
      /** Max number of messages returned/retained by adapter or source (best-effort). */
      maxMessages?: number; // Tier1 (optional)
      // proposal:
      maxBodyChars?: number;
      minPostIntervalMs?: number;
      maxAttachments?: number;
      maxAttachmentBytes?: number;
    }

    /** Lightweight chat descriptor (Tier1: cheap). */
    export interface Descriptor extends STC.Collection.AnyRecord {
      id: string;
      externalId?: string;

      chatType?: ChatType;

      title?: string;
      description?: string;

      adapter?: string; // e.g. "InMemoryChatAdapter", "GitHub.ChatAdapter"
      source?: string;  // URL/file/db ref, if available

      isPublic?: boolean;

      /** Whether current principal can post messages (best-effort). */
      canPost?: boolean;

      createdAtMs?: number;
      lastUpdatedAtMs?: number;

      limits?: Limits;

      tags?: string[];
      meta?: Record<string, unknown>;
    }

    export interface Message extends STC.Collection.AnyRecord {
      id: string;

      /** Monotonic ordering inside a chat (Tier1 required). */
      seq: number;

      /** Author role (system/user/agent/tool). */
      role: Role;

      /**
       * Contextual roles of the author for this message.
       * Examples: ["moderator"], ["reviewer"], ["coder"], ["security"]
       */
      roles?: string[];

      body: string;
      createdAtMs: number;

      /** Optional author info (best-effort). */
      author?: {
        id?: string;
        name?: string;
      };

      /** Provider-specific metadata (best-effort). */
      meta?: Record<string, unknown>;
    }

    /** Cursor-based pagination for messages. */
    export interface PageCursor {
      /** Opaque cursor string (provider-defined). */
      cursor: string;
    }

    export interface FetchMessagesOptions {
      /** Return latest messages first by default. */
      limit?: number; // default 100

      /** Fetch messages before this cursor (older). */
      before?: PageCursor;

      /** Fetch messages after this cursor (newer). */
      after?: PageCursor;
    }

    export interface FetchMessagesResult {
      messages: Message[];

      /** Pagination hints. */
      pageInfo: {
        hasMoreBefore: boolean;
        hasMoreAfter: boolean;

        /** Cursor for the first/last returned message (best-effort). */
        startCursor?: PageCursor;
        endCursor?: PageCursor;
      };
    }

    /** Streaming message handle (draft). */
    export interface MessageDraft {
      chatId: string;
      messageId: string;

      /**
       * If adapter maps streaming to edits of one message, messageId stays stable.
       * If adapter maps streaming to multiple messages, messageId may represent the "head" message (implementation-defined).
       */
      meta?: Record<string, unknown>;
    }

    /** Chat events (live updates). */
    export type Event =
      | { type: "message.added"; message: Message }
      | { type: "message.updated"; message: Message }
      | { type: "message.removed"; id: string }
      | { type: "message.stream.started"; draft: MessageDraft }
      | { type: "message.stream.chunk"; draft: MessageDraft; chunk: string }
      | { type: "message.stream.finalized"; draft: MessageDraft; message: Message };

    /**
     * Chat object (Tier 1).
     * No local message store is required in Tier 1.
     */
    export interface Chat {
      getDescriptor(): Promise<Descriptor>;

      /** Live updates channel (safe-by-default). */
      readonly channel: STC.Channel.Channel<Event>;

      /** Fetch latest/older/newer messages with pagination info. */
      fetchMessages(options?: FetchMessagesOptions): Promise<FetchMessagesResult>;

      /**
       * Add a message (if allowed).
       * Should fail with a normalized error if cannot post.
       */
      append(input: AppendInput): Promise<Message>;

      /**
       * Edit a message created by current principal (best-effort).
       * If provider does not support edits, adapter may emulate or reject.
       */
      updateMyMessage(messageId: string, patch: UpdateMyMessagePatch): Promise<Message>;

      /**
       * Begin streaming message (draft).
       * Adapters may create a placeholder message or keep draft locally until first chunk.
       */
      beginMessage(input: BeginMessageInput): Promise<MessageDraft>;

      /** Append a chunk to a streaming message draft (best-effort). */
      appendMessageChunk(draft: MessageDraft, chunk: string): Promise<void>;

      /** Finalize draft and return final message representation (best-effort). */
      finalizeMessage(draft: MessageDraft): Promise<Message>;
    }

    export interface AppendInput {
      role: Role;
      roles?: string[];
      body: string;
      meta?: Record<string, unknown>;
    }

    export interface BeginMessageInput {
      role: Role;
      roles?: string[];
      /** Optional initial text. */
      initialBody?: string;
      meta?: Record<string, unknown>;
    }

    export interface UpdateMyMessagePatch {
      body?: string;
      meta?: Record<string, unknown>;
    }

    /**
     * ChatAdapter connects to external systems (GitHub, messengers, etc.)
     * Tier 1 requires:
     * - open chat by ref
     * - provide chat object implementing Chat interface
     * - auth/config passed at construction time (implementation-defined)
     */
    export interface Adapter {
      readonly name: string;
      open(ref: AdapterRef): Promise<Chat>;
    }

    export interface AdapterRef {
      /** External chat id in provider system (issue id, channel id, thread id, etc.). */
      externalId?: string;

      /** A source URL if available. */
      source?: string;

      /** Provider-specific reference fields. */
      meta?: Record<string, unknown>;
    }

    /** Adapter construction options (Tier 1). */
    export interface AdapterOptions {
      /** Auth wiring (bearer/headers). */
      auth?: STC.Transport.AuthConfig;

      /**
       * Optional ApiClient for remote provider calls.
       * Adapters can use it to unify request lifecycle and error normalization.
       */
      apiClient?: unknown;

      /** Optional storage (for caching, etc.). */
      storage?: STC.Storage;

      /** Optional mode hint (may influence defaults). */
      mode?: "dev" | "prod";
    }

    /** Reference adapter (Tier 1): in-memory. */
    export interface InMemoryChatAdapter extends Adapter {}

    export namespace Proposal {
      /** Tier2: StatefulChat with local collection + sync. */
      export interface StatefulChat extends Chat {
        readonly kind: "stateful";
        readonly messages: STC.Collection.Collection<Message>;
        sync(options?: { scope?: string }): Promise<{ added: number; updated: number; removed: number }>;
      }

      /** Proposal: broader chat types. */
      export type ChatType =
        | "email"
        | "call"
        | "social"
        | "forum"
        | "irc"
        | "cloud"
        | "support"
        | "sms"
        | "radio"
        | "other";
    }
  }

  /**
   * GitHub integration namespace shape (Tier 1 package).
   * Package naming recommended: @stc/integrations/github
   */
  export namespace GitHub {
    export namespace Chat {
      export interface Adapter extends STC.Chat.Adapter {}
      export interface AdapterOptions extends STC.Chat.AdapterOptions {}
    }
  }
}
