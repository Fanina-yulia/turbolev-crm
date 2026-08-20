import { spawnSync } from "node:child_process";
import { createMigrationEnvironment } from "./migration-database-url.mjs";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function exitFrom(result) {
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function run(args) {
  const result = spawnSync(npx, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) exitFrom(result);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runMigrationWithRetry() {
  const maxAttempts = 4;
  const migration = createMigrationEnvironment(process.env);

  if (migration.usesDirectNeon) {
    console.log("[build] Prisma migrations connection: direct Neon endpoint.");
  } else if (migration.databaseUrl) {
    console.log("[build] Prisma migrations connection: configured database endpoint.");
  } else {
    console.warn("[build] Prisma migrations connection: no database URL detected; Prisma will report the configuration error.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(npx, ["prisma", "migrate", "deploy"], {
      env: migration.env,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status === 0) return;

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const advisoryLockTimeout = /P1002|advisory lock|Timed out trying to acquire a postgres advisory lock/i.test(output);
    if (!advisoryLockTimeout || attempt === maxAttempts) exitFrom(result);

    const delayMs = attempt * 5_000;
    console.warn(`[build] Prisma migrate deploy hit a temporary advisory lock. Retrying in ${delayMs / 1000}s (${attempt}/${maxAttempts}).`);
    sleep(delayMs);
  }
}

if (process.env.VERCEL_ENV === "production") {
  console.log("[build] Production deployment: applying pending Prisma migrations before build.");
  runMigrationWithRetry();
} else {
  console.log(`[build] ${process.env.VERCEL_ENV ?? "non-Vercel"} build: Prisma migrate deploy skipped.`);
}

run(["prisma", "generate"]);
run(["next", "build"]);
