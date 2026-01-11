import { rm, mkdir, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkgDir = resolve(__dirname, "..");
const repoRoot = resolve(pkgDir, "../..");

const distDir = resolve(pkgDir, "dist");

await rm(distDir, { recursive: true, force: true });

const tscBin = resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
const tscArgs = [tscBin, "-p", resolve(pkgDir, "tsconfig.build.json")];
const tsc = spawnSync(process.execPath, tscArgs, { stdio: "inherit" });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// Copy spec declarations that the runtime types reference.
await mkdir(resolve(distDir, "types"), { recursive: true });
await cp(resolve(repoRoot, "src/types/light"), resolve(distDir, "types/light"), { recursive: true });

// Light spec aggregator depends on these cross-spec definitions.
await cp(resolve(repoRoot, "src/types/api-client.d.ts"), resolve(distDir, "types/api-client.d.ts"));
await cp(resolve(repoRoot, "src/types/diagnostic.d.ts"), resolve(distDir, "types/diagnostic.d.ts"));
await cp(resolve(repoRoot, "src/types/channel.d.ts"), resolve(distDir, "types/channel.d.ts"));
await cp(resolve(repoRoot, "src/types/collection.d.ts"), resolve(distDir, "types/collection.d.ts"));

