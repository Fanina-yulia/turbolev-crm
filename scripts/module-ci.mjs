import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const ROOT = process.cwd();
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/modules/module-registry.json"), "utf8"));
const ci = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/modules/ci-checks.json"), "utf8"));

function globRegex(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function matches(file, pattern) {
  return globRegex(pattern).test(file.replaceAll("\\", "/"));
}

function parseArgs(argv) {
  const result = { base: null, run: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base") result.base = argv[++i] || null;
    else if (argv[i] === "--run") result.run = true;
  }
  return result;
}

function changedFiles(base) {
  const range = base ? `${base}...HEAD` : "HEAD~1...HEAD";
  const output = execFileSync("git", ["diff", "--name-only", range], { cwd: ROOT, encoding: "utf8" });
  return [...new Set(output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
}

function scope(files) {
  const direct = new Set();
  const unmatched = [];
  for (const file of files) {
    const owners = registry.modules.filter((module) => module.paths.some((pattern) => matches(file, pattern)));
    if (!owners.length && /^(app|src|prisma|integrations)\//.test(file)) unmatched.push(file);
    for (const owner of owners) direct.add(owner.id);
  }
  const dependency = new Set();
  for (const id of direct) {
    const module = registry.modules.find((item) => item.id === id);
    for (const dep of module?.dependencies || []) if (!direct.has(dep)) dependency.add(dep);
  }
  return { direct: [...direct], dependency: [...dependency], unmatched };
}

const FULL_CI_PATTERNS = [
  "prisma/**",
  "prisma.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.*",
  "scripts/build-production.mjs",
  ".github/workflows/ci.yml",
  "docs/prisma-drift-allowlist.json",
  "scripts/prisma-drift-check.mjs",
  "scripts/ci-migrate-clean-db.sh",
  "scripts/ci-external-schema.sql"
];

function fullCiReasons(files, result) {
  const reasons = [];
  const sensitive = files.filter((file) => FULL_CI_PATTERNS.some((pattern) => matches(file, pattern)));
  if (sensitive.length) reasons.push(`platform/schema files: ${sensitive.join(", ")}`);
  if (result.direct.includes("core-platform")) reasons.push("core-platform module changed");
  if (result.unmatched.length) reasons.push(`unmapped production files: ${result.unmatched.join(", ")}`);
  if (result.direct.length >= 4) reasons.push(`${result.direct.length} direct modules changed`);
  return reasons;
}

function selectedChecks(result) {
  const modules = [...new Set([...result.direct, ...result.dependency])];
  const ids = new Set();
  for (const moduleId of modules) {
    for (const check of ci.moduleChecks[moduleId] || []) ids.add(check);
  }
  return [...ids];
}

function writeGithubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, " ")}\n`, "utf8");
}

function summary(files, result, reasons, checks) {
  const lines = [
    "# Module-aware CI plan",
    "",
    `Changed files: **${files.length}**`,
    `Direct modules: **${result.direct.join(", ") || "none"}**`,
    `Dependency modules: **${result.dependency.join(", ") || "none"}**`,
    `Full CI: **${reasons.length ? "YES" : "NO"}**`,
    "",
  ];
  if (reasons.length) lines.push("## Full-CI reasons", ...reasons.map((reason) => `- ${reason}`), "");
  lines.push("## Targeted smoke checks", ...(checks.length ? checks.map((check) => `- ${check}`) : ["- none available; Prisma validation and TypeScript still run"]));
  if (result.unmatched.length) lines.push("", "## Unmapped production files", ...result.unmatched.map((file) => `- ${file}`));
  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const files = changedFiles(args.base);
const result = scope(files);
const reasons = fullCiReasons(files, result);
const checks = selectedChecks(result);
const report = summary(files, result, reasons, checks);

process.stdout.write(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report, "utf8");
writeGithubOutput("full_ci", reasons.length ? "true" : "false");
writeGithubOutput("modules", result.direct.join(","));
writeGithubOutput("dependency_modules", result.dependency.join(","));
writeGithubOutput("changed_files_count", files.length);

if (args.run) {
  for (const check of checks) {
    const command = ci.checks[check];
    if (!command) throw new Error(`CI check '${check}' has no command in docs/modules/ci-checks.json`);
    console.log(`\n[module-ci] ${check}: ${command}`);
    execSync(command, { cwd: ROOT, stdio: "inherit", env: process.env });
  }
  console.log(`\n[module-ci] ${checks.length} targeted smoke check(s): OK`);
}
