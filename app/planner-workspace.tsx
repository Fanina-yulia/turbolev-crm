"use client";

import { useEffect, useState } from "react";
import { readCrmRoute } from "./crm-route";
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

  return <div className={styles.root} data-resource-mode-label="Пости та механіки">
    {mode === "resources" ? <ProductionBoard/> : <PlannerV2/>}
  </div>;
}
