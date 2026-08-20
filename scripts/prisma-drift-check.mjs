import fs from "node:fs";
import { execFileSync } from "node:child_process";

const allowlist = JSON.parse(fs.readFileSync("docs/prisma-drift-allowlist.json", "utf8"));
const allowedTables = new Set((allowlist.externalTables || []).map((item) => item.name));
const allowedConstraints = new Set(allowlist.externalConstraints || []);

function runDiff() {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return execFileSync(
    command,
    ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma", "--script"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
}

function sqlStatements(sql) {
  return sql
    .split(";")
    .map((chunk) => chunk
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim())
    .filter(Boolean)
    .filter((statement) => !/^(BEGIN|COMMIT)$/i.test(statement));
}

function reviewed(statement) {
  for (const table of allowedTables) {
    if (statement.includes(`"${table}"`)) return { kind: "external-table", name: table };
  }
  for (const constraint of allowedConstraints) {
    if (statement.includes(`"${constraint}"`)) return { kind: "external-constraint", name: constraint };
  }
  return null;
}

const diff = runDiff();
const statements = sqlStatements(diff);

if (!statements.length) {
  console.log("Prisma drift check: schema matches Prisma exactly.");
  process.exit(0);
}

const allowed = [];
const unexpected = [];
for (const statement of statements) {
  const match = reviewed(statement);
  if (match) allowed.push({ statement, ...match });
  else unexpected.push(statement);
}

if (allowed.length) {
  console.log(`Prisma drift check: ${allowed.length} reviewed external statement(s) allowed.`);
  for (const item of allowed) console.log(`  - ${item.kind}: ${item.name}`);
}

if (unexpected.length) {
  console.error(`Prisma drift check FAILED: ${unexpected.length} unreviewed statement(s) detected.`);
  for (const statement of unexpected) console.error(`\n--- unreviewed drift ---\n${statement};`);
  console.error("\nUpdate the Prisma schema or explicitly review a narrowly scoped exception before merging.");
  process.exit(2);
}

console.log("Prisma drift check: only reviewed external/raw-SQL drift remains.");
