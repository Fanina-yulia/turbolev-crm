"use client";

import { useCallback, useEffect, useState } from "react";
import { FinancialCenter as FinancialCenterBody } from "./financial-center-legacy";
import { FinancialGovernancePanel } from "./financial-center-governance-panel";
import { FinancialCenterMarginApprovals } from "./financial-center-margin-approvals";
import { readCrmRoute } from "./crm-route";
import styles from "./financial-center-v2.module.css";

type Account = {
  id: string;
  name: string;
  type: string;
  locationId: string | null;
  balance: number;
};

type DashboardPayload = {
  ok?: boolean;
  accounts?: Account[];
};

type ExportKind = "pnl" | "cash-flow" | "expenses" | "ar" | "ap" | "plan-fact";
type ExportFormat = "xlsx" | "pdf";

const EXPORTS: Array<{ kind: ExportKind; format: ExportFormat; label: string }> = [
  { kind: "pnl", format: "xlsx", label: "P&L · XLSX" },
  { kind: "pnl", format: "pdf", label: "P&L · PDF" },
  { kind: "cash-flow", format: "xlsx", label: "Cash Flow · XLSX" },
  { kind: "cash-flow", format: "pdf", label: "Cash Flow · PDF" },
  { kind: "expenses", format: "xlsx", label: "Витрати · XLSX" },
  { kind: "ar", format: "xlsx", label: "Дебіторка · XLSX" },
  { kind: "ap", format: "xlsx", label: "Кредиторка · XLSX" },
  { kind: "plan-fact", format: "xlsx", label: "План / факт · XLSX" },
];

function currentFinanceRoute() {
  const route = readCrmRoute();
  return {
    scope: route.scope || "overview",
    locationId: route.locationId || "",
    from: route.from || "",
    to: route.to || "",
  };
}

function downloadExport(kind: ExportKind, format: ExportFormat) {
  const current = currentFinanceRoute();
  const params = new URLSearchParams({ kind, format });
  if (current.from) params.set("from", current.from);
  if (current.to) params.set("to", current.to);
  if (current.locationId) params.set("locationId", current.locationId);
  const anchor = document.createElement("a");
  anchor.href = `/api/finance/v2/export?${params.toString()}`;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function FinancialCenter() {
  const [route, setRoute] = useState(currentFinanceRoute);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [governanceError, setGovernanceError] = useState("");

  const refreshRoute = useCallback(() => setRoute(currentFinanceRoute()), []);

  useEffect(() => {
    window.addEventListener("popstate", refreshRoute);
    return () => window.removeEventListener("popstate", refreshRoute);
  }, [refreshRoute]);

  const loadAccounts = useCallback(async () => {
    if (route.scope !== "settings") return;
    const params = new URLSearchParams();
    if (route.locationId) params.set("locationId", route.locationId);
    if (route.from) params.set("from", route.from);
    if (route.to) params.set("to", route.to);
    try {
      setGovernanceError("");
      const response = await fetch(`/api/finance/v2?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as DashboardPayload | null;
      if (!response.ok || !payload?.ok) throw new Error("Не вдалося завантажити рахунки для фінансових правил.");
      setAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
    } catch (cause) {
      setGovernanceError(cause instanceof Error ? cause.message : "Не вдалося завантажити фінансові правила.");
    }
  }, [route.from, route.locationId, route.scope, route.to]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const notifyChanged = useCallback(() => {
    void loadAccounts();
    window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
  }, [loadAccounts]);

  return <>
    <div className={styles.shell} style={{ paddingBottom: 0 }}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>REPORT EXPORT</span><h2>Вивантаження фінансів</h2><p>Файли формуються з тих самих фактів і поточного періоду/локації, що й Financial Center.</p></div>
          <div className={styles.headerActions}>{EXPORTS.map((item) => <button key={`${item.kind}:${item.format}`} type="button" className={styles.secondaryButton} onClick={() => downloadExport(item.kind, item.format)}>{item.label}</button>)}</div>
        </div>
      </section>
    </div>
    <FinancialCenterBody />
    {route.scope === "settings" && <div className={styles.shell}>
      {governanceError && <div className={styles.errorBox}>{governanceError}</div>}
      <FinancialGovernancePanel
        locationId={route.locationId}
        accounts={accounts}
        onChanged={notifyChanged}
      />
      <FinancialCenterMarginApprovals locationId={route.locationId} onChanged={notifyChanged} />
    </div>}
  </>;
}
