import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const ROOT = process.cwd();
const SCENARIO_DIR = path.join(ROOT, "tests", "scenario");

// mode
const MODE = process.env.SCENARIO_MODE === "smoke" ? "smoke" : "userlike";

// smoke logs
const CACHE_DIR = path.join(ROOT, ".cache", "smokecheck");

// artifacts
const ARTIFACTS_ROOT = path.join(ROOT, "artifacts", "user-style-e2e");
const WEB_VIDEO_ROOT = path.join(ARTIFACTS_ROOT, "web");
const CLI_VIDEO_ROOT = path.join(ARTIFACTS_ROOT, "cli");

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

const runWeb = onlyCli ? false : true;
const runCli = onlyWeb ? false : true;

if (mobile) {
  process.env.SCENARIO_WEB_DEVICE = "mobile";
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resetDirs() {
  if (listOnly) return;

  if (MODE === "smoke") {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    mkdirp(CACHE_DIR);
  }

  if (MODE === "userlike") {
    mkdirp(WEB_VIDEO_ROOT);
    mkdirp(CLI_VIDEO_ROOT);
  }
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

function safeBase(file) {
  return path
    .basename(file)
    .replace(/\.(scenario)\.test\.(ts|js)$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function relToRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
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

  out = out.filter((f) => {
    const t = targetOf(f);
    if (t === "web") return runWeb;
    if (t === "cli") return runCli;
    return true;
  });

  return out;
}

function vitestCmd() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function runVitestOneFile({ file, env, stdio }) {
  const args = [
    "vitest",
    "run",
    "--config",
    "vitest.scenario.config.ts",
    file,
    "--bail=1",
  ];

  return spawnSync(vitestCmd(), args, {
    env: { ...process.env, ...env },
    stdio,
    encoding: stdio === "pipe" ? "utf8" : undefined,
  });
}

function trySpawnSync(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { ...options, encoding: "utf8" });
  if (r.error) return { ok: false, error: r.error };
  if ((r.status ?? 1) !== 0) return { ok: false, status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  return { ok: true, stdout: r.stdout, stderr: r.stderr };
}

function runCliUserlikeWithVideo(file) {
  const base = safeBase(file);
  const outDir = path.join(CLI_VIDEO_ROOT, base);
  mkdirp(outDir);

  const castPath = path.join(outDir, `${base}.cast`);
  const mp4Path = path.join(outDir, `${base}.mp4`);

  // asciinema rec -c "<cmd>" <cast>
  // Note: we keep this optional; if tools are missing, we fall back to a normal run.
  const asciinemaOk = trySpawnSync("asciinema", ["--version"]);
  if (!asciinemaOk.ok) {
    // fallback (no video)
    const r = runVitestOneFile({ file, env: { SCENARIO_MODE: "userlike" }, stdio: "inherit" });
    return { ok: (r.status ?? 1) === 0, outDir, castPath: null, mp4Path: null, usedVideo: false };
  }

  const cmdString = `${MODE === "userlike" ? "SCENARIO_MODE=userlike" : ""} npx vitest run --config vitest.scenario.config.ts "${file}" --bail=1`;
  const rec = spawnSync("asciinema", ["rec", "--overwrite", "-q", "-c", cmdString, castPath], {
    stdio: "inherit",
    env: { ...process.env, SCENARIO_MODE: "userlike" },
  });
  if ((rec.status ?? 1) !== 0) return { ok: false, outDir, castPath, mp4Path: null, usedVideo: true };

  // cast -> gif -> mp4 via agg + ffmpeg (optional, best-effort)
  const aggOk = trySpawnSync("agg", ["--version"]);
  const ffmpegOk = trySpawnSync("ffmpeg", ["-version"]);
  if (!aggOk.ok || !ffmpegOk.ok) return { ok: true, outDir, castPath, mp4Path: null, usedVideo: true };

  const gifPath = mp4Path.replace(/\.mp4$/, ".gif");
  const agg = spawnSync("agg", [castPath, gifPath], { stdio: "inherit" });
  if ((agg.status ?? 1) !== 0) return { ok: true, outDir, castPath, mp4Path: null, usedVideo: true };

  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", gifPath, "-movflags", "faststart", "-pix_fmt", "yuv420p", mp4Path],
    { stdio: "inherit" }
  );
  if ((ff.status ?? 1) !== 0) return { ok: true, outDir, castPath, mp4Path: null, usedVideo: true };

  return { ok: true, outDir, castPath, mp4Path, usedVideo: true };
}

function runOneSmoke(file) {
  const base = safeBase(file);
  const logPath = path.join(CACHE_DIR, `${base}.log`);

  const r = runVitestOneFile({
    file,
    env: { SCENARIO_MODE: "smoke" },
    stdio: "pipe",
  });

  const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  fs.writeFileSync(logPath, combined, "utf8");

  return { ok: (r.status ?? 1) === 0, logPath };
}

function runOneUserlike(file) {
  const t = targetOf(file);
  const base = safeBase(file);

  if (t === "cli") {
    return runCliUserlikeWithVideo(file);
  }

  // web: record via Playwright recordVideo (test-utils reads E2E_WEB_VIDEO_DIR)
  const webOutDir = path.join(WEB_VIDEO_ROOT, base);
  mkdirp(webOutDir);

  const r = runVitestOneFile({
    file,
    env: {
      SCENARIO_MODE: "userlike",
      E2E_WEB_VIDEO_DIR: webOutDir,
      SCENARIO_WEB_DEVICE: mobile ? "mobile" : process.env.SCENARIO_WEB_DEVICE,
    },
    stdio: "inherit",
  });

  return { ok: (r.status ?? 1) === 0, outDir: webOutDir, usedVideo: true };
}

const files = filterScenarios(collectScenarioFiles());

if (listOnly) {
  for (const f of files) console.log(relToRoot(f));
  process.exit(0);
}

resetDirs();

if (!files.length) {
  console.log("passed 0/0 in 0.00s");
  process.exit(0);
}

const total = files.length;
let passed = 0;
const started = performance.now();

for (const file of files) {
  const rel = relToRoot(file);

  if (MODE === "smoke") {
    const res = runOneSmoke(file);
    if (!res.ok) {
      const elapsed = ((performance.now() - started) / 1000).toFixed(2);
      console.log(`passed ${passed}/${total} in ${elapsed}s`);
      console.log(`FAILED: ${rel}`);
      console.log(`log: ${path.relative(ROOT, res.logPath)}`);
      process.exit(1);
    }
    passed += 1;
    continue;
  }

  // userlike
  console.log(`\n=== scenario (userlike): ${rel} ===`);
  const res = runOneUserlike(file);
  if (!res.ok) {
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    console.log(`passed ${passed}/${total} in ${elapsed}s`);
    console.log(`FAILED: ${rel}`);
    if (res.outDir) console.log(`artifacts: ${path.relative(ROOT, res.outDir)}`);
    process.exit(1);
  }
  passed += 1;
}

const elapsed = ((performance.now() - started) / 1000).toFixed(2);
console.log(`passed ${passed}/${total} in ${elapsed}s`);

