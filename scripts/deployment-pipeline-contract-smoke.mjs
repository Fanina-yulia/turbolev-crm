import assert from "node:assert/strict";
import fs from "node:fs";

const build = fs.readFileSync("scripts/build-production.mjs", "utf8");
const release = fs.readFileSync("scripts/release-database.mjs", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.equal(/prisma[\s\S]{0,80}migrate[\s\S]{0,80}deploy/i.test(build), false, "Application build must not run prisma migrate deploy");
assert.equal(/parts-knowledge-seed/i.test(build), false, "Application build must not seed production data");
assert.match(build, /Build is read-only with respect to production data/);
assert.match(release, /ALLOW_PRODUCTION_DB_RELEASE/);
assert.match(release, /"prisma", "migrate", "deploy"/);
assert.match(release, /parts-knowledge-seed\.ts/);
assert.equal(pkg.scripts?.["db:release"], "node scripts/release-database.mjs");

console.log("[deployment-pipeline] build is DB-read-only; production DB changes are isolated behind an explicit release guard.");
