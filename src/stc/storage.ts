import { NodeFS, type IFS } from "./fs.js";

export class Storage {
  public readonly workspace?: string;
  public readonly fs: IFS;

  public constructor(init?: { workspace?: string; fs?: IFS }) {
    this.workspace = init?.workspace;
    this.fs = init?.fs ?? new NodeFS();
  }
}

