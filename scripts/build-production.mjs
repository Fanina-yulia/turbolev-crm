import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(args) {
  const result = spawnSync(npx, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.VERCEL_ENV === "production") {
  console.log("[build] Production deployment: applying pending Prisma migrations before build.");
  run(["prisma", "migrate", "deploy"]);
} else {
  console.log(`[build] ${process.env.VERCEL_ENV ?? "non-Vercel"} build: Prisma migrate deploy skipped.`);
}

run(["prisma", "generate"]);
run(["next", "build"]);
