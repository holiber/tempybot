import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";

export interface IFS {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, options?: { overwrite?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; mtimeMs?: number }>;
  join(...parts: string[]): string;
}

export class NodeFS implements IFS {
  public async readFile(path: string, encoding: BufferEncoding = "utf8"): Promise<string> {
    return await nodeFs.readFile(path, { encoding });
  }

  public async writeFile(path: string, data: string, options?: { overwrite?: boolean }): Promise<void> {
    if (options?.overwrite === false) {
      try {
        await nodeFs.stat(path);
        throw new Error(`File already exists: ${path}`);
      } catch {
        // ok
      }
    }
    await nodeFs.mkdir(nodePath.dirname(path), { recursive: true });
    await nodeFs.writeFile(path, data, { encoding: "utf8" });
  }

  public async readdir(path: string): Promise<string[]> {
    return await nodeFs.readdir(path);
  }

  public async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; mtimeMs?: number }> {
    const s = await nodeFs.stat(path);
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs };
  }

  public join(...parts: string[]): string {
    return nodePath.join(...parts);
  }
}

