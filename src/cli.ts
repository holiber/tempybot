import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import fg from "fast-glob";
import { parseAgentMd } from "./agent/parse-agent-md";

type ParsedArgs = {
  command: "agent-parse" | "help" | "unknown";
  globs: string[];
  stdout: boolean;
  help: boolean;
};

function printHelp(): void {
  const text = `
tempybot agent parse <glob...> [--stdout]

Discovers .agent.md files, parses them, and writes JSON next to inputs
by default (or prints JSON to stdout with --stdout).

Examples:
  tempybot agent parse "**/*.agent.md"
  tempybot agent parse "examples/*.agent.md"
  tempybot agent parse "**/*.agent.md" --stdout
`.trim();
  // eslint-disable-next-line no-console
  console.log(text);
}

function parseArgs(argv: string[]): ParsedArgs {
  const help = argv.includes("-h") || argv.includes("--help");
  const stdout = argv.includes("--stdout");

  const positional = argv.filter((a) => !a.startsWith("-"));

  if (positional.length === 0) {
    return { command: "help", globs: [], stdout, help: true };
  }

  if (positional[0] === "agent" && positional[1] === "parse") {
    const globs = positional.slice(2);
    return { command: "agent-parse", globs, stdout, help };
  }

  if (positional[0] === "help") {
    return { command: "help", globs: [], stdout, help: true };
  }

  return { command: "unknown", globs: [], stdout, help };
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

async function discoverAgentMdFiles(globs: string[], cwd: string): Promise<string[]> {
  const patterns = globs.length ? globs : ["**/*.agent.md"];

  const matches = await fg(patterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: false,
    followSymbolicLinks: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/artifacts/**"],
  });

  return matches.filter((p) => p.endsWith(".agent.md")).sort();
}

function jsonOutPath(agentMdPath: string): string {
  if (agentMdPath.endsWith(".agent.md")) {
    return agentMdPath.replace(/\.agent\.md$/, ".agent.json");
  }
  return `${agentMdPath}.json`;
}

async function writeJsonFile(outPath: string, data: unknown): Promise<void> {
  await fs.writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runAgentParse(globs: string[], opts: { stdout: boolean }): Promise<number> {
  const cwd = process.cwd();
  const files = await discoverAgentMdFiles(globs, cwd);
  if (files.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`No '*.agent.md' files found (cwd=${toPosixPath(cwd)}).`);
    return 2;
  }

  let hadErrors = false;

  for (const file of files) {
    try {
      const def = await parseAgentMd(file);

      if (opts.stdout) {
        // NDJSON for stable multi-file output: 1 JSON object per file.
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ file: toPosixPath(path.relative(cwd, file)), definition: def }));
      } else {
        const out = jsonOutPath(file);
        await writeJsonFile(out, def);
        // eslint-disable-next-line no-console
        console.log(`${toPosixPath(path.relative(cwd, file))} -> ${toPosixPath(path.relative(cwd, out))}`);
      }
    } catch (err) {
      hadErrors = true;
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`ERROR ${toPosixPath(path.relative(cwd, file))}: ${msg}`);
    }
  }

  return hadErrors ? 1 : 0;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  if (args.command === "help" || args.help) {
    printHelp();
    return 0;
  }

  if (args.command !== "agent-parse") {
    // eslint-disable-next-line no-console
    console.error(`Unknown command. See: tempybot agent parse --help`);
    return 2;
  }

  return await runAgentParse(args.globs, { stdout: args.stdout });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
      process.exit(1);
    });
}

