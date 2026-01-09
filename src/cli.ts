import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseAgentMd } from "./agent/parse-agent-md.js";

type ParsedArgs = {
  command: "agent-parse" | "help" | "unknown";
  inputPath?: string;
  outPath?: string;
  help: boolean;
};

function printHelp(): void {
  const text = `
tempybot agent parse <file.agent.md> [--out <file.json>]

Parses a single .agent.md file and prints formatted JSON to stdout.
If --out is provided, it also writes the JSON to that path.

Examples:
  tempybot agent parse "./docs/agent-examples/python-data-cleaner.agent.md"
  tempybot agent parse "./docs/agent-examples/python-data-cleaner.agent.md" --out "./python-data-cleaner.agent.json"
`.trim();
  // eslint-disable-next-line no-console
  console.log(text);
}

function parseArgs(argv: string[]): ParsedArgs {
  const help = argv.includes("-h") || argv.includes("--help");
  let outPath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out" || a === "-o") {
      outPath = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    positional.push(a);
  }

  if (positional.length === 0) {
    return { command: "help", help: true };
  }

  if (positional[0] === "agent" && positional[1] === "parse") {
    const inputPath = positional[2];
    return { command: "agent-parse", inputPath, outPath, help };
  }

  if (positional[0] === "help") {
    return { command: "help", help: true };
  }

  return { command: "unknown", help };
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

async function writeJsonFile(outPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runAgentParse(inputPath: string, opts: { outPath?: string }): Promise<number> {
  const cwd = process.cwd();
  const inputAbs = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);

  try {
    const def = await parseAgentMd(inputAbs);

    if (opts.outPath) {
      const outAbs = path.isAbsolute(opts.outPath) ? opts.outPath : path.resolve(cwd, opts.outPath);
      await writeJsonFile(outAbs, def);
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(def, null, 2));
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(msg);
    return 1;
  }
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

  if (!args.inputPath) {
    // eslint-disable-next-line no-console
    console.error(`Missing input file path. See: tempybot agent parse --help`);
    return 2;
  }

  return await runAgentParse(args.inputPath, { outPath: args.outPath });
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

