import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, "docs", "modules", "module-registry.json");
const OVERRIDES_PATH = path.join(ROOT, "docs", "modules", "module-path-overrides.json");

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, "utf8");
  const registry = JSON.parse(raw);
  if (!registry || !Array.isArray(registry.modules)) throw new Error("Invalid module registry: modules[] is required");

  if (fs.existsSync(OVERRIDES_PATH)) {
    const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
    if (!overrides || Array.isArray(overrides) || typeof overrides !== "object") {
      throw new Error("Invalid module path overrides: expected an object keyed by module id");
    }
    const knownIds = new Set(registry.modules.map((module) => module.id));
    for (const [id, patterns] of Object.entries(overrides)) {
      if (!knownIds.has(id)) throw new Error(`Unknown module id in path overrides: ${id}`);
      if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string" || !pattern.trim())) {
        throw new Error(`Invalid path overrides for module ${id}: expected non-empty string patterns`);
      }
    }
    registry.modules = registry.modules.map((module) => ({
      ...module,
      paths: [...module.paths, ...(overrides[module.id] || [])],
    }));
  }

  return registry;
}

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
  const result = { base: null, files: [], strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") {
      result.base = argv[++i] || null;
    } else if (arg === "--strict") {
      result.strict = true;
    } else if (arg === "--files") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) result.files.push(argv[++i]);
    } else if (arg.startsWith("--files=")) {
      result.files.push(...arg.slice("--files=".length).split(",").map((value) => value.trim()).filter(Boolean));
    }
  }
  return result;
}

function changedFiles(base) {
  const args = base
    ? ["diff", "--name-only", `${base}...HEAD`]
    : ["diff", "--name-only", "HEAD~1...HEAD"];
  const output = execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function moduleScope(registry, files) {
  const direct = [];
  const unmatched = [];
  const matchesByModule = new Map();

  for (const file of files) {
    const owners = registry.modules.filter((module) => module.paths.some((pattern) => matches(file, pattern)));
    if (!owners.length) {
      if (/^(app|src|prisma|integrations)\//.test(file)) unmatched.push(file);
      continue;
    }
    for (const owner of owners) {
      direct.push(owner.id);
      const list = matchesByModule.get(owner.id) || [];
      list.push(file);
      matchesByModule.set(owner.id, list);
    }
  }

  const directIds = unique(direct);
  const dependencyIds = unique(directIds.flatMap((id) => registry.modules.find((item) => item.id === id)?.dependencies || []))
    .filter((id) => !directIds.includes(id));

  return { directIds, dependencyIds, unmatched, matchesByModule };
}

function markdown(registry, files, scope) {
  const byId = new Map(registry.modules.map((item) => [item.id, item]));
  const lines = [
    "# CRM module scope",
    "",
    `Changed files: **${files.length}**`,
    `Direct modules: **${scope.directIds.length}**`,
    `Dependency checks: **${scope.dependencyIds.length}**`,
    "",
    "## Direct modules",
  ];

  if (!scope.directIds.length) lines.push("- No production module matched.");
  for (const id of scope.directIds) {
    const module = byId.get(id);
    const matched = scope.matchesByModule.get(id) || [];
    lines.push(`- **${module?.title || id}** (\`${id}\`) — ${matched.join(", ")}`);
    if (module?.smokeChecks?.length) lines.push(`  - Smoke: ${module.smokeChecks.map((item) => `\`${item}\``).join(", ")}`);
  }

  lines.push("", "## Dependencies to inspect only if the change crosses the module boundary");
  if (!scope.dependencyIds.length) lines.push("- None.");
  for (const id of scope.dependencyIds) {
    const module = byId.get(id);
    lines.push(`- ${module?.title || id} (\`${id}\`)`);
  }

  if (scope.unmatched.length) {
    lines.push("", "## Unmatched production files", "These files should be assigned to a module if they become a recurring change surface:");
    for (const file of scope.unmatched) lines.push(`- \`${file}\``);
  }

  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const registry = loadRegistry();
const files = unique(args.files.length ? args.files : changedFiles(args.base));
const scope = moduleScope(registry, files);
const report = markdown(registry, files, scope);
process.stdout.write(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report, "utf8");
}

if (args.strict && scope.unmatched.length) {
  console.error(`\nStrict mode: ${scope.unmatched.length} production file(s) are not mapped to a module.`);
  process.exitCode = 2;
}
