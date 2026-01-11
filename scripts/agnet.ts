import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { Cerebellum, type CerebellumToolRequest, executeGh, executeMcpCall } from "../src/agnet/cerebellum.ts";
import { runSelfCheck } from "../src/agnet/self-check.ts";
import { CollectionFactory } from "../src/stc/light/collection.ts";
import { InMemoryChat } from "../src/stc/light/chat.ts";
import type { STC } from "../src/types/light/stc.js";

type OutputMode = "text" | "json";

type WorldItemMeta = {
  repo: string;
  issueNumber: number;
  commentId: number;
  author: string;
  body: string;
  url: string;
  updatedAt: string;
};

type WorldItem = STC.World.Item<Record<string, unknown>> & { kind: "comment"; meta: WorldItemMeta };
type WorldSnapshot = STC.World.World<Record<string, unknown>> & { items: Array<WorldItem> };

type SlashCommand = {
  agent: "myagent";
  name: string;
  args: string[];
  raw: string;
  commentId: number;
  itemId: string;
  repo: string;
  issueNumber: number;
  url: string;
};

type ToolEvent =
  | { type: "tool.request"; request: CerebellumToolRequest; intention?: string }
  | { type: "tool.result"; request: CerebellumToolRequest; ok: boolean; blocked?: boolean; errorMessage?: string };

function parseMyAgentSlashCommand(body: string): { name: string; args: string[]; raw: string } | null {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/(?:^|\s)\/myagent\b([^\r\n]*)/i);
    if (!m) continue;
    const rest = (m[1] ?? "").trim();
    if (!rest) continue; // require `/myagent <command>`
    const parts = rest.split(/\s+/).filter(Boolean);
    const name = (parts[0] ?? "").trim().toLowerCase();
    if (!name) continue;
    const args = parts.slice(1);
    return { name, args, raw: `/myagent ${rest}` };
  }
  return null;
}

function mainHelpText(): string {
  const text = `
agnet.ts --templates <path> doctor
agnet.ts --templates <path> run --world
agnet.ts interactive
agnet.ts tools
agnet.ts selfcheck

Global flags:
  --templates <path>   Agent template file (.agent.md) or directory (loads **/*.agent.md)
  --json               JSON output

Examples:
  node scripts/agnet.ts --templates agents/repoboss.agent.md doctor
  node scripts/agnet.ts --templates agents/repoboss.agent.md run --world
  node scripts/agnet.ts interactive
  node scripts/agnet.ts --json selfcheck
`.trim();
  return text;
}

function toolsHelpText(): string {
  const text = `
agnet.ts tools

Tier 1 tools:
  agnet.ts tools gh "<command...>"
    - Fixture mode: set AGNET_GH_FIXTURE_CMD=<path> to print canned stdout.
  agnet.ts tools mcp call <method> --args <json> --spec <openapi.yml>
    - Fixture mode: set AGNET_MCP_FIXTURE_PATH=<path> to print canned response.
`.trim();
  return text;
}

function runHelpText(): string {
  const text = `
agnet.ts --templates <path> run --world

Flags:
  --world   Build STC.World snapshot (GitHub issue comments)
`.trim();
  return text;
}

function interactiveHelpText(): string {
  return `
Interactive mode:
  agnet.ts interactive

Commands:
  /tool random      Generate a random number in [0..1000] and store it in chat history
  /history          Print last messages (debug)
  /exit             Exit interactive mode

Notes:
  - "memory" is implemented via chat history (the agent recalls the last tool result from stored messages)
`.trim();
}

function normalizePosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

function toRelPath(p: string, cwd: string): string {
  const rel = path.relative(cwd, p);
  // Keep output stable across platforms.
  return normalizePosixPath(rel || ".");
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function outputMode(argv: string[]): OutputMode {
  return hasFlag(argv, "--json") ? "json" : "text";
}

function printHelp(mode: OutputMode, help: { command: string; text: string }): void {
  if (mode === "json") {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, command: help.command, help: help.text }, null, 2));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(help.text);
}

function printError(mode: OutputMode, error: { command?: string; message: string; helpText?: string }): void {
  if (mode === "json") {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: false,
          ...(error.command ? { command: error.command } : {}),
          error: { message: error.message },
          ...(error.helpText ? { help: error.helpText } : {}),
        },
        null,
        2
      )
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.error(error.message);
}

function getFlagValues(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === name) {
      const v = argv[i + 1];
      if (v && !v.startsWith("-")) out.push(v);
      i++;
    }
  }
  return out;
}

function stripGlobalFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--templates") {
      i++; // skip value
      continue;
    }
    if (a === "--json") continue;
    if (a === "-h" || a === "--help") continue;
    out.push(a);
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function statSafe(p: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

async function readJsonFile<T>(p: string): Promise<T> {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as T;
}

async function persistGhFailure(args: string[], res: { status: number | null; stdout?: string | null; stderr?: string | null }): Promise<string> {
  const cwd = process.cwd();
  const outPath = path.join(cwd, ".agnet", "gh-last-error.json");
  await ensureDir(path.dirname(outPath));
  const payload = {
    ts: new Date().toISOString(),
    cmd: "gh",
    args,
    exitCode: res.status ?? null,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? ""
  };
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return toRelPath(outPath, cwd);
}

async function ghJson(args: string[]): Promise<unknown> {
  const r = spawnSync("gh", args, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
  if ((r.status ?? 1) !== 0) {
    const rel = await persistGhFailure(args, r);
    throw new Error(`gh failed (exit=${r.status ?? "unknown"}). See: ${rel}`);
  }
  const raw = (r.stdout ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from gh output: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

async function ghText(args: string[]): Promise<string> {
  const r = spawnSync("gh", args, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if ((r.status ?? 1) !== 0) {
    const rel = await persistGhFailure(args, r);
    throw new Error(`gh failed (exit=${r.status ?? "unknown"}). See: ${rel}`);
  }
  return (r.stdout ?? "").trim();
}

function parseIssueListEnv(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const nums = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? nums : null;
}

async function loadGhIssueCommentsFromFixture(fixturePath: string, cwd: string): Promise<WorldItemMeta[]> {
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.resolve(cwd, fixturePath);
  const data = await readJsonFile<any>(abs);

  const repo = typeof data?.repo === "string" && data.repo.trim() ? data.repo.trim() : "unknown/unknown";
  const comments = Array.isArray(data?.comments) ? data.comments : Array.isArray(data) ? data : null;
  if (!comments) {
    throw new Error(`Invalid GitHub fixture JSON (expected { repo, comments: [...] } or [...]).`);
  }

  const out: WorldItemMeta[] = [];
  for (const c of comments) {
    const issueNumber = Number(c?.issueNumber);
    const commentId = Number(c?.commentId ?? c?.id);
    const author = String(c?.author ?? c?.user ?? c?.user?.login ?? "");
    const body = String(c?.body ?? "");
    const url = String(c?.url ?? c?.html_url ?? "");
    const updatedAt = String(c?.updatedAt ?? c?.updated_at ?? "");

    if (!Number.isFinite(issueNumber) || issueNumber <= 0) continue;
    if (!Number.isFinite(commentId) || commentId <= 0) continue;
    if (!author) continue;
    if (!url) continue;
    if (!updatedAt) continue;

    out.push({ repo, issueNumber, commentId, author, body, url, updatedAt });
  }

  return out;
}

async function loadGhIssueCommentsViaGh(cwd: string): Promise<WorldItemMeta[]> {
  const repo =
    readEnv("AGNET_GH_REPO") ??
    (await ghText(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]));
  const issueNumbers =
    parseIssueListEnv(readEnv("AGNET_GH_ISSUES")) ??
    (await (async () => {
      // NOTE: `--jq` makes stdout a plain newline-separated list of numbers.
      const raw = await ghText(["issue", "list", "--limit", "20", "--json", "number", "--jq", ".[].number"]);
      return raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0);
    })());

  const out: WorldItemMeta[] = [];
  for (const issueNumber of issueNumbers) {
    const arr = await ghJson(["api", `repos/${repo}/issues/${issueNumber}/comments`]);
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      const commentId = Number((c as any)?.id);
      const author = String((c as any)?.user?.login ?? "");
      const body = String((c as any)?.body ?? "");
      const url = String((c as any)?.html_url ?? "");
      const updatedAt = String((c as any)?.updated_at ?? "");

      if (!Number.isFinite(commentId) || commentId <= 0) continue;
      if (!author) continue;
      if (!url) continue;
      if (!updatedAt) continue;

      out.push({ repo, issueNumber, commentId, author, body, url, updatedAt });
    }
  }

  return out;
}

function toWorldItem(meta: WorldItemMeta): WorldItem {
  return {
    id: `${meta.repo}#${meta.issueNumber}/comment/${meta.commentId}`,
    kind: "comment",
    summary: `@${meta.author} on #${meta.issueNumber}`,
    meta
  };
}

type IdempotencyRecord = { id: string; seenAt: string };

async function loadIdempotencyStore(cwd: string): Promise<{
  path: string;
  seen: { has(key: string): boolean; upsert(record: IdempotencyRecord, key?: string): unknown; list(): IdempotencyRecord[] };
  source: "file" | "empty";
}> {
  const p = readEnv("AGNET_IDEMPOTENCY_PATH") ?? path.join(cwd, ".agnet", "cache.json");
  const seen = new CollectionFactory().create<IdempotencyRecord, string>({ name: "gh.commentIdempotency", keyField: "id" });

  try {
    const data = await readJsonFile<any>(p);
    const arr = Array.isArray(data?.seen) ? data.seen : Array.isArray(data) ? data : [];
    for (const r of arr) {
      const id = typeof r?.id === "string" ? r.id : null;
      const seenAt = typeof r?.seenAt === "string" ? r.seenAt : null;
      if (!id || !seenAt) continue;
      seen.upsert({ id, seenAt }, id);
    }
    return { path: p, seen, source: "file" };
  } catch {
    return { path: p, seen, source: "empty" };
  }
}

async function persistIdempotencyStore(store: { path: string; seen: { list(): IdempotencyRecord[] } }): Promise<void> {
  await ensureDir(path.dirname(store.path));
  const data = { version: 1, seen: store.seen.list() };
  await fs.writeFile(store.path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function buildWorldSnapshot(cwd: string): Promise<WorldSnapshot> {
  const fixturePath = readEnv("AGNET_GH_FIXTURE_PATH");
  const metas = fixturePath
    ? await loadGhIssueCommentsFromFixture(fixturePath, cwd)
    : await loadGhIssueCommentsViaGh(cwd);

  // Deterministic ordering.
  metas.sort((a, b) => {
    if (a.repo !== b.repo) return a.repo.localeCompare(b.repo);
    if (a.issueNumber !== b.issueNumber) return a.issueNumber - b.issueNumber;
    return a.commentId - b.commentId;
  });

  const items = metas.map(toWorldItem);
  return {
    items,
    ts: new Date().toISOString(),
    meta: {
      repo: metas[0]?.repo ?? (fixturePath ? "unknown/unknown" : readEnv("AGNET_GH_REPO") ?? "unknown/unknown"),
      source: fixturePath ? "fixture" : "gh"
    }
  };
}

async function transpileTsToJsFile(opts: { inPath: string; outPath: string }): Promise<void> {
  const tsMod = await import("typescript");
  // In some Node/CJS interop modes, TypeScript is only available under `default`.
  const ts: typeof import("typescript") = ((tsMod as unknown as { default?: unknown }).default ??
    tsMod) as typeof import("typescript");
  const source = await fs.readFile(opts.inPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: false,
      inlineSources: false,
    },
    fileName: opts.inPath,
  });
  await ensureDir(path.dirname(opts.outPath));
  await fs.writeFile(opts.outPath, transpiled.outputText, "utf8");
}

async function ensureAgentParserBuilt(cwd: string): Promise<string> {
  // We cannot import from /src directly because Node's TS runtime does not
  // resolve `./types.js` -> `./types.ts`. Instead, we transpile just the needed
  // modules into a small cache and import the JS output.
  const cacheRoot = path.join(cwd, ".cache", "agnet-ts-runtime");
  const candidates: Array<{ name: string; srcRoot: string }> = [
    { name: "md-parser", srcRoot: path.join(cwd, "src", "md-parser") },
    { name: "agent", srcRoot: path.join(cwd, "src", "agent") },
  ];

  const resolved = await (async () => {
    for (const c of candidates) {
      const typesIn = path.join(c.srcRoot, "types.ts");
      const parserIn = path.join(c.srcRoot, "parse-agent-md.ts");
      const typesInStat = await statSafe(typesIn);
      const parserInStat = await statSafe(parserIn);
      if (typesInStat && parserInStat) return { ...c, typesIn, parserIn, typesInStat, parserInStat };
    }
    return null;
  })();

  if (!resolved) {
    throw new Error(`Internal parser sources not found under src/md-parser or src/agent.`);
  }

  const outRoot = path.join(cacheRoot, resolved.name);
  const typesOut = path.join(outRoot, "types.js");
  const parserOut = path.join(outRoot, "parse-agent-md.js");

  const typesOutStat = await statSafe(typesOut);
  const parserOutStat = await statSafe(parserOut);

  const needsTypes = !typesOutStat || typesOutStat.mtimeMs < resolved.typesInStat.mtimeMs;
  const needsParser = !parserOutStat || parserOutStat.mtimeMs < resolved.parserInStat.mtimeMs;

  if (needsTypes) await transpileTsToJsFile({ inPath: resolved.typesIn, outPath: typesOut });
  if (needsParser) await transpileTsToJsFile({ inPath: resolved.parserIn, outPath: parserOut });

  return parserOut;
}

async function loadAgentParser(cwd: string): Promise<{ parseAgentMd: (p: string) => Promise<unknown> }> {
  const parserPath = await ensureAgentParserBuilt(cwd);
  const modUrl = pathToFileURL(parserPath).href;
  const mod = await import(modUrl);
  const parseAgentMd = mod?.parseAgentMd;
  if (typeof parseAgentMd !== "function") {
    throw new Error(`Internal parser export not found (expected parseAgentMd()).`);
  }
  return { parseAgentMd };
}

async function resolveTemplateFiles(raw: string[], cwd: string): Promise<string[]> {
  const absInputs = raw.map((p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p)));
  const out: string[] = [];

  // Fast path: single file input.
  if (absInputs.length === 1) {
    const st = await statSafe(absInputs[0]!);
    if (!st) return [];
    if (st.isFile()) return [absInputs[0]!];
  }

  const fg = (await import("fast-glob")).default;

  for (const abs of absInputs) {
    const st = await statSafe(abs);
    if (!st) continue;
    if (st.isFile()) {
      out.push(abs);
      continue;
    }
    if (st.isDirectory()) {
      const files = await fg("**/*.agent.md", { cwd: abs, absolute: true, onlyFiles: true, dot: false });
      out.push(...files);
      continue;
    }
  }

  // Deterministic ordering.
  return out.sort((a, b) => toRelPath(a, cwd).localeCompare(toRelPath(b, cwd)));
}

async function loadTemplates(opts: { templates: string[]; cwd: string }): Promise<{ files: string[] }> {
  if (!opts.templates.length) {
    throw new Error(`Missing required flag: --templates <path>`);
  }

  // Validate user-provided paths exist (and fail nicely).
  for (const p of opts.templates) {
    const abs = path.isAbsolute(p) ? p : path.resolve(opts.cwd, p);
    if (!(await fileExists(abs))) {
      throw new Error(`--templates path not found: ${toRelPath(abs, opts.cwd)}`);
    }
  }

  const files = await resolveTemplateFiles(opts.templates, opts.cwd);
  if (!files.length) {
    throw new Error(`--templates did not resolve any *.agent.md files.`);
  }
  return { files };
}

async function cmdDoctor(opts: { templates: string[]; cwd: string; mode: OutputMode }): Promise<number> {
  const { files } = await loadTemplates(opts);
  const { parseAgentMd } = await loadAgentParser(opts.cwd);

  // Parse to validate.
  for (const f of files) await parseAgentMd(f);

  if (opts.mode === "json") {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          command: "doctor",
          templatesLoaded: files.length,
          templates: files.map((f) => toRelPath(f, opts.cwd)),
        },
        null,
        2
      )
    );
    return 0;
  }

  // eslint-disable-next-line no-console
  console.log("Doctor");
  // eslint-disable-next-line no-console
  console.log(`Templates loaded: ${files.length}`);
  for (const f of files) {
    // eslint-disable-next-line no-console
    console.log(`- ${toRelPath(f, opts.cwd)}`);
  }
  return 0;
}

async function cmdRun(opts: {
  templates: string[];
  cwd: string;
  argv: string[];
  mode: OutputMode;
}): Promise<number> {
  const wantWorld = hasFlag(opts.argv, "--world");
  if (!wantWorld) {
    if (opts.mode === "json") {
      printError(opts.mode, { command: "run", message: "Missing required flag: --world", helpText: runHelpText() });
      return 2;
    }
    // eslint-disable-next-line no-console
    console.log(runHelpText());
    return 2;
  }

  const { files } = await loadTemplates({ templates: opts.templates, cwd: opts.cwd });
  const { parseAgentMd } = await loadAgentParser(opts.cwd);

  // Parse to validate.
  for (const f of files) await parseAgentMd(f);

  const store = await loadIdempotencyStore(opts.cwd);
  const world = await buildWorldSnapshot(opts.cwd);

  const logs: string[] = [];
  const toolEvents: ToolEvent[] = [];
  const cerebellum = new Cerebellum<{
    world: WorldSnapshot;
    idempotency: typeof store;
    logs: string[];
    toolEvents: ToolEvent[];
    cerebellum: Cerebellum<any>;
  }>();

  // Collect channel logs into ctx.logs for deterministic CLI output.
  cerebellum.channel.subscribe((evt: any) => {
    if (evt?.kind !== "data") return;
    const data = evt.data;
    if (data?.type === "log") {
      const msg = String(data?.payload?.message ?? "").trim();
      if (msg) logs.push(msg);
      return;
    }
    if (data?.type === "tool.request") {
      const req = data?.payload?.request as CerebellumToolRequest | undefined;
      if (!req) return;
      toolEvents.push({ type: "tool.request", request: req, intention: data?.payload?.intention });
      return;
    }
    if (data?.type === "tool.result") {
      const req = data?.payload?.request as CerebellumToolRequest | undefined;
      const res = data?.payload?.result as any;
      if (!req || !res) return;
      toolEvents.push({
        type: "tool.result",
        request: req,
        ok: Boolean(res?.ok),
        blocked: res?.blocked ? true : undefined,
        errorMessage: typeof res?.error?.message === "string" ? res.error.message : undefined,
      });
    }
  });

  const ctx = { world, idempotency: store, logs, toolEvents, cerebellum };
  cerebellum.worldSnapshot(world);

  // Default wake hook: detect `/myagent <command> [args...]` in new comments with idempotency.
  cerebellum.on("wake", (evt, ctx) => {
    let found: SlashCommand | null = null;

    for (const it of ctx.world.items) {
      if (it.kind !== "comment") continue;
      const meta = it.meta;
      const parsed = parseMyAgentSlashCommand(meta.body);
      if (!parsed) continue;

      if (ctx.idempotency.seen.has(it.id)) {
        ctx.logs.push(`Already processed: ${it.id}`);
        continue;
      }

      found = {
        agent: "myagent",
        name: parsed.name,
        args: parsed.args,
        raw: parsed.raw,
        commentId: meta.commentId,
        itemId: it.id,
        repo: meta.repo,
        issueNumber: meta.issueNumber,
        url: meta.url,
      };
      break;
    }

    if (!found) return null; // swallow: nothing to do

    ctx.logs.push(`Found command: ${found.name}`);
    return {
      ...evt,
      meta: { ...(evt.meta ?? {}), command: found },
    };
  });

  // Safety hook: block agent gh tool calls unless an intention is explicitly provided.
  cerebellum.on("tool.request", (evt, ctx) => {
    const p: any = evt.payload;
    const req = p?.request;
    const actor = p?.actor;
    const intention = p?.intention;
    if (req?.tool === "gh" && actor?.role === "agent" && !intention) {
      cerebellum.log(`Blocked gh tool call (missing intention).`);
      return null;
    }
  });

  const wake = await cerebellum.dispatch({ type: "wake", payload: { world } }, ctx);

  const cmd = (wake?.meta as any)?.command as SlashCommand | undefined;
  const message = cmd ? `Found command: ${cmd.name}` : "Nothing to do";

  async function markProcessed(commentItemId: string): Promise<void> {
    ctx.idempotency.seen.upsert({ id: commentItemId, seenAt: ctx.world.ts }, commentItemId);
    await persistIdempotencyStore(store);
  }

  function parseJsonMaybe(raw: string): unknown | null {
    const txt = String(raw ?? "").trim();
    if (!txt) return null;
    try {
      return JSON.parse(txt) as unknown;
    } catch {
      return null;
    }
  }

  async function postIssueComment(args: { repo: string; issueNumber: number; body: string; intention: string }): Promise<boolean> {
    const toolReq: CerebellumToolRequest = {
      tool: "gh",
      args: ["issue", "comment", String(args.issueNumber), "-R", args.repo, "--body", args.body],
    };
    const exec = await cerebellum.executeTool(toolReq, { actor: { role: "agent" }, intention: args.intention, ctx });
    if (!exec.result.ok) {
      cerebellum.log(`Failed to post GitHub comment: ${exec.result.error.message}`, "error");
      return false;
    }
    return true;
  }

  async function startCursorJob(cmd: SlashCommand): Promise<{ ok: true; jobId: string } | { ok: false; message: string }> {
    const toolReq: CerebellumToolRequest = {
      tool: "mcp",
      method: "cursor.jobs.create",
      args: { source: "agnet.ts", command: cmd.raw, repo: cmd.repo, issueNumber: cmd.issueNumber, commentId: cmd.commentId },
      specPath: "fixtures/cursor.openapi.yml",
    };
    const exec = await cerebellum.executeTool(toolReq, { actor: { role: "agent" }, intention: "Start Cursor job for /myagent resolve", ctx });
    if (!exec.result.ok) {
      return { ok: false, message: exec.result.error.message };
    }

    const parsed = parseJsonMaybe(exec.result.stdout) as any;
    const jobId =
      (typeof parsed?.result?.jobId === "string" && parsed.result.jobId.trim()) ||
      (typeof parsed?.jobId === "string" && parsed.jobId.trim()) ||
      "unknown";
    return { ok: true, jobId };
  }

  async function handleResolve(cmd: SlashCommand): Promise<number> {
    const ackBody = "Acknowledged, working…";
    cerebellum.log(ackBody);
    const ackOk = await postIssueComment({
      repo: cmd.repo,
      issueNumber: cmd.issueNumber,
      body: ackBody,
      intention: "Acknowledge /myagent resolve command",
    });
    if (!ackOk) return 1;

    const started = await startCursorJob(cmd);
    if (!started.ok) {
      cerebellum.log(`Failed to start Cursor job: ${started.message}`, "error");
      const failBody = `Failed: ${started.message}`;
      await postIssueComment({
        repo: cmd.repo,
        issueNumber: cmd.issueNumber,
        body: failBody,
        intention: "Report /myagent resolve failure",
      });
      return 1;
    }

    cerebellum.log(`Cursor job started: ${started.jobId}`);

    const summaryBody = [
      "Final summary",
      "",
      `- Command: ${cmd.raw}`,
      `- Cursor job: ${started.jobId}`,
      `- Source: ${cmd.url}`,
    ].join("\n");
    const summaryOk = await postIssueComment({
      repo: cmd.repo,
      issueNumber: cmd.issueNumber,
      body: summaryBody,
      intention: "Post final summary for /myagent resolve",
    });
    if (!summaryOk) return 1;

    cerebellum.log("Posted final summary");
    return 0;
  }

  let exitCode = 0;
  if (cmd) {
    if (cmd.name === "resolve") {
      exitCode = await handleResolve(cmd);
    } else {
      cerebellum.log(`Unsupported command: ${cmd.name}`, "warn");
      exitCode = 0;
    }
    await markProcessed(cmd.itemId);
  } else {
    // Persist store for deterministic fixture tests (even if empty).
    await persistIdempotencyStore(store);
  }

  if (opts.mode === "json") {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: exitCode === 0,
          command: "run",
          result: cmd ? "wake" : "nothing",
          message,
          ...(cmd ? { foundCommand: cmd } : {}),
          logs,
          toolEvents,
          exitCode,
        },
        null,
        2
      )
    );
    return exitCode;
  }

  // eslint-disable-next-line no-console
  console.log(message);
  for (const line of logs) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  return exitCode;
}

function splitCliWords(input: string): string[] {
  return input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getNamedArg(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const v = argv[i + 1];
      if (v && !v.startsWith("-")) return v;
    }
  }
  return undefined;
}

async function cmdTools(opts: { argv: string[]; mode: OutputMode }): Promise<number> {
  const rest = stripGlobalFlags(opts.argv);
  const sub = rest[1]; // [ "tools", ... ]

  if (sub === undefined || sub === "help") {
    if (opts.mode === "json") {
      printHelp(opts.mode, { command: "tools", text: toolsHelpText() });
      return 0;
    }
    // eslint-disable-next-line no-console
    console.log(toolsHelpText());
    return 0;
  }

  if (sub === "gh") {
    const cmdText = rest.slice(2).join(" ").trim();
    if (!cmdText) {
      printError(opts.mode, { command: "tools", message: "Missing gh command string.", helpText: toolsHelpText() });
      return 2;
    }

    const args = splitCliWords(cmdText);
    const res = await executeGh(args, { cwd: process.cwd() });
    if (!res.ok) {
      printError(opts.mode, { command: "tools", message: res.error.message });
      return 1;
    }

    if (opts.mode === "json") {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, command: "tools", tool: "gh", stdout: res.stdout }, null, 2));
      return 0;
    }

    // eslint-disable-next-line no-console
    console.log(res.stdout.trimEnd());
    return 0;
  }

  if (sub === "mcp") {
    const action = rest[2];
    if (action !== "call") {
      printError(opts.mode, { command: "tools", message: `Unknown mcp command: ${String(action)}`, helpText: toolsHelpText() });
      return 2;
    }
    const method = rest[3];
    const rawArgs = getNamedArg(rest, "--args") ?? getNamedArg(opts.argv, "--args");
    const specPath = getNamedArg(rest, "--spec") ?? getNamedArg(opts.argv, "--spec");

    if (!method) {
      printError(opts.mode, { command: "tools", message: "Missing MCP method.", helpText: toolsHelpText() });
      return 2;
    }
    if (!rawArgs) {
      printError(opts.mode, { command: "tools", message: "Missing required flag: --args <json>", helpText: toolsHelpText() });
      return 2;
    }
    if (!specPath) {
      printError(opts.mode, { command: "tools", message: "Missing required flag: --spec <openapi.yml>", helpText: toolsHelpText() });
      return 2;
    }

    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      printError(opts.mode, { command: "tools", message: `Failed to parse --args JSON: ${msg}` });
      return 2;
    }

    const res = await executeMcpCall({ method, args: parsedArgs, specPath }, { cwd: process.cwd() });
    if (!res.ok) {
      printError(opts.mode, { command: "tools", message: res.error.message });
      return 1;
    }

    if (opts.mode === "json") {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({ ok: true, command: "tools", tool: "mcp", method, stdout: res.stdout }, null, 2)
      );
      return 0;
    }

    // eslint-disable-next-line no-console
    console.log(res.stdout.trimEnd());
    return 0;
  }

  // Wrong usage.
  if (opts.mode === "json") {
    printError(opts.mode, { command: "tools", message: `Unknown tools command: ${sub}`, helpText: toolsHelpText() });
    return 2;
  }

  // eslint-disable-next-line no-console
  console.log(toolsHelpText());
  // eslint-disable-next-line no-console
  console.error(`Unknown tools command: ${sub}`);
  return 2;
}

async function cmdSelfCheck(opts: { mode: OutputMode }): Promise<number> {
  const report = await runSelfCheck();
  if (opts.mode === "json") {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: report.ok, command: "selfcheck", checks: report.checks }, null, 2));
    return report.ok ? 0 : 1;
  }

  // eslint-disable-next-line no-console
  console.log("Self-check");
  for (const c of report.checks) {
    if (c.ok) {
      // eslint-disable-next-line no-console
      console.log(`- ok: ${c.name}`);
      continue;
    }
    const prefix = c.skipped ? "skipped" : "fail";
    // eslint-disable-next-line no-console
    console.log(`- ${prefix}: ${c.name} — ${c.error.message}`);
  }
  return report.ok ? 0 : 1;
}

async function cmdInteractive(opts: { mode: OutputMode }): Promise<number> {
  if (opts.mode === "json") {
    printError(opts.mode, {
      command: "interactive",
      message: "Interactive mode does not support --json output.",
      helpText: interactiveHelpText(),
    });
    return 2;
  }

  const chat = new InMemoryChat({
    descriptor: { id: "interactive", chatType: "other", title: "Interactive", limits: { maxMessages: 10_000 } },
  });

  async function lastRandomFromHistory(): Promise<number | null> {
    const res = await chat.fetchMessages({ limit: 10_000 });
    for (const m of res.messages) {
      if (m.role !== "tool") continue;
      const txt = m.body.trim();
      const match = txt.match(/^random_number:\s*(\d+)\s*$/);
      if (!match) continue;
      const n = Number(match[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 1000) return n;
    }
    return null;
  }

  function writeLine(s: string): void {
    process.stdout.write(`${s}\n`);
  }

  writeLine("Interactive mode");
  writeLine(interactiveHelpText());
  writeLine("");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.setPrompt("> ");
  rl.prompt();

  let exitCode = 0;

  async function handleLine(raw: string): Promise<void> {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      return;
    }

    await chat.append({ role: "user", body: line });

    if (line === "/exit") {
      exitCode = 0;
      rl.close();
      return;
    }

    if (line === "/help") {
      writeLine(interactiveHelpText());
      rl.prompt();
      return;
    }

    if (line === "/history") {
      const res = await chat.fetchMessages({ limit: 20 });
      const chronological = [...res.messages].sort((a, b) => a.seq - b.seq);
      writeLine("History (last 20):");
      for (const m of chronological) writeLine(`${m.role}: ${m.body}`);
      rl.prompt();
      return;
    }

    if (line === "/tool random") {
      const n = Math.floor(Math.random() * 1001);
      await chat.append({ role: "tool", body: `random_number:${n}` });
      const reply = `Random number: ${n}`;
      await chat.append({ role: "agent", body: reply });
      writeLine(reply);
      rl.prompt();
      return;
    }

    if (line === "/tool fa") {
      // Minimal file-access demo: write and read a deterministic file.
      const cwd = process.cwd();
      const rel = ".agnet/fa-tool.txt";
      const abs = path.join(cwd, ".agnet", "fa-tool.txt");
      const content = "hello-from-fa";
      await ensureDir(path.dirname(abs));
      await fs.writeFile(abs, content, "utf8");
      const readBack = (await fs.readFile(abs, "utf8")).trim();

      await chat.append({ role: "tool", body: `fa_file:${rel}:${readBack}` });
      const reply = `FA ok: wrote ${rel} and read "${readBack}"`;
      await chat.append({ role: "agent", body: reply });
      writeLine(reply);
      rl.prompt();
      return;
    }

    // "Memory" path: recall last random from chat history.
    if (/\b(number|random)\b/i.test(line) && /\b(remember|recall|what|which)\b/i.test(line)) {
      const n = await lastRandomFromHistory();
      const reply = n == null ? "No remembered number yet." : `Remembered number: ${n}`;
      await chat.append({ role: "agent", body: reply });
      writeLine(reply);
      rl.prompt();
      return;
    }

    const fallback = `Unknown input. Try "/tool random", then ask "what number did you generate?", or "/exit".`;
    await chat.append({ role: "agent", body: fallback });
    writeLine(fallback);
    rl.prompt();
  }

  rl.on("line", (line) => {
    void handleLine(line).catch((err) => {
      exitCode = 1;
      writeLine(err instanceof Error ? err.message : String(err));
      rl.close();
    });
  });

  rl.on("close", () => {
    process.exitCode = exitCode;
  });

  // Keep the Node process alive until readline closes.
  await new Promise<void>((resolve) => rl.once("close", () => resolve()));
  return exitCode;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const cwd = process.cwd();
  const mode = outputMode(argv);
  const help = argv.includes("-h") || argv.includes("--help");
  const templates = getFlagValues(argv, "--templates");

  const positional = stripGlobalFlags(argv).filter((a) => !a.startsWith("-"));
  const command = positional[0];

  if (help || !command) {
    printHelp(mode, { command: "help", text: mainHelpText() });
    return 0;
  }

  try {
    if (command === "doctor") return await cmdDoctor({ templates, cwd, mode });
    if (command === "run") return await cmdRun({ templates, cwd, argv, mode });
    if (command === "interactive") return await cmdInteractive({ mode });
    if (command === "tools") return await cmdTools({ argv, mode });
    if (command === "selfcheck") return await cmdSelfCheck({ mode });

    if (mode === "json") {
      printError(mode, { message: `Unknown command: ${command}`, helpText: mainHelpText() });
      return 2;
    }

    // eslint-disable-next-line no-console
    console.error(`Unknown command: ${command}`);
    // eslint-disable-next-line no-console
    console.log(mainHelpText());
    return 2;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(mode, { command, message: msg });
    return 1;
  }
}

function isEntrypoint(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;
  const invokedAbs = path.resolve(process.cwd(), invokedPath);
  const selfAbs = path.resolve(fileURLToPath(import.meta.url));
  return invokedAbs === selfAbs;
}

if (isEntrypoint()) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
      process.exit(1);
    });
}

