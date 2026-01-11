import { err, ok, type ToolResult } from "./result.js";

export class CursorCloudTool {
  public constructor(private cfg: { apiKey: string }) {}

  private async api(path: string, init?: RequestInit): Promise<Response> {
    const base = "https://api.cursor.com";
    return await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  private async readTextSafe(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }

  public async listAgents(limit = 20): Promise<ToolResult<{ agents: unknown[] }>> {
    const lim = Math.min(100, Math.max(1, Number(limit) || 20));
    try {
      const res = await this.api(`/v0/agents?limit=${lim}`, { method: "GET" });
      if (!res.ok) {
        const txt = await this.readTextSafe(res);
        return err({
          retryable: res.status >= 500 || res.status === 429,
          code: `cursor_${res.status}`,
          message: txt || `Cursor listAgents failed (status=${res.status})`,
        });
      }
      const data = (await res.json()) as any;
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      return ok({ agents });
    } catch (e) {
      return err({ retryable: true, code: "cursor_network", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

