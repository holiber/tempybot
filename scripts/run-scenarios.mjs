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
const TIMINGS_ROOT = path.join(ARTIFACTS_ROOT, "timings");

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
    mkdirp(TIMINGS_ROOT);
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

function formatSeconds(sec) {
  if (!Number.isFinite(sec)) return "unknown";
  if (sec < 60) return `${sec.toFixed(2)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}m${s.toFixed(0)}s`;
}

function measureMp4DurationSeconds(mp4Path) {
  const ffprobeOk = trySpawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    mp4Path,
  ]);
  if (!ffprobeOk.ok) return null;
  const raw = String(ffprobeOk.stdout ?? "").trim();
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}

function measureAsciicastDurationSeconds(castPath) {
  try {
    if (!fs.existsSync(castPath)) return null;
    const content = fs.readFileSync(castPath, "utf8");
    // v2 asciicast: first line is a JSON header object, followed by JSON arrays like: [time, "o", "text"]
    const lines = content.split(/\r?\n/).filter(Boolean);
    let maxT = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("[")) continue;
      const evt = JSON.parse(line);
      const t = Number(evt?.[0]);
      if (Number.isFinite(t) && t > maxT) maxT = t;
    }
    if (maxT <= 0) return null;
    return maxT;
  } catch {
    return null;
  }
}

function readTimingsSummary(timingsPath) {
  try {
    if (!timingsPath) return null;
    if (!fs.existsSync(timingsPath)) return null;
    const raw = fs.readFileSync(timingsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function printTimingsSummary(file, timingsPath) {
  const summary = readTimingsSummary(timingsPath);
  if (!summary?.userSleep) return;
  const us = summary.userSleep;
  console.log(
    [
      "SCENARIO_TIMINGS",
      `file=${relToRoot(file)}`,
      `userSleep_calls=${us.calls}`,
      `requested_ms_total=${us.requested_ms_total}`,
      `actual_ms_total=${us.actual_ms_total}`,
      `drift_ms_total=${us.drift_ms_total}`,
      `actual_ms_min=${us.actual_ms_min ?? "null"}`,
      `actual_ms_avg=${us.actual_ms_avg ?? "null"}`,
      `actual_ms_max=${us.actual_ms_max ?? "null"}`,
    ].join(" ")
  );
}

function runCliUserlikeWithVideo(file) {
  const base = safeBase(file);
  const outDir = path.join(CLI_VIDEO_ROOT, base);
  mkdirp(outDir);

  const castPath = path.join(outDir, `${base}.cast`);
  const mp4Path = path.join(outDir, `${base}.mp4`);
  const timingsPath = path.join(TIMINGS_ROOT, `${base}.json`);

  // asciinema rec -c "<cmd>" <cast>
  // Note: we keep this optional; if tools are missing, we fall back to a normal run.
  const asciinemaOk = trySpawnSync("asciinema", ["--version"]);
  if (!asciinemaOk.ok) {
    // fallback (no video)
    const r = runVitestOneFile({
      file,
      env: { SCENARIO_MODE: "userlike", SCENARIO_TIMINGS: "1", SCENARIO_TIMINGS_FILE: timingsPath },
      stdio: "inherit",
    });
    printTimingsSummary(file, timingsPath);
    return { ok: (r.status ?? 1) === 0, outDir, castPath: null, mp4Path: null, usedVideo: false };
  }

  const cmdString = `SCENARIO_MODE=userlike SCENARIO_TIMINGS=1 SCENARIO_TIMINGS_FILE="${timingsPath}" npx vitest run --config vitest.scenario.config.ts "${file}" --bail=1`;
  const rec = spawnSync("asciinema", ["rec", "--overwrite", "-q", "-c", cmdString, castPath], {
    stdio: "inherit",
    env: { ...process.env, SCENARIO_MODE: "userlike", SCENARIO_TIMINGS: "1" },
  });
  if ((rec.status ?? 1) !== 0) return { ok: false, outDir, castPath, mp4Path: null, usedVideo: true };

  printTimingsSummary(file, timingsPath);

  // Always report recorded duration (cast is the source of truth).
  // mp4 conversion is best-effort and may be unavailable locally.
  const castDuration = measureAsciicastDurationSeconds(castPath);
  if (castDuration != null) {
    console.log(`CLI_VIDEO_DURATION file=${relToRoot(file)} duration=${formatSeconds(castDuration)} source=cast`);
  }

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

  const mp4Duration = measureMp4DurationSeconds(mp4Path);
  if (mp4Duration != null) {
    console.log(`CLI_VIDEO_DURATION file=${relToRoot(file)} duration=${formatSeconds(mp4Duration)} source=mp4`);
  }

  return { ok: true, outDir, castPath, mp4Path, usedVideo: true };
}

function runOneSmoke(file) {
  const base = safeBase(file);
  const logPath = path.join(CACHE_DIR, `${base}.log`);

  const startedOne = performance.now();
  const r = runVitestOneFile({
    file,
    env: { SCENARIO_MODE: "smoke" },
    stdio: "pipe",
  });
  const elapsedOne = (performance.now() - startedOne) / 1000;

  const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  fs.writeFileSync(logPath, combined, "utf8");

  console.log(`SCENARIO_DURATION file=${relToRoot(file)} duration=${formatSeconds(elapsedOne)} mode=smoke`);
  return { ok: (r.status ?? 1) === 0, logPath };
}

function runOneUserlike(file) {
  const t = targetOf(file);
  const base = safeBase(file);
  const timingsPath = path.join(TIMINGS_ROOT, `${base}.json`);

  const startedOne = performance.now();
  if (t === "cli") {
    const res = runCliUserlikeWithVideo(file);
    const elapsedOne = (performance.now() - startedOne) / 1000;
    console.log(`SCENARIO_DURATION file=${relToRoot(file)} duration=${formatSeconds(elapsedOne)} mode=userlike`);
    return res;
  }

  // web: record via Playwright recordVideo (test-utils reads E2E_WEB_VIDEO_DIR)
  const webOutDir = path.join(WEB_VIDEO_ROOT, base);
  mkdirp(webOutDir);

  const r = runVitestOneFile({
    file,
    env: {
      SCENARIO_MODE: "userlike",
      SCENARIO_TIMINGS: "1",
      SCENARIO_TIMINGS_FILE: timingsPath,
      E2E_WEB_VIDEO_DIR: webOutDir,
      SCENARIO_WEB_DEVICE: mobile ? "mobile" : process.env.SCENARIO_WEB_DEVICE,
    },
    stdio: "inherit",
  });

  printTimingsSummary(file, timingsPath);
  const elapsedOne = (performance.now() - startedOne) / 1000;
  console.log(`SCENARIO_DURATION file=${relToRoot(file)} duration=${formatSeconds(elapsedOne)} mode=userlike`);
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

