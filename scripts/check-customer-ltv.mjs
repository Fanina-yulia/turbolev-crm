import fs from "node:fs";

const paths = {
  service: "src/services/customer-ltv.service.ts",
  route: "app/api/analytics/client-ltv/[clientId]/route.ts",
  ownerService: "src/services/owner-analytics-economics.service.ts",
  ownerUi: "app/analytics-owner-economics.tsx",
  card: "app/client-ltv-card.tsx",
  directory: "app/clients-directory.tsx",
};
for (const [name, path] of Object.entries(paths)) {
  if (!fs.existsSync(path)) throw new Error(`[customer-ltv] missing ${name}: ${path}`);
}
const files = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, fs.readFileSync(path, "utf8")]));

const checks = [
  [files.service.includes('kind: "ACTUAL"'), "LTV must use ACTUAL finance snapshots"],
  [files.service.includes("row.lockedAt"), "finance coverage must require locked ACTUAL snapshots"],
  [files.service.includes("costFacts"), "warranty adjustment must use WarrantyClaimCostFact relation"],
  [files.service.includes("financeCoveragePct") && files.service.includes("warrantyCostCoveragePct"), "LTV must expose data coverage"],
  [files.service.includes("const complete = financeComplete && warrantyComplete"), "primary LTV must be withheld when coverage is incomplete"],
  [files.service.includes("lifetimeContribution") && files.service.includes("observedGrossProfit - warrantyCostObserved"), "LTV contribution must subtract factual warranty cost"],
  [files.service.includes("acquisitionCost: null") && files.service.includes("acquisitionCostCoverage: false"), "CAC must remain n.a. without canonical attribution"],
  [files.route.includes("PERMISSIONS.CLIENTS_READ") && files.route.includes("PERMISSIONS.ANALYTICS_FINANCIAL_READ"), "client LTV endpoint must enforce client and financial permissions"],
  [files.ownerService.includes("getCustomerLifetimeMetrics"), "owner cohort must use canonical LTV service"],
  [files.ownerUi.includes("LTV = lifetime gross profit") && files.ownerUi.includes("CAC поки не віднімається"), "owner UI must disclose LTV semantics"],
  [files.card.includes("CAC: n.a.") && files.card.includes("LTV не показується приблизно"), "client card must disclose CAC and coverage gaps"],
  [files.directory.includes("<ClientLtvCard clientId={selected.id} />"), "client profile must mount LTV card"],
];
for (const [ok, message] of checks) if (!ok) throw new Error(`[customer-ltv] ${message}`);

if (/acquisitionCost\s*[:=]\s*[^n][^u][^l][^l]/i.test(files.service)) {
  throw new Error("[customer-ltv] CAC must not be fabricated from non-attributed marketing data");
}
if (/lifetimeContribution\s*=\s*.*grossRevenue/i.test(files.service)) {
  throw new Error("[customer-ltv] turnover/revenue must not be used as LTV contribution");
}

console.log("[customer-ltv] contracts OK");
