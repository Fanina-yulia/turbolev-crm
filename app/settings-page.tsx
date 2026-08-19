"use client";

import { useEffect, useState } from "react";
import { CameraSettingsPanel } from "./camera-settings-panel";
import { PersonnelV2 } from "./personnel-v2";
import { SecurityEnforcementControl } from "./security-enforcement-control";
import { SecuritySettingsPanelV2 } from "./security-settings-panel-v2";
import { SettingsOperationsPage } from "./settings-operations-page";
import { isSettingsTab, type SettingsTab } from "./settings-tabs";
import { WorkflowSettingsPanel } from "./workflow-settings-panel";
import styles from "./settings-page.module.css";

function tabFromUrl(): SettingsTab {
  if (typeof window === "undefined") return "schedule";
  const value = new URL(window.location.href).searchParams.get("settingsTab");
  return isSettingsTab(value) ? value : "schedule";
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("schedule");

  useEffect(() => {
    const sync = () => setTab(tabFromUrl());
    const onTab = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      setTab(isSettingsTab(value) ? value : "schedule");
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("turbolev:settings-tab", onTab);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("turbolev:settings-tab", onTab);
    };
  }, []);

  if (tab === "personnel") return <div className={styles.directPage}><PersonnelV2/></div>;
  if (tab === "workflow") return <div className={styles.directPage}><WorkflowSettingsPanel/></div>;
  if (tab === "security") return <div className={styles.directPage}><SecurityEnforcementControl/><SecuritySettingsPanelV2/></div>;
  if (tab === "cameras") return <div className={styles.directPage}><CameraSettingsPanel/></div>;
  return <SettingsOperationsPage tab={tab}/>;
}
