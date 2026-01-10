import type { STC } from "../../types/light/stc.js";
import { ChannelFactory, type ChannelMeta } from "./channel.js";

export type ChatMeta<M extends Record<string, unknown> = Record<string, unknown>> = STC.Chat.Meta<M>;
export type ChatRole = STC.Chat.Role;
export type ChatType = STC.Chat.ChatType;
export type ChatLimits = STC.Chat.Limits;
export type ChatDescriptor<M extends ChatMeta = ChatMeta> = STC.Chat.Descriptor<M>;
export type ChatMessage<M extends ChatMeta = ChatMeta> = STC.Chat.Message<M>;
export type ChatCursor = STC.Chat.Cursor;
export type ChatFetchOptions = STC.Chat.FetchOptions;
export type ChatFetchResult<M extends ChatMeta = ChatMeta> = STC.Chat.FetchResult<M>;
export type ChatAppendInput<M extends ChatMeta = ChatMeta> = STC.Chat.AppendInput<M>;
export type IChat<M extends ChatMeta = ChatMeta> = STC.Chat.Chat<M>;

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function encodeCursor(seq: number): ChatCursor {
  return { cursor: `${seq}` };
}

function decodeCursor(c: ChatCursor): number | undefined {
  const n = Number(c.cursor);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

export class InMemoryChat<M extends ChatMeta = ChatMeta> implements IChat<M> {
  public readonly channel: STC.Channel.Channel<
    {
      type: string;
      payload?: unknown;
      meta?: M;
    },
    M
  >;

  private readonly descriptor: ChatDescriptor<M>;
  private readonly messages: ChatMessage<M>[] = [];
  private seq = 0;

  public constructor(init: {
    descriptor: ChatDescriptor<M>;
    channel?: STC.Channel.Channel<{ type: string; payload?: unknown; meta?: M }, M>;
    channelMeta?: ChannelMeta;
    caps?: { canRead?: boolean; canWrite?: boolean };
  }) {
    this.descriptor = init.descriptor;
    this.channel =
      init.channel ??
      new ChannelFactory().create({
        id: `chat.${init.descriptor.id}`,
        meta: (init.channelMeta as any) ?? (init.descriptor.meta as any),
        caps: { canRead: init.caps?.canRead ?? true, canWrite: init.caps?.canWrite ?? true }
      });
  }

  public async getDescriptor(): Promise<ChatDescriptor<M>> {
    return { ...this.descriptor, meta: this.descriptor.meta };
  }

  public async fetchMessages(options?: ChatFetchOptions): Promise<ChatFetchResult<M>> {
    const max = options?.limit ?? this.descriptor.limits?.maxMessages ?? 50;
    const beforeSeq = options?.before ? decodeCursor(options.before) : undefined;

    const eligible = beforeSeq === undefined ? this.messages : this.messages.filter((m) => m.seq < beforeSeq);
    const newestFirst = [...eligible].sort((a, b) => b.seq - a.seq);

    const slice = newestFirst.slice(0, Math.max(0, max));
    const hasMore = newestFirst.length > slice.length;
    const next = hasMore && slice.length > 0 ? encodeCursor(slice[slice.length - 1]!.seq) : undefined;

    return {
      messages: slice,
      page: hasMore ? { hasMore: true, next } : { hasMore: false },
      meta: this.descriptor.meta
    };
  }

  public async append(input: ChatAppendInput<M>): Promise<ChatMessage<M>> {
    this.seq += 1;
    const msg: ChatMessage<M> = {
      id: createId("msg"),
      seq: this.seq,
      role: input.role,
      body: input.body,
      ts: new Date().toISOString(),
      meta: input.meta
    };
    this.messages.push(msg);

    this.channel.send({ type: "chat.message.appended", payload: msg, meta: input.meta }, input.meta);
    return msg;
  }

  public async updateMyMessage(messageId: string, patch: { body?: string; meta?: M }): Promise<ChatMessage<M>> {
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error(`Message not found: ${messageId}`);

    const prev = this.messages[idx]!;
    const next: ChatMessage<M> = {
      ...prev,
      body: patch.body ?? prev.body,
      meta: patch.meta ?? prev.meta,
      ts: new Date().toISOString()
    };
    this.messages[idx] = next;

    this.channel.send({ type: "chat.message.updated", payload: next, meta: patch.meta }, patch.meta);
    return next;
  }
}

