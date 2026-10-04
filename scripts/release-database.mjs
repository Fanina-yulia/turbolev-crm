import { spawnSync } from "node:child_process";
import { createMigrationEnvironment } from "./migration-database-url.mjs";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const CONFIRMATION_ENV = "ALLOW_PRODUCTION_DB_RELEASE";

function exitFrom(result) {
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(args, env = process.env) {
  const command = args[0] === "tsx" ? process.execPath : npx;
  const commandArgs = args[0] === "tsx" ? ["--import", "tsx", ...args.slice(1)] : args;
  const result = spawnSync(command, commandArgs, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) exitFrom(result);
}

function runMigrationWithRetry() {
  const maxAttempts = 4;
  const migration = createMigrationEnvironment(process.env);
  if (!migration.databaseUrl) {
    throw new Error("Database release requires DATABASE_URL_UNPOOLED, DIRECT_URL or DATABASE_URL.");
  }

  console.log(migration.usesDirectNeon
    ? "[db-release] Prisma migration connection: direct Neon endpoint."
    : "[db-release] Prisma migration connection: configured database endpoint.");

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
    const lockTimeout = /P1002|advisory lock|Timed out trying to acquire a postgres advisory lock/i.test(output);
    if (!lockTimeout || attempt === maxAttempts) exitFrom(result);

    const delayMs = attempt * 5_000;
    console.warn(`[db-release] Advisory lock contention. Retrying in ${delayMs / 1000}s (${attempt}/${maxAttempts}).`);
    sleep(delayMs);
  }
}

if (process.env[CONFIRMATION_ENV] !== "1") {
  throw new Error(`Refusing to mutate the production database. Set ${CONFIRMATION_ENV}=1 only in the controlled release step.`);
}

console.log("[db-release] Applying pending Prisma migrations.");
runMigrationWithRetry();
console.log("[db-release] Seeding idempotent canonical parts terminology.");
run(["tsx", "scripts/parts-knowledge-seed.ts"]);
console.log("[db-release] Database release completed.");
