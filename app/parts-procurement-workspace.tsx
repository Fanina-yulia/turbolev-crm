"use client";

import { useEffect, useState } from "react";
import { PERMISSIONS } from "@/src/security/permissions";
import { ProcurementQueue } from "./procurement-queue";
import { SupplierReconciliationWorkspace } from "./parts-supplier-reconciliation";
import { useCrmAccess } from "./use-crm-access";
import styles from "./parts-procurement-workspace.module.css";

type View = "operations" | "reconciliation";

function initialView(): View {
  if (typeof window === "undefined") return "operations";
  const url = new URL(window.location.href);
  return url.searchParams.get("procurementView") === "reconciliation" ? "reconciliation" : "operations";
}

export function PartsProcurementWorkspace() {
  const [view, setView] = useState<View>(initialView);
  const { snapshot, loaded } = useCrmAccess();
  const canReadGlobalReconciliation = snapshot?.permissions?.[PERMISSIONS.PARTS_READ] === "ALL";

  useEffect(() => {
    const sync = () => setView(initialView());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!loaded || canReadGlobalReconciliation || view !== "reconciliation") return;
    setView("operations");
    const url = new URL(window.location.href);
    url.searchParams.delete("procurementView");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [canReadGlobalReconciliation, loaded, view]);

  function changeView(next: View) {
    if (next === "reconciliation" && !canReadGlobalReconciliation) return;
    setView(next);
    const url = new URL(window.location.href);
    if (next === "reconciliation") url.searchParams.set("procurementView", "reconciliation");
    else url.searchParams.delete("procurementView");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  const showReconciliation = loaded && canReadGlobalReconciliation;
  const effectiveView = showReconciliation && view === "reconciliation" ? "reconciliation" : "operations";

  return <div className={styles.page}>
    <nav className={styles.tabs} aria-label="Режим закупівель">
      <button type="button" className={effectiveView === "operations" ? styles.active : ""} onClick={() => changeView("operations")}>
        <span>Операційна черга</span><small>підбір → замовлення → отримання</small>
      </button>
      {showReconciliation && <button type="button" className={effectiveView === "reconciliation" ? styles.active : ""} onClick={() => changeView("reconciliation")}>
        <span>Reconciliation</span><small>нерозпізнані та конфліктні supplier rows</small>
      </button>}
    </nav>
    {effectiveView === "reconciliation" ? <SupplierReconciliationWorkspace/> : <ProcurementQueue/>}
  </div>;
}
