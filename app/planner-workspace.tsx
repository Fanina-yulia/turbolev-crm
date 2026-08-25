"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { PlannerV2 } from "./planner-v2";
import { ProductionBoard } from "./production-board";
import styles from "./planner-workspace.module.css";

type PlannerWorkspaceMode = "calendar" | "resources";

function modeFromRoute(): PlannerWorkspaceMode {
  return readCrmRoute().scope === "resources" ? "resources" : "calendar";
}

export function PlannerWorkspace() {
  const [mode, setMode] = useState<PlannerWorkspaceMode>(() => typeof window === "undefined" ? "calendar" : modeFromRoute());

  useEffect(() => {
    const sync = () => setMode(modeFromRoute());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const route = useMemo(() => typeof window === "undefined" ? {} : readCrmRoute(), [mode]);

  function openCalendar() {
    navigateCrm("Планувальник", {
      ...(route.status ? { status: route.status } : {}),
      ...(route.date ? { date: route.date } : {}),
      ...(route.locationId ? { locationId: route.locationId } : {}),
      scope: route.scope === "week" ? "week" : "day",
    });
  }

  function openResources() {
    navigateCrm("Планувальник", {
      ...(route.locationId ? { locationId: route.locationId } : {}),
      scope: "resources",
    });
  }

  return <div className={styles.root}>
    <div className={styles.modeBar} aria-label="Режим Планувальника">
      <div>
        <span>Планувальник</span>
        <strong>{mode === "resources" ? "Пости та механіки" : "Календар"}</strong>
      </div>
      <div className={styles.segmented}>
        <button type="button" className={mode === "calendar" ? styles.active : ""} onClick={openCalendar}>Календар</button>
        <button type="button" className={mode === "resources" ? styles.active : ""} onClick={openResources}>Пости та механіки</button>
      </div>
    </div>
    {mode === "resources" ? <ProductionBoard/> : <PlannerV2/>}
  </div>;
}
