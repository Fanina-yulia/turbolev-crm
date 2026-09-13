import fs from "node:fs";

const paths = {
  schema: "prisma/warranty.prisma",
  migration: "prisma/migrations/20260914014500_warranty_quality_cost_facts/migration.sql",
  service: "src/services/quality-analytics.service.ts",
  route: "app/api/analytics/quality/route.ts",
  costRoute: "app/api/warranties/costs/route.ts",
  panel: "app/analytics-quality-panel.tsx",
  bridge: "app/analytics-quality-bridge.tsx",
  workspace: "app/analytics-workspace.tsx",
};

for (const [name, path] of Object.entries(paths)) {
  if (!fs.existsSync(path)) throw new Error(`[quality-analytics] missing ${name}: ${path}`);
}

const files = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, fs.readFileSync(path, "utf8")]));
const checks = [
  [files.schema.includes("model WarrantyClaimCostFact"), "canonical WarrantyClaimCostFact model is required"],
  [files.schema.includes("correctiveWorkOrderId"), "claim must support corrective Work Order attribution"],
  [files.migration.includes('CREATE TABLE "WarrantyClaimCostFact"'), "migration must create warranty cost ledger"],
  [files.migration.includes('ON DELETE CASCADE'), "cost facts must follow claim lifecycle"],
  [files.route.includes("PERMISSIONS.QC_READ") && files.route.includes("PERMISSIONS.WARRANTY_READ"), "quality analytics must require QC and warranty visibility"],
  [files.costRoute.includes("PERMISSIONS.WARRANTY_WRITE"), "warranty cost write must be protected by WARRANTY_WRITE"],
  [files.service.includes("attempt > 1"), "rework KPI must use repeated QC attempts"],
  [files.service.includes("WarrantyClaimCostFact") || files.service.includes("costFacts"), "warranty cost KPI must use cost facts"],
  [files.service.includes("completeCostCoverage"), "warranty cost KPI must be withheld when cost coverage is incomplete"],
  [files.service.includes("workOrderLineId") && files.service.includes("repeatDefect"), "repeat defect must use factual claim history"],
  [files.panel.includes("Warranty cost приховано"), "UI must disclose incomplete cost coverage"],
  [files.panel.includes("/api/warranties/costs"), "UI must support recording actual warranty cost facts"],
  [files.bridge.includes('"СТО / Виробництво"'), "quality panel must mount in Workshop analytics"],
  [files.workspace.includes("<AnalyticsQualityBridge/>"), "analytics workspace must mount quality analytics"],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(`[quality-analytics] ${message}`);
}

if (/plannedUnitPrice.*warrantyCost|actualUnitPrice.*warrantyCost|revenue.*warrantyCost/i.test(files.service)) {
  throw new Error("[quality-analytics] warranty cost must not be inferred from customer price/revenue");
}

console.log("[quality-analytics] contracts OK");
