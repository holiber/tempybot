export type Slash =
  | { cmd: "status" }
  | { cmd: "epic_run"; epic?: number }
  | { cmd: "finish"; epic?: number }
  | { cmd: "unknown"; raw: string };

/**
 * Parent issue (#109) standardizes on a single `/go` command that authorizes execution.
 *
 * We support:
 * - /go status
 * - /go epic run [#<n>]
 * - /go epic finish [#<n>]
 */
export function parseAuthorizedSlashFromComment(body: string): Slash | null {
  const lines = String(body ?? "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/(?:^|\s)\/go\b([^\r\n]*)/i);
    if (!m) continue;
    const rest = (m[1] ?? "").trim();
    if (!rest) return { cmd: "unknown", raw: "/go" };

    const txt = rest.toLowerCase();
    if (txt === "status") return { cmd: "status" };

    if (txt.startsWith("epic run")) {
      const mm = rest.match(/epic\s+run\s*(?:#?(\d+))?/i);
      const epic = mm?.[1] ? Number(mm[1]) : undefined;
      return { cmd: "epic_run", ...(Number.isFinite(epic) ? { epic } : {}) };
    }

    if (txt.startsWith("epic finish")) {
      const mm = rest.match(/epic\s+finish\s*(?:#?(\d+))?/i);
      const epic = mm?.[1] ? Number(mm[1]) : undefined;
      return { cmd: "finish", ...(Number.isFinite(epic) ? { epic } : {}) };
    }

    return { cmd: "unknown", raw: `/go ${rest}` };
  }
  return null;
}

