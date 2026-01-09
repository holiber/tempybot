import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SCENARIO_DIR = path.join(ROOT, "tests", "scenario");

const argv = process.argv.slice(2);

const onlyWeb = argv.includes("--web");
const onlyCli = argv.includes("--cli");
const mobile = argv.includes("--mobile");

const onlyIntegration = argv.includes("--integration");
const noIntegration = argv.includes("--no-integration");

const listOnly = argv.includes("--list");

if (onlyIntegration && noIntegration) {
  console.error("Use either --integration or --no-integration (not both).");
  process.exit(2);
}

if (mobile) {
  process.env.SCENARIO_WEB_DEVICE = "mobile";
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function isScenarioFile(p) {
  return p.endsWith(".scenario.test.ts") || p.endsWith(".scenario.test.js");
}

function isIntegrationScenario(file) {
  const rel = path.relative(SCENARIO_DIR, file).split(path.sep);
  return rel.includes("integration");
}

function targetOf(file) {
  const rel = path.relative(SCENARIO_DIR, file).split(path.sep);
  if (rel.includes("cli")) return "cli";
  return "web";
}

function fromEnvScenarioFiles() {
  const raw = process.env.SCENARIO_FILES;
  if (!raw) return null;

  // Supports newline-separated or space-separated paths.
  const parts = raw
    .split(/\r?\n/)
    .flatMap((line) => line.trim().split(/\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.length ? parts.map((p) => path.resolve(ROOT, p)) : null;
}

function collectScenarioFiles() {
  const fromEnv = fromEnvScenarioFiles();
  if (fromEnv) return fromEnv;

  return walk(SCENARIO_DIR).filter(isScenarioFile).sort();
}

function filterScenarios(files) {
  let out = files;

  if (onlyIntegration) out = out.filter(isIntegrationScenario);
  if (noIntegration) out = out.filter((f) => !isIntegrationScenario(f));

  const runWeb = onlyCli ? false : true;
  const runCli = onlyWeb ? false : true;

  out = out.filter((f) => {
    const t = targetOf(f);
    if (t === "web") return runWeb;
    if (t === "cli") return runCli;
    return true;
  });

  return out;
}

function runVitestOneFile(file) {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["vitest", "run", "--config", "vitest.scenario.config.ts", file, "--bail=1"];
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  return r.status ?? 1;
}

const files = filterScenarios(collectScenarioFiles());

if (listOnly) {
  for (const f of files) {
    console.log(path.relative(ROOT, f));
  }
  process.exit(0);
}

if (!files.length) {
  console.log("No scenario tests to run.");
  process.exit(0);
}

for (const f of files) {
  const rel = path.relative(ROOT, f);
  console.log(`\n=== scenario: ${rel} ===`);
  const code = runVitestOneFile(f);
  if (code !== 0) process.exit(code);
}

