/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STC type aggregator.
 *
 * The individual spec files under `src/types/*.d.ts` export `namespace STC`,
 * but each file is its own module. This file stitches them into a single importable
 * surface so implementations can type against a unified `STC` shape.
 */
import type { STC as ChannelSTC } from "./channel.js";
import type { STC as CollectionSTC } from "./collection.js";
import type { STC as ChatSTC } from "./chat.js";
import type { STC as TransportSTC } from "./transport.js";
import type { STC as ApiClientSTC } from "./api-client.js";
import type { STC as ApiHostSTC } from "./api-host.js";
import type { STC as DiagnosticsSTC } from "./diagnostic.js";
import type { STC as RuntimeSTC } from "./runtime.js";
import type { STC as WorkbenchSTC } from "./workbench.js";
import type { STC as PolicySTC } from "./policy.js";
import type { STC as DocsSTC } from "./docs.js";
import type { STC as StorageSTC } from "./storage.js";
import type { STC as FSSTC } from "./fs.js";

export declare namespace STC {
  export import Channel = ChannelSTC.Channel;
  export import Collection = CollectionSTC.Collection;
  export import Chat = ChatSTC.Chat;
  export import Transport = TransportSTC.Transport;
  export import ApiClient = ApiClientSTC.ApiClient;
  export import ApiHost = ApiHostSTC.ApiHost;
  export import Diagnostics = DiagnosticsSTC.Diagnostics;
  export import Runtime = RuntimeSTC.Runtime;
  export import Workbench = WorkbenchSTC.Workbench;
  export import Policy = PolicySTC.Policy;
  export import Docs = DocsSTC.Docs;
  export import Storage = StorageSTC.Storage;
  export import FS = FSSTC.FS;
}

