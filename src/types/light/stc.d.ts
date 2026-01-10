/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Light STC type aggregator.
 *
 * The individual light spec files under `src/types/light/*.d.ts` export `namespace STC`,
 * but each file is its own module. This file stitches them into a single importable
 * surface so implementations can type against a unified `STC` shape.
 */
import type { STC as ChannelSTC } from "./channel.js";
import type { STC as CollectionSTC } from "./collection.js";
import type { STC as ChatSTC } from "./chat.js";
import type { STC as TransportSTC } from "./transport.js";
import type { STC as CerebellumSTC } from "./cerebellum.js";
import type { STC as ApiClientSTC } from "../api-client.js";
import type { STC as DiagnosticsSTC } from "../diagnostic.js";

export declare namespace STC {
  export import Channel = ChannelSTC.Channel;
  export import Collection = CollectionSTC.Collection;
  export import Chat = ChatSTC.Chat;
  export import Transport = TransportSTC.Transport;
  export import World = CerebellumSTC.World;

  // Cross-spec dependencies referenced by light specs.
  export import ApiClient = ApiClientSTC.ApiClient;
  export import Diagnostics = DiagnosticsSTC.Diagnostics;
}

