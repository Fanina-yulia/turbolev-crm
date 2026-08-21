import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = ["app", "src"];
const EXTENSIONS = new Set([".css", ".scss", ".tsx", ".ts", ".jsx", ".js"]);
const MIN_FONT_PX = 12;
const changedOnly = process.env.VERCEL === "1" || process.env.GITHUB_ACTIONS === "true" || process.argv.includes("--changed");

const patterns = [
  /font-size\s*:\s*(\d+(?:\.\d+)?)px/gi,
  /fontSize\s*:\s*["'`](\d+(?:\.\d+)?)px["'`]/g,
  /text-\[(\d+(?:\.\d+)?)px\]/g,
];

function allowedSelectorLiteral(source, matchIndex) {
  const before = source.slice(Math.max(0, matchIndex - 32), matchIndex);
  return before.includes("[style*=");
}

function allowedVisualException(source, matchIndex, value) {
  if (allowedSelectorLiteral(source, matchIndex)) return true;
  if (value > 6) return false;
  const context = source.slice(Math.max(0, matchIndex - 180), matchIndex + 180);
  return /uaPlateCountry|plateCountry|plateUa|plateUA/i.test(context);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function changedUiFiles() {
  const result = spawnSync("git", ["diff", "--name-only", "HEAD^", "HEAD", "--", ...ROOTS], { encoding: "utf8" });
  if (result.status !== 0) {
    console.warn("[ui-font-floor] Could not resolve changed files; skipping ratchet check for this build.");
    return [];
  }
  return result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).filter((file) => EXTENSIONS.has(extname(file)));
}

let files = [];
if (changedOnly) {
  files = changedUiFiles();
} else {
  for (const root of ROOTS) {
    try {
      files.push(...await walk(root));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

const violations = [];
for (const file of files) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      const value = Number(match[1]);
      if (!Number.isFinite(value) || value >= MIN_FONT_PX) continue;
      if (allowedVisualException(source, match.index, value)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      violations.push({ file: relative(process.cwd(), file), line, token: match[0] });
    }
  }
}

if (violations.length) {
  console.error(`\n[ui-font-floor] Found ${violations.length} newly changed UI font sizes below ${MIN_FONT_PX}px:`);
  for (const item of violations) console.error(`  ${item.file}:${item.line}  ${item.token}`);
  console.error("\n[ui-font-floor] New operational UI text must be at least 12px. The only allowed exception is tiny UA artwork inside the licence-plate graphic.\n");
  process.exit(1);
}

console.log(`[ui-font-floor] OK — ${changedOnly ? "changed UI files" : "UI sources"} respect the ${MIN_FONT_PX}px floor.`);
