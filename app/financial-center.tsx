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

function currentFinanceRoute() {
  const route = readCrmRoute();
  return {
    scope: route.scope || "overview",
    locationId: route.locationId || "",
    from: route.from || "",
    to: route.to || "",
  };
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
