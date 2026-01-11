import { err, ok, type ToolResult } from "./result.js";

export class GitHubTool {
  public constructor(private cfg: { token: string; repo: string }) {}

  private async api(path: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith("http://") || path.startsWith("https://") ? path : `https://api.github.com${path}`;
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
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

  public async createComment(issueNumber: number, body: string): Promise<ToolResult<{ id: number }>> {
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return err({ retryable: false, code: "gh_bad_args", message: "issueNumber must be a positive number." });
    }
    try {
      const res = await this.api(`/repos/${this.cfg.repo}/issues/${issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const txt = await this.readTextSafe(res);
        return err({
          retryable: res.status >= 500 || res.status === 429,
          code: `gh_${res.status}`,
          message: txt || `GitHub createComment failed (status=${res.status})`,
        });
      }
      const data = (await res.json()) as any;
      const id = Number(data?.id);
      if (!Number.isFinite(id) || id <= 0) return err({ retryable: false, code: "gh_bad_response", message: "Missing id in response." });
      return ok({ id });
    } catch (e) {
      return err({ retryable: true, code: "gh_network", message: e instanceof Error ? e.message : String(e) });
    }
  }

  public async addLabels(issueNumber: number, labels: string[]): Promise<ToolResult<{}>> {
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return err({ retryable: false, code: "gh_bad_args", message: "issueNumber must be a positive number." });
    }
    const clean = (labels ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (!clean.length) return ok({});
    try {
      const res = await this.api(`/repos/${this.cfg.repo}/issues/${issueNumber}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: clean }),
      });
      if (!res.ok) {
        const txt = await this.readTextSafe(res);
        return err({
          retryable: res.status >= 500 || res.status === 429,
          code: `gh_${res.status}`,
          message: txt || `GitHub addLabels failed (status=${res.status})`,
        });
      }
      return ok({});
    } catch (e) {
      return err({ retryable: true, code: "gh_network", message: e instanceof Error ? e.message : String(e) });
    }
  }

  public async removeLabel(issueNumber: number, label: string): Promise<ToolResult<{}>> {
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return err({ retryable: false, code: "gh_bad_args", message: "issueNumber must be a positive number." });
    }
    const clean = String(label ?? "").trim();
    if (!clean) return ok({});
    try {
      const res = await this.api(`/repos/${this.cfg.repo}/issues/${issueNumber}/labels/${encodeURIComponent(clean)}`, {
        method: "DELETE",
      });
      // GitHub returns 404 when label is absent; treat as idempotent success.
      if (!res.ok && res.status !== 404) {
        const txt = await this.readTextSafe(res);
        return err({
          retryable: res.status >= 500 || res.status === 429,
          code: `gh_${res.status}`,
          message: txt || `GitHub removeLabel failed (status=${res.status})`,
        });
      }
      return ok({});
    } catch (e) {
      return err({ retryable: true, code: "gh_network", message: e instanceof Error ? e.message : String(e) });
    }
  }

  public async listIssuesByLabel(label: string, limit = 20): Promise<ToolResult<{ numbers: number[] }>> {
    const clean = String(label ?? "").trim();
    if (!clean) return err({ retryable: false, code: "gh_bad_args", message: "label is required." });
    const perPage = Math.min(100, Math.max(1, Number(limit) || 20));
    try {
      const res = await this.api(
        `/repos/${this.cfg.repo}/issues?state=open&labels=${encodeURIComponent(clean)}&per_page=${perPage}`
      );
      if (!res.ok) {
        const txt = await this.readTextSafe(res);
        return err({
          retryable: res.status >= 500 || res.status === 429,
          code: `gh_${res.status}`,
          message: txt || `GitHub listIssuesByLabel failed (status=${res.status})`,
        });
      }
      const arr = (await res.json()) as any[];
      const numbers = (Array.isArray(arr) ? arr : [])
        .map((x) => Number(x?.number))
        .filter((n) => Number.isFinite(n) && n > 0);
      return ok({ numbers });
    } catch (e) {
      return err({ retryable: true, code: "gh_network", message: e instanceof Error ? e.message : String(e) });
    }
  }

  public async getIssue(issueNumber: number): Promise<ToolResult<{ title: string; body: string; labels: string[] }>> {
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return err({ retryable: false, code: "gh_bad_args", message: "issueNumber must be a positive number." });
    }
    try {
      const res = await this.api(`/repos/${this.cfg.repo}/issues/${issueNumber}`, { method: "GET" });
      if (!res.ok) {
        const txt = await this.readTextSafe(res);
        return err({
          retryable: res.status >= 500 || res.status === 429,
          code: `gh_${res.status}`,
          message: txt || `GitHub getIssue failed (status=${res.status})`,
        });
      }
      const data = (await res.json()) as any;
      const labels = Array.isArray(data?.labels)
        ? data.labels.map((l: any) => String(l?.name ?? "").trim()).filter(Boolean)
        : [];
      return ok({ title: String(data?.title ?? ""), body: String(data?.body ?? ""), labels });
    } catch (e) {
      return err({ retryable: true, code: "gh_network", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

