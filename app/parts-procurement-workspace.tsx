"use client";

import { useEffect, useState } from "react";
import { ProcurementQueue } from "./procurement-queue";
import { SupplierReconciliationWorkspace } from "./parts-supplier-reconciliation";
import styles from "./parts-procurement-workspace.module.css";

type View = "operations" | "reconciliation";

function initialView(): View {
  if (typeof window === "undefined") return "operations";
  const url = new URL(window.location.href);
  return url.searchParams.get("procurementView") === "reconciliation" ? "reconciliation" : "operations";
}

export function PartsProcurementWorkspace() {
  const [view, setView] = useState<View>(initialView);

  useEffect(() => {
    const sync = () => setView(initialView());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function changeView(next: View) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "reconciliation") url.searchParams.set("procurementView", "reconciliation");
    else url.searchParams.delete("procurementView");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return <div className={styles.page}>
    <nav className={styles.tabs} aria-label="Режим закупівель">
      <button type="button" className={view === "operations" ? styles.active : ""} onClick={() => changeView("operations")}>
        <span>Операційна черга</span><small>підбір → замовлення → отримання</small>
      </button>
      <button type="button" className={view === "reconciliation" ? styles.active : ""} onClick={() => changeView("reconciliation")}>
        <span>Reconciliation</span><small>нерозпізнані та конфліктні supplier rows</small>
      </button>
    </nav>
    {view === "reconciliation" ? <SupplierReconciliationWorkspace/> : <ProcurementQueue/>}
  </div>;
}
