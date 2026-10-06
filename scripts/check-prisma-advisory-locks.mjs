import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = ["src", "app"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    const relative = path.relative(ROOT, full).replaceAll("\\", "/");
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/SELECT\s+pg_advisory_xact_lock\s*\(/.test(line) && !line.includes("::text AS locked")) {
        failures.push(`${relative}:${index + 1} exposes PostgreSQL void from pg_advisory_xact_lock to Prisma/driver`);
      }
    });
  }
}

for (const root of SCAN_ROOTS) {
  const target = path.join(ROOT, root);
  if (fs.existsSync(target)) walk(target);
}

const helper = fs.readFileSync(path.join(ROOT, "src/lib/advisory-lock.ts"), "utf8");
if (!helper.includes("SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))")) {
  failures.push("src/lib/advisory-lock.ts must keep the supported integer-result advisory-lock query.");
}

if (failures.length) {
  console.error("[prisma-advisory-locks] FAIL");
  failures.forEach((failure) => console.error(" - " + failure));
  process.exit(1);
}

console.log("[prisma-advisory-locks] OK — no bare void advisory-lock result is exposed to Prisma.");
