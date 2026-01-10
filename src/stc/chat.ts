import { ChannelFactory, type IChannel } from "./channel.js";
import { CollectionFactory, type ICollection } from "./collection.js";
import type { TransportAuthConfig } from "./transport.js";
import type { Storage } from "./storage.js";

export type ChatRole = "system" | "user" | "agent" | "tool";
export type ChatType = "issue" | "task" | "ticket" | "pr" | "messenger" | "comments" | "other";

export interface ChatLimits {
  maxMessages?: number;
  maxBodyChars?: number;
  minPostIntervalMs?: number;
  maxAttachments?: number;
  maxAttachmentBytes?: number;
}

export interface ChatDescriptor extends Record<string, unknown> {
  id: string;
  externalId?: string;
  chatType?: ChatType;
  title?: string;
  description?: string;
  adapter?: string;
  source?: string;
  isPublic?: boolean;
  canPost?: boolean;
  createdAtMs?: number;
  lastUpdatedAtMs?: number;
  limits?: ChatLimits;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface ChatMessage extends Record<string, unknown> {
  id: string;
  seq: number;
  role: ChatRole;
  roles?: string[];
  body: string;
  createdAtMs: number;
  author?: { id?: string; name?: string };
  meta?: Record<string, unknown>;
}

export interface ChatPageCursor {
  cursor: string;
}

export interface ChatFetchMessagesOptions {
  limit?: number;
  before?: ChatPageCursor;
  after?: ChatPageCursor;
}

export interface ChatFetchMessagesResult {
  messages: ChatMessage[];
  pageInfo: {
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    startCursor?: ChatPageCursor;
    endCursor?: ChatPageCursor;
  };
}

export interface ChatMessageDraft {
  chatId: string;
  messageId: string;
  meta?: Record<string, unknown>;
}

export type ChatEvent =
  | { type: "message.added"; message: ChatMessage }
  | { type: "message.updated"; message: ChatMessage }
  | { type: "message.removed"; id: string }
  | { type: "message.stream.started"; draft: ChatMessageDraft }
  | { type: "message.stream.chunk"; draft: ChatMessageDraft; chunk: string }
  | { type: "message.stream.finalized"; draft: ChatMessageDraft; message: ChatMessage };

export interface ChatAppendInput {
  role: ChatRole;
  roles?: string[];
  body: string;
  meta?: Record<string, unknown>;
}

export interface ChatBeginMessageInput {
  role: ChatRole;
  roles?: string[];
  initialBody?: string;
  meta?: Record<string, unknown>;
}

export interface ChatUpdateMyMessagePatch {
  body?: string;
  meta?: Record<string, unknown>;
}

export interface IChat {
  getDescriptor(): Promise<ChatDescriptor>;
  readonly channel: IChannel<ChatEvent>;
  fetchMessages(options?: ChatFetchMessagesOptions): Promise<ChatFetchMessagesResult>;
  append(input: ChatAppendInput): Promise<ChatMessage>;
  updateMyMessage(messageId: string, patch: ChatUpdateMyMessagePatch): Promise<ChatMessage>;
  beginMessage(input: ChatBeginMessageInput): Promise<ChatMessageDraft>;
  appendMessageChunk(draft: ChatMessageDraft, chunk: string): Promise<void>;
  finalizeMessage(draft: ChatMessageDraft): Promise<ChatMessage>;
}

export interface ChatAdapterRef {
  externalId?: string;
  source?: string;
  meta?: Record<string, unknown>;
}

export interface IChatAdapter {
  readonly name: string;
  open(ref: ChatAdapterRef): Promise<IChat>;
}

export interface ChatAdapterOptions {
  auth?: TransportAuthConfig;
  apiClient?: unknown;
  storage?: Storage;
  mode?: "dev" | "prod";
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export class InMemoryChat implements IChat {
  public readonly channel: IChannel<ChatEvent>;
  private readonly messages: ICollection<ChatMessage, string>;

  private descriptor: ChatDescriptor;
  private seq = 0;

  // Drafts are mapped to a message that gets updated in-place.
  private readonly drafts = new Map<string, { messageId: string; chunks: string[] }>();

  public constructor(init: {
    descriptor: ChatDescriptor;
    channel: IChannel<ChatEvent>;
    messages: ICollection<ChatMessage, string>;
  }) {
    this.descriptor = init.descriptor;
    this.channel = init.channel;
    this.messages = init.messages;
  }

  public async getDescriptor(): Promise<ChatDescriptor> {
    return { ...this.descriptor };
  }

  public async fetchMessages(options?: ChatFetchMessagesOptions): Promise<ChatFetchMessagesResult> {
    const limit = options?.limit ?? 100;
    const all = this.messages.list().sort((a, b) => b.seq - a.seq); // latest-first

    // Cursor scheme: we use message seq as cursor.
    const beforeSeq = options?.before ? Number(options.before.cursor) : undefined;
    const afterSeq = options?.after ? Number(options.after.cursor) : undefined;

    let filtered = all;
    if (beforeSeq !== undefined && !Number.isNaN(beforeSeq)) filtered = filtered.filter((m) => m.seq < beforeSeq);
    if (afterSeq !== undefined && !Number.isNaN(afterSeq)) filtered = filtered.filter((m) => m.seq > afterSeq);

    const slice = filtered.slice(0, limit);

    const start = slice.at(0);
    const end = slice.at(-1);

    return {
      messages: slice,
      pageInfo: {
        hasMoreBefore: filtered.length > slice.length,
        hasMoreAfter: false,
        startCursor: start ? { cursor: String(start.seq) } : undefined,
        endCursor: end ? { cursor: String(end.seq) } : undefined
      }
    };
  }

  public async append(input: ChatAppendInput): Promise<ChatMessage> {
    if (this.descriptor.canPost === false) throw new Error("Posting is not allowed for this chat");
    if (this.descriptor.limits?.maxBodyChars && input.body.length > this.descriptor.limits.maxBodyChars) {
      throw new Error(`Message body exceeds maxBodyChars=${this.descriptor.limits.maxBodyChars}`);
    }

    this.seq += 1;
    const msg: ChatMessage = {
      id: createId("msg"),
      seq: this.seq,
      role: input.role,
      roles: input.roles,
      body: input.body,
      createdAtMs: Date.now(),
      meta: input.meta
    };
    this.messages.upsert(msg);
    this.descriptor = { ...this.descriptor, lastUpdatedAtMs: msg.createdAtMs };
    await this.channel.send({ type: "message.added", message: msg });
    return msg;
  }

  public async updateMyMessage(messageId: string, patch: ChatUpdateMyMessagePatch): Promise<ChatMessage> {
    const existing = this.messages.get(messageId);
    if (!existing) throw new Error(`Message not found: ${messageId}`);
    const next: ChatMessage = { ...existing, ...patch };
    this.messages.upsert(next);
    await this.channel.send({ type: "message.updated", message: next });
    return next;
  }

  public async beginMessage(input: ChatBeginMessageInput): Promise<ChatMessageDraft> {
    const msg = await this.append({ role: input.role, roles: input.roles, body: input.initialBody ?? "", meta: input.meta });
    const draftId = createId("draft");
    this.drafts.set(draftId, { messageId: msg.id, chunks: [] });
    const draft: ChatMessageDraft = { chatId: this.descriptor.id, messageId: msg.id, meta: { draftId } };
    await this.channel.send({ type: "message.stream.started", draft });
    return draft;
  }

  public async appendMessageChunk(draft: ChatMessageDraft, chunk: string): Promise<void> {
    const draftId = String((draft.meta as any)?.draftId ?? "");
    const state = this.drafts.get(draftId);
    if (!state) throw new Error("Draft not found");
    state.chunks.push(chunk);

    const existing = this.messages.get(state.messageId);
    if (existing) {
      const next = { ...existing, body: existing.body + chunk };
      this.messages.upsert(next);
      await this.channel.send({ type: "message.stream.chunk", draft, chunk });
      await this.channel.send({ type: "message.updated", message: next });
    } else {
      await this.channel.send({ type: "message.stream.chunk", draft, chunk });
    }
  }

  public async finalizeMessage(draft: ChatMessageDraft): Promise<ChatMessage> {
    const draftId = String((draft.meta as any)?.draftId ?? "");
    const state = this.drafts.get(draftId);
    if (!state) throw new Error("Draft not found");
    this.drafts.delete(draftId);

    const msg = this.messages.get(state.messageId);
    if (!msg) throw new Error("Draft message not found");

    await this.channel.send({ type: "message.stream.finalized", draft, message: msg });
    return msg;
  }
}

export class InMemoryChatAdapter implements IChatAdapter {
  public readonly name = "InMemoryChatAdapter";

  private readonly channels: ChannelFactory;
  private readonly collections: CollectionFactory;

  public constructor(_options?: ChatAdapterOptions) {
    this.channels = new ChannelFactory();
    this.collections = new CollectionFactory();
  }

  public async open(ref: ChatAdapterRef): Promise<IChat> {
    const chatId = ref.externalId ?? createId("chat");
    const channel = this.channels.create<ChatEvent>({ id: `chat:${chatId}` });
    const messages = this.collections.create<ChatMessage, string>({
      name: `chat:${chatId}:messages`,
      keyField: "id",
      autoKey: true
    });

    const descriptor: ChatDescriptor = {
      id: chatId,
      externalId: ref.externalId,
      source: ref.source,
      adapter: this.name,
      canPost: true,
      createdAtMs: Date.now(),
      lastUpdatedAtMs: Date.now()
    };

    return new InMemoryChat({ descriptor, channel, messages });
  }
}

