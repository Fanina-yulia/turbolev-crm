import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOTS = ["app", "src"];
const EXTENSIONS = new Set([".css", ".scss", ".tsx", ".ts", ".jsx", ".js"]);
const MIN_FONT_PX = 12;

const patterns = [
  /font-size\s*:\s*(\d+(?:\.\d+)?)px/gi,
  /fontSize\s*:\s*["'`](\d+(?:\.\d+)?)px["'`]/g,
  /text-\[(\d+(?:\.\d+)?)px\]/g,
];

function allowedVisualException(file, source, matchIndex, value) {
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

const violations = [];
for (const root of ROOTS) {
  let files = [];
  try {
    files = await walk(root);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source))) {
        const value = Number(match[1]);
        if (!Number.isFinite(value) || value >= MIN_FONT_PX) continue;
        if (allowedVisualException(file, source, match.index, value)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        violations.push({ file: relative(process.cwd(), file), line, value, token: match[0] });
      }
    }
  }
}

if (violations.length) {
  console.error(`\n[ui-font-floor] Found ${violations.length} font sizes below ${MIN_FONT_PX}px:`);
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line}  ${item.token}`);
  }
  console.error("\n[ui-font-floor] Operational UI text must be at least 12px. The only allowed exception is tiny UA artwork inside the licence-plate graphic.\n");
  process.exit(1);
}

console.log(`[ui-font-floor] OK — no operational UI font sizes below ${MIN_FONT_PX}px.`);
