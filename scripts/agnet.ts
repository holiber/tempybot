import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

function printMainHelp(): void {
  const text = `
agnet.ts --templates <path> doctor
agnet.ts --templates <path> run --world
agnet.ts tools

Global flags:
  --templates <path>   Agent template file (.agent.md) or directory (loads **/*.agent.md)
  --json               JSON output (stub)

Examples:
  node scripts/agnet.ts --templates agents/repoboss.agent.md doctor
  node scripts/agnet.ts --templates agents/repoboss.agent.md run --world
`.trim();
  // eslint-disable-next-line no-console
  console.log(text);
}

function printToolsHelp(): void {
  const text = `
agnet.ts tools

Tier 1 MVP: tools are not implemented yet.

Planned (Tier 1 contract):
  agnet.ts tools gh "<command>"
  agnet.ts tools mcp call <method> --args <json> --spec <openapi.yml>
`.trim();
  // eslint-disable-next-line no-console
  console.log(text);
}

function printRunHelp(): void {
  const text = `
agnet.ts --templates <path> run --world

Flags:
  --world   Print a stub STC.World snapshot (Tier 1 MVP)
`.trim();
  // eslint-disable-next-line no-console
  console.log(text);
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
  const srcRoot = path.join(cwd, "src", "agent");
  const outRoot = path.join(cacheRoot, "agent");

  const typesIn = path.join(srcRoot, "types.ts");
  const parserIn = path.join(srcRoot, "parse-agent-md.ts");
  const typesOut = path.join(outRoot, "types.js");
  const parserOut = path.join(outRoot, "parse-agent-md.js");

  const typesInStat = await statSafe(typesIn);
  const parserInStat = await statSafe(parserIn);
  if (!typesInStat || !parserInStat) {
    throw new Error(`Internal parser sources not found under ${toRelPath(srcRoot, cwd)}.`);
  }

  const typesOutStat = await statSafe(typesOut);
  const parserOutStat = await statSafe(parserOut);

  const needsTypes = !typesOutStat || typesOutStat.mtimeMs < typesInStat.mtimeMs;
  const needsParser = !parserOutStat || parserOutStat.mtimeMs < parserInStat.mtimeMs;

  if (needsTypes) await transpileTsToJsFile({ inPath: typesIn, outPath: typesOut });
  if (needsParser) await transpileTsToJsFile({ inPath: parserIn, outPath: parserOut });

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

async function cmdDoctor(opts: { templates: string[]; cwd: string }): Promise<number> {
  const { files } = await loadTemplates(opts);
  const { parseAgentMd } = await loadAgentParser(opts.cwd);

  // Parse to validate.
  for (const f of files) await parseAgentMd(f);

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

async function cmdRun(opts: { templates: string[]; cwd: string; argv: string[] }): Promise<number> {
  const wantWorld = hasFlag(opts.argv, "--world");
  if (!wantWorld) {
    printRunHelp();
    return 2;
  }

  const { files } = await loadTemplates({ templates: opts.templates, cwd: opts.cwd });
  const { parseAgentMd } = await loadAgentParser(opts.cwd);

  // Parse to validate.
  for (const f of files) await parseAgentMd(f);

  // Tier 1 stub world.
  // eslint-disable-next-line no-console
  console.log("WORLD");
  // eslint-disable-next-line no-console
  console.log("items: 0");
  return 0;
}

async function cmdTools(opts: { argv: string[] }): Promise<number> {
  const rest = stripGlobalFlags(opts.argv);
  const sub = rest[1]; // [ "tools", ... ]

  if (sub === undefined || sub === "help") {
    printToolsHelp();
    return 0;
  }

  // Wrong usage for now.
  printToolsHelp();
  // eslint-disable-next-line no-console
  console.error(`Unknown tools command: ${sub}`);
  return 2;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const cwd = process.cwd();
  const help = argv.includes("-h") || argv.includes("--help");
  const templates = getFlagValues(argv, "--templates");
  // Minimal stub for now; parsing is enough to keep the contract stable.
  void hasFlag(argv, "--json");

  const positional = stripGlobalFlags(argv).filter((a) => !a.startsWith("-"));
  const command = positional[0];

  if (help || !command) {
    printMainHelp();
    return 0;
  }

  try {
    if (command === "doctor") return await cmdDoctor({ templates, cwd });
    if (command === "run") return await cmdRun({ templates, cwd, argv });
    if (command === "tools") return await cmdTools({ argv });

    // eslint-disable-next-line no-console
    console.error(`Unknown command: ${command}`);
    printMainHelp();
    return 2;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(msg);
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

